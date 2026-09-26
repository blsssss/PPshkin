import { shareInMax } from '../max/bridge.ts';

type ShareOutcome = 'shared' | 'cancelled' | 'copied' | 'manual';

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator.clipboard === 'undefined') return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function share(content: { text: string; link: string }): Promise<ShareOutcome> {
  const pending = shareInMax(content);
  return pending.then(async (result) => {
    if (result !== 'unavailable') return result;
    return (await copyText(`${content.text}\n${content.link}`)) ? 'copied' : 'manual';
  });
}
