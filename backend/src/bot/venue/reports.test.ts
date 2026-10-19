import { describe, expect, it, vi } from 'vitest';
import { answers, sent } from '../../../test/bot.ts';
import { OWNER_ACTOR, OWNER_ID, venueChat } from '../../../test/venue-bot.ts';
import { buildReport, type ReportDealFacts, type ReportData } from '../../domain/reports.ts';
import { conflict, unavailable, unprocessable } from '../../shared/errors.ts';
import type { ReportsService } from '../../services/reports.ts';
import { dayCloseScreen, weekReportScreen } from './reports.ts';
import { sampleVenue } from '../../../test/venues.ts';

const HOME = { type: 'callback', text: 'Главное меню', payload: 'vn:home' };
const CANCEL = { type: 'callback', text: 'Отмена', payload: 'vn:rp:cancel' };
const NOW = new Date('2026-10-18T19:30:00Z');

function facts(overrides: Partial<ReportDealFacts> = {}): ReportDealFacts {
  return {
    dealId: 21,
    date: '2026-10-18',
    menuItemId: 11,
    itemName: 'Круассан',
    listPriceRub: 200,
    dealPriceRub: 120,
    source: 'manual',
    listed: 9,
    soldViaApp: 6,
    reserved: 0,
    revenueRub: 720,
    writtenOff: null,
    finished: true,
    ...overrides,
  };
}

function report(deals: ReportDealFacts[]): ReportData {
  return buildReport({
    from: '2026-10-18',
    to: '2026-10-18',
    timezone: 'Europe/Moscow',
    deals,
    newGuests: 2,
  });
}

function closeoutView(overrides: Partial<Awaited<ReturnType<ReportsService['closeOut']>>> = {}) {
  return {
    dealId: 21,
    writtenOff: 3,
    closedAt: NOW,
    closedBy: 'Анна',
    channel: 'bot' as const,
    date: '2026-10-18',
    ...overrides,
  };
}

function chatWith(reports: Partial<ReportsService>) {
  const stub = {
    day: vi.fn<ReportsService['day']>(() => Promise.resolve(report([facts()]))),
    closeOut: vi.fn<ReportsService['closeOut']>(() => Promise.resolve(closeoutView())),
    exportToChat: vi.fn<ReportsService['exportToChat']>(() => Promise.resolve()),
    ...reports,
  };
  const chat = venueChat({ now: '2026-10-18T19:30:00Z', services: { reports: stub as ReportsService } });
  chat.fake.seedVenue();
  return { ...chat, reports: stub };
}

describe('day close screen', () => {
  it('lists items to close with a row of buttons each', () => {
    const screen = dayCloseScreen(
      { ...sampleVenue, name: 'Кофейня «Зерно»' },
      report([
        facts({ itemName: 'Круассан', listed: 9, soldViaApp: 6 }),
        facts({ dealId: 22, itemName: 'Эклер', listed: 6, soldViaApp: 3 }),
      ]),
    );
    expect(screen.text).toBe(
      [
        '**Итоги дня, Кофейня «Зерно», 18 октября**',
        'Выставлено 15, продано по броням 9 (60%), выручка 1440 ₽',
        'Отметьте, сколько списали:',
        'Круассан: не продано 3',
        'Эклер: не продано 3',
      ].join('\n'),
    );
    expect(screen.buttons).toEqual([
      [
        { kind: 'callback', text: 'Списали 3', payload: 'vn:co:21:all:7' },
        { kind: 'callback', text: 'Не списывали', payload: 'vn:co:21:0:7' },
        { kind: 'callback', text: 'Другое число', payload: 'vn:co:21:n:7' },
      ],
      [
        { kind: 'callback', text: 'Списали 3', payload: 'vn:co:22:all:7' },
        { kind: 'callback', text: 'Не списывали', payload: 'vn:co:22:0:7' },
        { kind: 'callback', text: 'Другое число', payload: 'vn:co:22:n:7' },
      ],
      [{ kind: 'callback', text: 'Главное меню', payload: 'vn:home' }],
    ]);
  });

  it('shows the closed day summary once every item is marked', () => {
    const screen = dayCloseScreen(sampleVenue, report([facts({ listed: 15, soldViaApp: 9, writtenOff: 2 })]));
    expect(screen.text).toBe('День закрыт: списано 2 из 15 (13%). Отчёт за неделю придёт в понедельник.');
  });

  it('says so when the day had no deals', () => {
    expect(dayCloseScreen(sampleVenue, report([])).text).toBe('Горящих позиций за этот день не было.');
  });

  it('shows eight items at most and mentions the rest', () => {
    const deals = Array.from({ length: 10 }, (_, index) => facts({ dealId: index + 1 }));
    const screen = dayCloseScreen(sampleVenue, report(deals));
    expect(screen.buttons).toHaveLength(9);
    expect(screen.text).toContain('И ещё позиций: 2');
  });

  it('escapes markdown in item names', () => {
    expect(dayCloseScreen(sampleVenue, report([facts({ itemName: 'Хлеб_1*' })])).text).toContain(
      'Хлеб\\_1\\*: не продано 3',
    );
  });
});

describe('week report screen', () => {
  const week = buildReport({
    from: '2026-10-12',
    to: '2026-10-18',
    timezone: 'Europe/Moscow',
    newGuests: 14,
    deals: [facts({ date: '2026-10-14', writtenOff: 2 })],
  });

  it('shows the totals and the buttons for the app and the PDF', () => {
    const screen = weekReportScreen({ ...sampleVenue, name: 'Зерно' }, week, true);
    expect(screen.text).toBe(
      [
        '**Отчёт за неделю 12-18 октября готов**',
        'Зерно',
        'Выставлено 9, продано по броням 6 (67%)',
        'Списано 2, не отмечено позиций 0',
        'Выручка 720 ₽, скидка 480 ₽',
        'Новых гостей: 14',
      ].join('\n'),
    );
    expect(screen.buttons).toEqual([
      [{ kind: 'app', text: 'Открыть в приложении', payload: 'report_20261012' }],
      [{ kind: 'callback', text: 'PDF', payload: 'vn:rp:pdf:20261012:7' }],
    ]);
  });

  it('leaves the app button out when there is no mini app', () => {
    expect(weekReportScreen(sampleVenue, week, false).buttons).toEqual([
      [{ kind: 'callback', text: 'PDF', payload: 'vn:rp:pdf:20261012:7' }],
    ]);
  });
});

describe('closing the day in the bot', () => {
  it('writes off the rest and shows the next items', async () => {
    const { press, reports } = chatWith({
      day: vi.fn(() => Promise.resolve(report([facts({ dealId: 22, itemName: 'Эклер' })]))),
    });

    const [reply] = answers(await press('vn:co:21:all:7', 'mid.close'));

    expect(reports.closeOut).toHaveBeenCalledWith(OWNER_ACTOR, 21, 'rest', 'bot');
    expect(reports.day).toHaveBeenCalledWith(OWNER_ACTOR, '2026-10-18');
    expect(reply?.message?.text).toContain('Эклер: не продано 3');
  });

  it('marks nothing written off and says the day is closed after the last item', async () => {
    const { press, reports } = chatWith({
      day: vi.fn(() => Promise.resolve(report([facts({ listed: 15, soldViaApp: 9, writtenOff: 0 })]))),
    });

    const [reply] = answers(await press('vn:co:21:0:7', 'mid.close'));

    expect(reports.closeOut).toHaveBeenCalledWith(OWNER_ACTOR, 21, 0, 'bot');
    expect(reply?.message?.text).toBe(
      'День закрыт: списано 0 из 15 (0%). Отчёт за неделю придёт в понедельник.',
    );
  });

  it('asks for a number and stores the written off portions', async () => {
    const { press, send, states, reports } = chatWith({});

    const replies = await press('vn:co:21:n:7', 'mid.close');
    expect(sent(replies)[0]).toMatchObject({
      text: 'Сколько порций списали? Напишите число, 0 если ничего.',
      buttons: [[CANCEL]],
    });
    expect(states.peek(OWNER_ID).flow).toMatchObject({ name: 'closeout_input', dealId: 21, venueId: 7 });

    await send('2');

    expect(reports.closeOut).toHaveBeenCalledWith(OWNER_ACTOR, 21, 2, 'bot');
    expect(states.peek(OWNER_ID).flow).toBeNull();
  });

  it.each(['много', '-1', '1001', '2.5'])('asks again after %j', async (input) => {
    const { press, send, states, reports } = chatWith({});
    await press('vn:co:21:n:7', 'mid.close');

    const [reply] = sent(await send(input));

    expect(reply?.text).toBe('Нужно целое число от 0 до 1000, например: 2');
    expect(reports.closeOut).not.toHaveBeenCalled();
    expect(states.peek(OWNER_ID).flow).toMatchObject({ name: 'closeout_input' });
  });

  it('keeps asking when the number is too large', async () => {
    const { press, send, states } = chatWith({
      closeOut: () => Promise.reject(unprocessable('writeoff_too_large', 'Too large')),
    });
    await press('vn:co:21:n:7', 'mid.close');

    const [reply] = sent(await send('50'));

    expect(reply?.text).toContain('Нельзя списать больше');
    expect(states.peek(OWNER_ID).flow).toMatchObject({ name: 'closeout_input' });
  });

  it.each([
    ['deal_not_finished', conflict('deal_not_finished', 'Running'), 'Горящее ещё идёт'],
    ['closeout_locked', conflict('closeout_locked', 'Locked'), 'только в течение 48 часов'],
  ])('explains %s and leaves the flow', async (_code, error, text) => {
    const { press, send, states } = chatWith({ closeOut: () => Promise.reject(error) });
    await press('vn:co:21:n:7', 'mid.close');

    const [reply] = sent(await send('2'));

    expect(reply?.text).toContain(text);
    expect(states.peek(OWNER_ID).flow).toBeNull();
  });

  it('cancels the input', async () => {
    const { press, states, reports } = chatWith({});
    await press('vn:co:21:n:7', 'mid.close');

    const [reply] = answers(await press('vn:rp:cancel', 'mid.prompt'));

    expect(reply?.message?.text).toContain('списание не отмечено');
    expect(states.peek(OWNER_ID).flow).toBeNull();
    expect(reports.closeOut).not.toHaveBeenCalled();
  });

  it.each(['vn:co', 'vn:co:bad:all:7', 'vn:co:21:x:7', 'vn:rp:pdf:2026:7'])(
    'treats %s as a stale button',
    async (payload) => {
      const { press, reports } = chatWith({});

      expect(answers(await press(payload, 'mid.old'))[0]?.notification).toBe('Кнопка устарела');
      expect(reports.closeOut).not.toHaveBeenCalled();
      expect(reports.exportToChat).not.toHaveBeenCalled();
    },
  );

  it('shows today from the statistics screen', async () => {
    const { press, reports } = chatWith({});

    const [reply] = answers(await press('vn:rp:day', 'mid.stats'));

    expect(reports.day).toHaveBeenCalledWith(OWNER_ACTOR, '2026-10-18');
    expect(reply?.message?.text).toContain('Итоги дня');
    expect(reply?.message?.buttons.at(-1)).toEqual([HOME]);
  });
});

describe('week report files in the bot', () => {
  it('sends the PDF of the week to the chat', async () => {
    const { press, reports } = chatWith({});

    const [reply] = answers(await press('vn:rp:pdf:20261012:7', 'mid.week'));

    expect(reports.exportToChat).toHaveBeenCalledWith(
      OWNER_ACTOR,
      { from: '2026-10-12', to: '2026-10-18' },
      'pdf',
    );
    expect(reply?.notification).toBe('Файл придёт в чат с ботом');
  });

  it('says the report is unavailable while the bot is not ready', async () => {
    const { press } = chatWith({
      exportToChat: () => Promise.reject(unavailable('messenger_unavailable', 'Down')),
    });

    expect(answers(await press('vn:rp:pdf:20261012:7', 'mid.week'))[0]?.notification).toBe(
      'Отчёт сейчас недоступен, попробуйте позже',
    );
  });
});
