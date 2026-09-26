export const env = {
  botName: import.meta.env.VITE_MAX_BOT_NAME ?? '',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  demoMode: import.meta.env.VITE_DEMO_MODE === 'true',
};

export function devToken(): string | null {
  if (import.meta.env.DEV) {
    const token = import.meta.env.VITE_DEV_TOKEN;
    return token !== undefined && token.length > 0 ? token : null;
  }
  return null;
}
