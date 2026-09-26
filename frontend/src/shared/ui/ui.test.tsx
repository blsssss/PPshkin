import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmSheet } from './ConfirmSheet.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { OfflineBanner } from './OfflineBanner.tsx';
import { ScreenState } from './ScreenState.tsx';
import { SegmentedControl } from './SegmentedControl.tsx';
import { TOAST_DURATION_MS, ToastProvider, useToast } from './Toast.tsx';

afterEach(() => {
  vi.useRealTimers();
});

describe('ScreenState', () => {
  it('always gives empty and error states an action', () => {
    const retry = vi.fn();
    render(
      <ScreenState
        status="error"
        title="Не удалось загрузить"
        action={{ label: 'Повторить', onClick: retry }}
      />,
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(retry).toHaveBeenCalled();
  });

  it('announces loading', () => {
    render(<ScreenState status="loading" label="Загружаем дневник" />);
    expect(screen.getByRole('status', { name: 'Загружаем дневник' })).toBeTruthy();
  });
});

function ToastButton() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        toast.show('Запись удалена');
      }}
    >
      show
    </button>
  );
}

describe('Toast', () => {
  it('shows a polite status message and hides it after 4 seconds', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastButton />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'show' }));
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('Запись удалена');
    act(() => {
      vi.advanceTimersByTime(TOAST_DURATION_MS);
    });
    expect(screen.queryByText('Запись удалена')).toBeNull();
  });
});

function ConfirmHarness({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <span>{open ? 'open' : 'closed'}</span>
      <ConfirmSheet
        open={open}
        title="Удалить запись?"
        description="Это нельзя отменить"
        confirmLabel="Удалить"
        destructive
        onConfirm={async () => {
          await onConfirm();
          setOpen(false);
        }}
        onCancel={() => {
          setOpen(false);
        }}
      />
    </>
  );
}

describe('ConfirmSheet', () => {
  it('confirms once while the action runs', async () => {
    let finish: () => void = () => undefined;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(<ConfirmHarness onConfirm={onConfirm} />);
    expect(screen.getByRole('dialog', { name: 'Удалить запись?' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await Promise.resolve();
    });
    expect(screen.getByText('closed')).toBeTruthy();
  });

  it('closes on Escape', () => {
    render(<ConfirmHarness onConfirm={() => Promise.resolve()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('closed')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('SegmentedControl', () => {
  it('marks the active segment and reports changes only', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Раздел"
        value="active"
        onChange={onChange}
        options={[
          { value: 'active', label: 'Активные' },
          { value: 'history', label: 'История' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Активные' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Активные' }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'История' }));
    expect(onChange).toHaveBeenCalledWith('history');
  });
});

describe('OfflineBanner', () => {
  it('follows online and offline events', () => {
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<OfflineBanner />);
    expect(screen.queryByText('Нет подключения к интернету')).toBeNull();
    onLine.mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Нет подключения к интернету')).toBeTruthy();
    onLine.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.queryByText('Нет подключения к интернету')).toBeNull();
  });
});

function Broken(): never {
  throw new Error('render failed');
}

describe('ErrorBoundary', () => {
  it('offers a restart instead of a white screen', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const restart = vi.fn();
    render(
      <ErrorBoundary onRestart={restart}>
        <Broken />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Перезапустить' }));
    expect(restart).toHaveBeenCalled();
  });
});
