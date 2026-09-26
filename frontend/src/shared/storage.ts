const PREFIX = 'ppshkin.';

function wipe(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX) === true) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

export function wipeLocalData(): void {
  for (const pick of [() => localStorage, () => sessionStorage]) {
    try {
      wipe(pick());
    } catch {
      continue;
    }
  }
}
