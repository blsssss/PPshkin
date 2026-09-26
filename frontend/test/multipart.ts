import { File as NodeFile } from 'node:buffer';
import { vi } from 'vitest';

export async function useNodeFormData(): Promise<void> {
  const probe = await new Response('a=1', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }).formData();
  vi.stubGlobal('FormData', probe.constructor);
}

export function imageFile(name = 'plate.jpg', type = 'image/jpeg'): File {
  return new NodeFile([new Uint8Array(64)], name, { type }) as unknown as File;
}
