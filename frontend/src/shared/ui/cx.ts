export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter((item): item is string => typeof item === 'string' && item.length > 0).join(' ');
}
