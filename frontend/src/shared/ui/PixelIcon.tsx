const ICONS = {
  diary: ['.#....#.', '########', '#......#', '#.####.#', '#......#', '#.###..#', '#......#', '########'],
  eat: ['#.#.#..#', '#.#.#.##', '#.#.#.##', '.###..##', '..#...##', '..#....#', '..#....#', '..#....#'],
  bookings: ['###.###.', '#.#.#.#.', '###.###.', '........', '###.#.#.', '#.#..#..', '###.#.#.', '........'],
  venue: ['########', '#.#.#.#.', '########', '.#....#.', '.#.##.#.', '.#.##.#.', '.######.', '........'],
  profile: ['...##...', '..####..', '..####..', '...##...', '........', '.######.', '########', '........'],
  back: ['....#...', '...#....', '..#.....', '.#######', '..#.....', '...#....', '....#...', '........'],
  close: ['#......#', '.#....#.', '..#..#..', '...##...', '...##...', '..#..#..', '.#....#.', '#......#'],
} as const;

export type PixelIconName = keyof typeof ICONS;

export function PixelIcon({ name, size = 24 }: { name: PixelIconName; size?: number }) {
  const rows = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {rows.flatMap((row, y) =>
        row
          .split('')
          .map((cell, x) =>
            cell === '#' ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} /> : null,
          ),
      )}
    </svg>
  );
}
