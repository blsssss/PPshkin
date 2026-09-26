const START_LINK_KINDS = ['v', 'd', 'r'] as const;
export type StartLinkKind = (typeof START_LINK_KINDS)[number];

export interface StartLink {
  kind: StartLinkKind;
  value: string;
}

const START_LINK = /^([vdr])_([A-Za-z0-9]{1,32})$/;

function isStartLinkKind(value: string | undefined): value is StartLinkKind {
  return START_LINK_KINDS.some((kind) => kind === value);
}

export function parseStartLink(payload: string | null): StartLink | null {
  const [, kind, value] = START_LINK.exec(payload?.trim() ?? '') ?? [];
  return isStartLinkKind(kind) && value !== undefined ? { kind, value } : null;
}

export function formatStartLink(link: StartLink): string {
  return `${link.kind}_${link.value}`;
}
