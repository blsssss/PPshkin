const openSheets: (() => void)[] = [];

export function registerSheet(close: () => void): () => void {
  openSheets.push(close);
  return () => {
    const index = openSheets.lastIndexOf(close);
    if (index >= 0) openSheets.splice(index, 1);
  };
}

export function closeTopSheet(): boolean {
  const close = openSheets.at(-1);
  if (close === undefined) return false;
  close();
  return true;
}
