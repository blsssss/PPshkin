import { useEffect, useRef } from 'react';

export type MaxPlatform = 'ios' | 'android' | 'desktop' | 'web';
export type ImpactStyle = 'soft' | 'light' | 'medium' | 'heavy' | 'rigid';
type NotificationType = 'success' | 'warning' | 'error';

interface WebAppBackButton {
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

interface WebAppHapticFeedback {
  impactOccurred(style: ImpactStyle): Promise<unknown>;
  notificationOccurred(type: NotificationType): Promise<unknown>;
  selectionChanged(): Promise<unknown>;
}

export interface WebAppBridge {
  initData?: string | null;
  platform?: string | null;
  version?: string | null;
  ready?: () => void;
  close?: () => void;
  BackButton?: WebAppBackButton;
  HapticFeedback?: WebAppHapticFeedback;
  requestScreenMaxBrightness?: () => Promise<unknown>;
  restoreScreenBrightness?: () => Promise<unknown>;
  shareMaxContent?: (content: { text: string; link?: string }) => Promise<unknown>;
  openLink?: (url: string) => void;
  openMaxLink?: (url: string) => void;
  openCodeReader?: (fileSelect?: boolean) => Promise<{ value?: unknown }>;
  enableClosingConfirmation?: () => void;
  disableClosingConfirmation?: () => void;
}

declare global {
  interface Window {
    WebApp?: WebAppBridge;
  }
}

const PLATFORMS: readonly MaxPlatform[] = ['ios', 'android', 'desktop', 'web'];

function bridge(): WebAppBridge | null {
  try {
    return typeof window !== 'undefined' && window.WebApp !== undefined ? window.WebApp : null;
  } catch {
    return null;
  }
}

function attempt(action: () => unknown): boolean {
  try {
    const result = action();
    if (result instanceof Promise) result.catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export function initData(): string | null {
  const value = bridge()?.initData;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function insideMax(): boolean {
  return initData() !== null;
}

export function platform(): MaxPlatform | null {
  if (!insideMax()) return null;
  const value = bridge()?.platform;
  return PLATFORMS.find((item) => item === value) ?? null;
}

export function hasSystemBackButton(): boolean {
  const current = platform();
  return (current === 'ios' || current === 'android') && bridge()?.BackButton !== undefined;
}

function vibrates(): boolean {
  const current = platform();
  return current === 'ios' || current === 'android';
}

function withHaptics(action: (feedback: WebAppHapticFeedback) => Promise<unknown>) {
  const feedback = bridge()?.HapticFeedback;
  if (!vibrates() || feedback === undefined) return;
  attempt(() => action(feedback));
}

export const haptic = {
  success(): void {
    withHaptics((feedback) => feedback.notificationOccurred('success'));
  },
  error(): void {
    withHaptics((feedback) => feedback.notificationOccurred('error'));
  },
  impact(style: ImpactStyle): void {
    withHaptics((feedback) => feedback.impactOccurred(style));
  },
};

export function ready(): void {
  const webApp = bridge();
  if (webApp?.ready !== undefined && insideMax()) attempt(() => webApp.ready?.());
}

export function closeApp(): boolean {
  const webApp = bridge();
  if (webApp?.close === undefined || !insideMax()) return false;
  return attempt(() => webApp.close?.());
}

export function canCloseApp(): boolean {
  return insideMax() && bridge()?.close !== undefined;
}

export async function requestMaxBrightness(): Promise<boolean> {
  const webApp = bridge();
  if (webApp?.requestScreenMaxBrightness === undefined || !insideMax()) return false;
  try {
    await webApp.requestScreenMaxBrightness();
    return true;
  } catch {
    return false;
  }
}

export async function restoreBrightness(): Promise<void> {
  const webApp = bridge();
  if (webApp?.restoreScreenBrightness === undefined || !insideMax()) return;
  try {
    await webApp.restoreScreenBrightness();
  } catch {
    return;
  }
}

function errorCode(reason: unknown): string {
  if (typeof reason !== 'object' || reason === null || !('error' in reason)) return '';
  const { error } = reason;
  if (typeof error !== 'object' || error === null || !('code' in error)) return '';
  return typeof error.code === 'string' ? error.code : '';
}

export function shareInMax(content: {
  text: string;
  link?: string;
}): Promise<'shared' | 'cancelled' | 'unavailable'> {
  const webApp = bridge();
  if (webApp?.shareMaxContent === undefined || !insideMax()) return Promise.resolve('unavailable');
  let pending: Promise<unknown>;
  try {
    pending = webApp.shareMaxContent(content);
  } catch {
    return Promise.resolve('unavailable');
  }
  return pending.then(
    () => 'shared' as const,
    (reason: unknown) =>
      errorCode(reason).includes('cancel') ? ('cancelled' as const) : ('unavailable' as const),
  );
}

function openInBrowser(url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    return;
  }
}

export type ScanResult =
  { status: 'scanned'; value: string } | { status: 'failed' } | { status: 'unavailable' };

export function canScanQr(): boolean {
  return insideMax() && bridge()?.openCodeReader !== undefined;
}

export async function scanQrCode(): Promise<ScanResult> {
  const webApp = bridge();
  if (webApp?.openCodeReader === undefined || !insideMax()) return { status: 'unavailable' };
  try {
    const result = await webApp.openCodeReader(true);
    return typeof result.value === 'string' && result.value.length > 0
      ? { status: 'scanned', value: result.value }
      : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

export function openExternalLink(url: string): void {
  const webApp = bridge();
  if (webApp?.openLink !== undefined && insideMax() && attempt(() => webApp.openLink?.(url))) return;
  openInBrowser(url);
}

export function openMaxLink(url: string): void {
  const webApp = bridge();
  if (webApp?.openMaxLink !== undefined && insideMax() && attempt(() => webApp.openMaxLink?.(url))) return;
  openInBrowser(url);
}

export function setClosingConfirmation(enabled: boolean): void {
  const webApp = bridge();
  if (!insideMax()) return;
  if (enabled) attempt(() => webApp?.enableClosingConfirmation?.());
  else attempt(() => webApp?.disableClosingConfirmation?.());
}

export function useBackButton(onBack: () => void): void {
  const handlerRef = useRef(onBack);

  useEffect(() => {
    handlerRef.current = onBack;
  });

  useEffect(() => {
    const backButton = bridge()?.BackButton;
    if (backButton === undefined || !insideMax()) return;
    const handler = () => {
      handlerRef.current();
    };
    attempt(() => {
      backButton.onClick(handler);
    });
    attempt(() => {
      backButton.show();
    });
    return () => {
      attempt(() => {
        backButton.offClick(handler);
      });
      attempt(() => {
        backButton.hide();
      });
    };
  }, []);
}
