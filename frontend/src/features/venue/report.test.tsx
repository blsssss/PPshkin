import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, problem } from '../../../test/http.ts';
import type { Schemas } from '../../api/client.ts';
import type { Venue } from './model.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const NOW = new Date('2026-09-26T12:00:00.000Z');

const VENUE: Venue = {
  id: 7,
  name: 'Кофейня «Зерно»',
  address: 'Казань, ул. Баумана, 36',
  category: 'coffee',
  location: { lat: 55.7963, lon: 49.1088 },
  opensAt: '08:00',
  closesAt: '22:00',
  timezone: 'Europe/Moscow',
  isDemo: false,
  photoUrl: null,
};

function row(patch: Partial<Schemas['VenueReportRow']> = {}): Schemas['VenueReportRow'] {
  return {
    dealId: 21,
    date: '2026-09-25',
    menuItemId: 1,
    itemName: 'Круассан',
    listPriceRub: 200,
    dealPriceRub: 120,
    source: 'manual',
    listed: 10,
    soldViaApp: 4,
    reserved: 0,
    writtenOff: null,
    unaccounted: null,
    revenueRub: 480,
    discountRub: 320,
    ...patch,
  };
}

function report(patch: Partial<Schemas['VenueReport']> = {}): Schemas['VenueReport'] {
  return {
    from: '2026-09-25',
    to: '2026-09-25',
    timezone: 'Europe/Moscow',
    listed: 10,
    soldViaApp: 4,
    reserved: 0,
    writtenOff: 0,
    unaccounted: 0,
    notClosed: 1,
    soldShare: 0.4,
    writeOffShare: 0,
    revenueRub: 480,
    discountRub: 320,
    newGuests: 2,
    missingListPrice: 0,
    rows: [row()],
    ...patch,
  };
}

async function start() {
  await startSession();
  server.reply('GET', '/api/v1/venue', VENUE);
  server.on('GET', '/api/v1/venue/analytics', () =>
    json({
      from: '2026-09-20',
      to: '2026-09-26',
      timezone: 'Europe/Moscow',
      offersShown: 1,
      offersAccepted: 0,
      bookingsCreated: 1,
      bookingsRedeemed: 1,
      bookingsExpired: 0,
      bookingsCancelled: 0,
      acceptRate: 0,
      redeemRate: 1,
      revenueRub: 120,
      surplusUnitsSold: 1,
      surplusRevenueRub: 120,
      topItems: [],
      byDay: [],
    }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('report tab', () => {
  it('shows yesterday before the venue closes, with totals and the not marked banner', async () => {
    await start();
    server.on('GET', '/api/v1/venue/reports', () => json(report()));
    await renderApp('/venue/analytics?tab=report');
    expect(await screen.findByText('Не отмечено списание по 1 позиции')).toBeTruthy();
    expect(server.callsTo('GET', '/api/v1/venue/reports')[0]?.search).toBe('?from=2026-09-25&to=2026-09-25');
    expect(screen.getByText('Выставлено')).toBeTruthy();
    expect(screen.getByText('40%')).toBeTruthy();
    expect(screen.getByText('Круассан')).toBeTruthy();
    expect(screen.getByText(/списание не отмечено/)).toBeTruthy();
  });

  it('opens the week from the start link', async () => {
    await start();
    server.on('GET', '/api/v1/venue/reports', () =>
      json(report({ from: '2026-09-14', to: '2026-09-20', rows: [] })),
    );
    await renderApp('/venue/analytics?tab=report&week=20260914');
    expect(await screen.findByText('Горящих позиций за этот период не было')).toBeTruthy();
    expect(server.callsTo('GET', '/api/v1/venue/reports')[0]?.search).toBe('?from=2026-09-14&to=2026-09-20');
  });

  it('switches between the statistics and the report', async () => {
    await start();
    server.on('GET', '/api/v1/venue/reports', () => json(report()));
    await renderApp('/venue/analytics');
    fireEvent.click(await screen.findByRole('button', { name: 'Отчёт' }));
    expect(await screen.findByText('Круассан')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Неделя' }));
    await waitFor(() => {
      expect(server.callsTo('GET', '/api/v1/venue/reports').at(-1)?.search).toBe(
        '?from=2026-09-14&to=2026-09-20',
      );
    });
  });

  it('marks the write-off with a stepper', async () => {
    await start();
    let current = report();
    server.on('GET', '/api/v1/venue/reports', () => json(current));
    server.on('PUT', '/api/v1/venue/deals/{id}/closeout', () => {
      current = report({
        notClosed: 0,
        writtenOff: 2,
        unaccounted: 4,
        rows: [row({ writtenOff: 2, unaccounted: 4 })],
      });
      return json({
        dealId: 21,
        writtenOff: 2,
        closedAt: '2026-09-26T12:00:00.000Z',
        closedBy: 'Анна',
        channel: 'miniapp',
      });
    });
    await renderApp('/venue/analytics?tab=report');
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить списание' }));
    expect(screen.getByLabelText('Списано, шт.').textContent).toBe('6');
    for (let step = 0; step < 4; step += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Списать меньше' }));
    }
    expect(screen.getByLabelText('Списано, шт.').textContent).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => {
      expect(server.callsTo('PUT', '/api/v1/venue/deals/21/closeout')[0]?.body).toEqual({ writtenOff: 2 });
    });
    expect(await screen.findByText(/списано 2, без учёта 4/)).toBeTruthy();
    expect(screen.queryByText(/Не отмечено списание/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Изменить списание' })).toBeTruthy();
  });

  it('does not go above the free portions', async () => {
    await start();
    server.on('GET', '/api/v1/venue/reports', () => json(report({ rows: [row({ reserved: 5 })] })));
    await renderApp('/venue/analytics?tab=report');
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить списание' }));
    expect(screen.getByLabelText('Списано, шт.').textContent).toBe('1');
    expect(screen.getByRole('button', { name: 'Списать больше' }).hasAttribute('disabled')).toBe(true);
  });

  it('explains a rejected write-off', async () => {
    await start();
    server.on('GET', '/api/v1/venue/reports', () => json(report()));
    server.on('PUT', '/api/v1/venue/deals/{id}/closeout', () => problem(409, 'closeout_locked'));
    await renderApp('/venue/analytics?tab=report');
    fireEvent.click(await screen.findByRole('button', { name: 'Отметить списание' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    expect(
      await screen.findByText('Списание можно менять только в течение 48 часов после первой отметки'),
    ).toBeTruthy();
  });

  it('sends the file to the chat and says so', async () => {
    await start();
    server.on('GET', '/api/v1/venue/reports', () => json(report()));
    server.on('POST', '/api/v1/venue/reports/export', () => json({ status: 'sending' }, 202));
    await renderApp('/venue/analytics?tab=report');
    fireEvent.click(await screen.findByRole('button', { name: 'CSV в чат' }));
    expect(await screen.findByText('Файл придёт в чат с ботом')).toBeTruthy();
    expect(server.callsTo('POST', '/api/v1/venue/reports/export')[0]?.body).toEqual({
      from: '2026-09-25',
      to: '2026-09-25',
      format: 'csv',
    });
    fireEvent.click(screen.getByRole('button', { name: 'PDF в чат' }));
    await waitFor(() => {
      expect(server.callsTo('POST', '/api/v1/venue/reports/export').at(-1)?.body).toMatchObject({
        format: 'pdf',
      });
    });
  });

  it('says when the bot is not running', async () => {
    await start();
    server.on('GET', '/api/v1/venue/reports', () => json(report()));
    server.on('POST', '/api/v1/venue/reports/export', () => problem(503, 'messenger_unavailable'));
    await renderApp('/venue/analytics?tab=report');
    fireEvent.click(await screen.findByRole('button', { name: 'PDF в чат' }));
    expect(await screen.findByText('Бот сейчас недоступен, попробуйте позже')).toBeTruthy();
  });

  it('shows an error with a retry', async () => {
    await start();
    server.on('GET', '/api/v1/venue/reports', () => problem(500, 'internal_error'));
    await renderApp('/venue/analytics?tab=report');
    expect(await screen.findByText('Не удалось загрузить отчёт')).toBeTruthy();
    await act(async () => {
      await Promise.resolve();
    });
  });
});
