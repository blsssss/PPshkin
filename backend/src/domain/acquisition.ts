const ORGANIC = 'organic';

const ACQUISITION_LINK = /^(?:(?:v|d|venue|deal)_[1-9][0-9]{0,17}|c_[a-z0-9]{1,24})$/;

export function acquisitionOf(payload: string | null): string {
  const value = payload?.trim() ?? '';
  return ACQUISITION_LINK.test(value) ? value : ORGANIC;
}
