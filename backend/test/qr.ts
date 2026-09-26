import sharp from 'sharp';

export interface DecodedQr {
  text: string;
  version: number;
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  quietZoneModules: number;
  width: number;
  height: number;
}

type Modules = boolean[][];

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const FORMAT_MASK = 0b101010000010010;
const LEVELS = ['M', 'L', 'H', 'Q'] as const;
const FINDER_MODULES = 7;

const SINGLE_BLOCK_DATA_CODEWORDS: Record<DecodedQr['errorCorrection'], readonly number[]> = {
  L: [19, 34, 55, 80],
  M: [16, 28, 44],
  Q: [13, 22],
  H: [9, 16],
};

const ALIGNMENT_CENTERS: readonly (readonly number[])[] = [[], [6, 18], [6, 22], [6, 26]];

const MASKS: readonly ((row: number, column: number) => boolean)[] = [
  (row, column) => (row + column) % 2 === 0,
  (row) => row % 2 === 0,
  (_, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
  (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
  (row, column) => (((row * column) % 2) + ((row * column) % 3)) % 2 === 0,
  (row, column) => (((row + column) % 2) + ((row * column) % 3)) % 2 === 0,
];

const FORMAT_CELLS: readonly (readonly [number, number])[] = [
  [0, 8],
  [1, 8],
  [2, 8],
  [3, 8],
  [4, 8],
  [5, 8],
  [7, 8],
  [8, 8],
  [8, 7],
  [8, 5],
  [8, 4],
  [8, 3],
  [8, 2],
  [8, 1],
  [8, 0],
];

async function sampleModules(png: Buffer) {
  const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const dark = (x: number, y: number) => (data[y * info.width + x] ?? 255) < 128;
  let corner = 0;
  while (corner < info.width && !dark(corner, corner)) corner += 1;
  let finderEnd = corner;
  while (finderEnd < info.width && dark(finderEnd, corner)) finderEnd += 1;
  const moduleSize = (finderEnd - corner) / FINDER_MODULES;
  const quietZoneModules = Math.round(corner / moduleSize);
  const size = Math.round(info.width / moduleSize) - 2 * quietZoneModules;
  const scale = info.width / (size + 2 * quietZoneModules);
  const center = (index: number) => Math.floor((quietZoneModules + index + 0.5) * scale);
  const modules = Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, column) => dark(center(column), center(row))),
  );
  return { modules, quietZoneModules, width: info.width, height: info.height };
}

function inFinderArea(row: number, column: number, size: number): boolean {
  return (row <= 8 && (column <= 8 || column >= size - 8)) || (row >= size - 8 && column <= 8);
}

function isFunctionModule(row: number, column: number, size: number, version: number): boolean {
  if (inFinderArea(row, column, size) || row === 6 || column === 6) return true;
  const centers = ALIGNMENT_CENTERS[version - 1] ?? [];
  return centers.some((centerRow) =>
    centers.some(
      (centerColumn) =>
        !inFinderArea(centerRow, centerColumn, size) &&
        Math.abs(row - centerRow) <= 2 &&
        Math.abs(column - centerColumn) <= 2,
    ),
  );
}

function readFormat(modules: Modules): { level: DecodedQr['errorCorrection']; mask: number } {
  const bits = FORMAT_CELLS.reduce(
    (value, [row, column], index) => (modules[row]?.[column] ? value | (1 << index) : value),
    0,
  );
  const format = (bits ^ FORMAT_MASK) >> 10;
  const level = LEVELS[format >> 3];
  if (!level) throw new Error('Unreadable format information');
  return { level, mask: format & 0b111 };
}

function readCodewords(modules: Modules, version: number, mask: number): number[] {
  const size = modules.length;
  const unmask = MASKS[mask];
  if (!unmask) throw new Error(`Unknown mask ${mask}`);
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    const pair = right <= 6 ? right - 1 : right;
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const column of [pair, pair - 1]) {
        if (isFunctionModule(row, column, size, version)) continue;
        bits.push(Boolean(modules[row]?.[column]) !== unmask(row, column) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  return Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
    bits.slice(index * 8, index * 8 + 8).reduce((byte, bit) => (byte << 1) | bit, 0),
  );
}

function bitReader(bytes: readonly number[]) {
  let position = 0;
  return {
    remaining: () => bytes.length * 8 - position,
    read(count: number): number {
      let value = 0;
      for (let index = 0; index < count; index += 1) {
        const byte = bytes[Math.floor(position / 8)] ?? 0;
        value = (value << 1) | ((byte >> (7 - (position % 8))) & 1);
        position += 1;
      }
      return value;
    },
  };
}

function parseSegments(data: readonly number[]): string {
  const reader = bitReader(data);
  let text = '';
  while (reader.remaining() >= 4) {
    const mode = reader.read(4);
    if (mode === 0b0000) break;
    if (mode === 0b0100) {
      const bytes = Array.from({ length: reader.read(8) }, () => reader.read(8));
      text += Buffer.from(bytes).toString('utf8');
    } else if (mode === 0b0010) {
      const count = reader.read(9);
      for (let left = count; left > 0; left -= 2) {
        if (left === 1) {
          text += ALPHANUMERIC.charAt(reader.read(6));
        } else {
          const pair = reader.read(11);
          text += ALPHANUMERIC.charAt(Math.floor(pair / 45)) + ALPHANUMERIC.charAt(pair % 45);
        }
      }
    } else if (mode === 0b0001) {
      const count = reader.read(10);
      for (let left = count; left > 0; left -= 3) {
        const digits = Math.min(left, 3);
        text += String(reader.read([4, 7, 10][digits - 1] ?? 10)).padStart(digits, '0');
      }
    } else {
      throw new Error(`Unsupported segment mode ${mode}`);
    }
  }
  return text;
}

export async function decodeQrPng(png: Buffer): Promise<DecodedQr> {
  const { modules, quietZoneModules, width, height } = await sampleModules(png);
  const version = (modules.length - 17) / 4;
  const { level, mask } = readFormat(modules);
  const dataCodewords = SINGLE_BLOCK_DATA_CODEWORDS[level][version - 1];
  if (!Number.isInteger(version) || dataCodewords === undefined) {
    throw new Error(`Version ${version}-${level} is not a single block symbol`);
  }
  const codewords = readCodewords(modules, version, mask);
  return {
    text: parseSegments(codewords.slice(0, dataCodewords)),
    version,
    errorCorrection: level,
    quietZoneModules,
    width,
    height,
  };
}
