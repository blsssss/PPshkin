import { describe, expect, it, vi } from 'vitest';
import { answers, botChat, GUEST_ID, guestWorld, labels, payloads, sent, texts } from '../../../test/bot.ts';
import { fakeServices } from '../../../test/services.ts';
import type { AdminComplaint } from '../../domain/moderation.ts';
import type { ModerationService } from '../../services/moderation.ts';
import { conflict } from '../../shared/errors.ts';
import { BLOCK_REASON_LIMIT, COMPANY_NOTE_LIMIT } from '../../domain/moderation.ts';

const complaint: AdminComplaint = {
  id: 5,
  venueId: 7,
  bookingId: 31,
  reason: 'price_mismatch',
  status: 'open',
  createdAt: new Date('2026-09-26T08:00:00Z'),
  resolvedAt: null,
  text: 'На кассе дороже',
  venueName: 'Кофейня «Зерно»',
  bookingCode: 'K7M2QX',
  itemName: 'Эклер',
  resolution: null,
};

function adminChat(overrides: Partial<ModerationService> = {}, admin = true) {
  const world = guestWorld();
  world.consent('personal_data');
  const moderation: ModerationService = {
    ...fakeServices().moderation,
    isAdmin: (id) => admin && id === GUEST_ID,
    listForReview: vi.fn(() => Promise.resolve([complaint])),
    resolveComplaint: vi.fn(() => Promise.resolve({ ...complaint, status: 'resolved' as const })),
    blockVenue: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  world.services.moderation = moderation;
  return { chat: botChat({ world }), moderation };
}

describe('/admin', () => {
  it('shows the ordinary help to a user who is not an administrator', async () => {
    const { chat } = adminChat({}, false);
    const help = texts(await chat.send('/help'));
    expect(texts(await chat.send('/admin'))).toEqual(help);
  });

  it('opens the administrator screen with the complaints button', async () => {
    const { chat } = adminChat();
    const [screen] = sent(await chat.send('/admin'));
    expect(screen?.text).toBe('Администратор');
    expect(payloads(screen)).toEqual(['ad:cl']);
  });

  it('is not published in the command list', async () => {
    const { BOT_COMMANDS } = await import('../commands.ts');
    expect(BOT_COMMANDS.map(({ name }) => name)).not.toContain('admin');
  });
});

describe('administrator complaints', () => {
  it('lists open complaints with the card, the venue and the decision buttons', async () => {
    const { chat, moderation } = adminChat();
    await chat.send('/admin');
    const replies = await chat.press('ad:cl');
    expect(moderation.listForReview).toHaveBeenCalledWith(GUEST_ID, 'open');
    const [card] = sent(replies);
    expect(card?.text).toContain('Жалоба №5');
    expect(card?.text).toContain('Кофейня «Зерно»');
    expect(card?.text).toContain('K7M2QX');
    expect(card?.text).toContain('Цена на кассе другая');
    expect(card?.text).toContain('На кассе дороже');
    expect(labels(card)).toEqual(['Решено', 'Отклонить', 'Заблокировать заведение']);
    expect(payloads(card)).toEqual(['ad:ok:5', 'ad:no:5', 'ad:bv:7']);
  });

  it('says so when there is nothing to review', async () => {
    const { chat } = adminChat({ listForReview: () => Promise.resolve([]) });
    await chat.send('/admin');
    expect(texts(await chat.press('ad:cl'))).toEqual(['Открытых жалоб нет.']);
  });

  it('resolves and rejects a complaint through the bot channel', async () => {
    const { chat, moderation } = adminChat();
    await chat.send('/admin');
    const [card] = sent(await chat.press('ad:cl'));
    const resolved = await chat.press('ad:ok:5', card?.messageId);
    expect(moderation.resolveComplaint).toHaveBeenCalledWith(GUEST_ID, 5, { status: 'resolved' }, 'bot');
    expect(texts(resolved)).toEqual(['Жалоба №5: решена.']);
    const [second] = sent(await chat.press('ad:cl'));
    const rejected = await chat.press('ad:no:5', second?.messageId);
    expect(moderation.resolveComplaint).toHaveBeenLastCalledWith(GUEST_ID, 5, { status: 'rejected' }, 'bot');
    expect(texts(rejected)).toEqual(['Жалоба №5: отклонена.']);
  });

  it('explains a decision that was already taken', async () => {
    const { chat } = adminChat({
      resolveComplaint: () => Promise.reject(conflict('already_resolved', 'decided')),
    });
    await chat.send('/admin');
    const [card] = sent(await chat.press('ad:cl'));
    const replies = await chat.press('ad:ok:5', card?.messageId);
    expect(texts(replies)).toContain('Решение по жалобе уже принято.');
  });
});

describe('blocking a venue from the bot', () => {
  it('asks for the reason, takes it from the next message and blocks the venue', async () => {
    const { chat, moderation } = adminChat();
    await chat.send('/admin');
    const [card] = sent(await chat.press('ad:cl'));
    const asked = await chat.press('ad:bv:7', card?.messageId);
    expect(texts(asked)[0]).toContain('причину блокировки');
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'admin_block', venueId: 7 });
    const done = await chat.send('  Цена на кассе другая  ');
    expect(moderation.blockVenue).toHaveBeenCalledWith(GUEST_ID, 7, 'Цена на кассе другая', 'bot');
    expect(texts(done)[0]).toContain('Заведение заблокировано');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('keeps asking when the reason is too long and lets the administrator cancel', async () => {
    const { chat, moderation } = adminChat();
    await chat.send('/admin');
    const [card] = sent(await chat.press('ad:cl'));
    await chat.press('ad:bv:7', card?.messageId);
    const long = await chat.send('я'.repeat(BLOCK_REASON_LIMIT + 1));
    expect(texts(long)[0]).toContain('сократите');
    expect(moderation.blockVenue).not.toHaveBeenCalled();
    await chat.press('ad:bc');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
    expect(moderation.blockVenue).not.toHaveBeenCalled();
  });

  it('ignores admin buttons pressed by someone who is not an administrator', async () => {
    const { chat, moderation } = adminChat({}, false);
    const replies = await chat.press('ad:bv:7', 'mid.0');
    expect(answers(replies)[0]?.notification).toBe('Кнопка устарела');
    expect(moderation.blockVenue).not.toHaveBeenCalled();
  });
});

describe('company verification from the bot', () => {
  const decided = { company: {} as never, venues: [] };

  it('verifies a company from the card button', async () => {
    const decideCompanyVerification = vi.fn(() => Promise.resolve(decided));
    const { chat } = adminChat({ decideCompanyVerification });
    const replies = await chat.press('ad:cv:3', 'mid.0');
    expect(decideCompanyVerification).toHaveBeenCalledWith(GUEST_ID, 3, { decision: 'verified' }, 'bot');
    expect(texts(replies)).toEqual(['Компания подтверждена, владельцы получили сообщение.']);
  });

  it('offers the rejection reasons and rejects with the chosen one', async () => {
    const decideCompanyVerification = vi.fn(() => Promise.resolve(decided));
    const { chat } = adminChat({ decideCompanyVerification });
    const menu = answers(await chat.press('ad:cr:3', 'mid.0'))[0]?.message;
    expect(labels(menu)).toEqual([
      'Реквизиты не совпадают с заведением',
      'Компания не занимается общепитом',
      'Нет подтверждения полномочий',
      'Другое',
    ]);
    expect(payloads(menu)).toEqual(['ad:rr:3:0', 'ad:rr:3:1', 'ad:rr:3:2', 'ad:ro:3']);
    await chat.press('ad:rr:3:1', 'mid.0');
    expect(decideCompanyVerification).toHaveBeenCalledWith(
      GUEST_ID,
      3,
      { decision: 'rejected', note: 'Компания не занимается общепитом' },
      'bot',
    );
  });

  it('takes a free reason of up to 500 characters for the other option', async () => {
    const decideCompanyVerification = vi.fn(() => Promise.resolve(decided));
    const { chat } = adminChat({ decideCompanyVerification });
    await chat.press('ad:ro:3', 'mid.0');
    expect(chat.states.peek(GUEST_ID).flow).toMatchObject({ name: 'admin_reject', companyId: 3 });
    const long = await chat.send('я'.repeat(COMPANY_NOTE_LIMIT + 1));
    expect(texts(long)[0]).toContain('сократите');
    expect(decideCompanyVerification).not.toHaveBeenCalled();
    const done = await chat.send('  Нет вывески  ');
    expect(decideCompanyVerification).toHaveBeenCalledWith(
      GUEST_ID,
      3,
      { decision: 'rejected', note: 'Нет вывески' },
      'bot',
    );
    expect(texts(done)[0]).toContain('Компания отклонена');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
  });

  it('lets the administrator cancel the free reason', async () => {
    const decideCompanyVerification = vi.fn(() => Promise.resolve(decided));
    const { chat } = adminChat({ decideCompanyVerification });
    await chat.press('ad:ro:3', 'mid.0');
    await chat.press('ad:rc');
    expect(chat.states.peek(GUEST_ID).flow).toBeNull();
    expect(decideCompanyVerification).not.toHaveBeenCalled();
  });

  it('explains a company that is no longer pending', async () => {
    const { chat } = adminChat({
      decideCompanyVerification: () => Promise.reject(conflict('not_pending', 'decided')),
    });
    expect(texts(await chat.press('ad:cv:3', 'mid.0'))).toContain('Решение по компании уже принято.');
  });

  it('sends the owner invite link for a company without an owner', async () => {
    const createOwnerInviteAsAdmin = vi.fn(() =>
      Promise.resolve({
        invite: {} as never,
        token: 'T',
        startappLink: 'https://max.ru/ppshkin_bot?startapp=join_T',
        botLink: 'https://max.ru/ppshkin_bot?start=j_T',
      }),
    );
    const { chat } = adminChat({ createOwnerInviteAsAdmin });
    const replies = await chat.press('ad:oi:3', 'mid.0');
    expect(createOwnerInviteAsAdmin).toHaveBeenCalledWith(GUEST_ID, 3, 'bot');
    expect(texts(replies)[0]).toContain('https://max.ru/ppshkin_bot?start=j_T');
  });

  it('ignores the company buttons pressed by someone who is not an administrator', async () => {
    const decideCompanyVerification = vi.fn(() => Promise.resolve(decided));
    const { chat } = adminChat({ decideCompanyVerification }, false);
    const replies = await chat.press('ad:cv:3', 'mid.0');
    expect(answers(replies)[0]?.notification).toBe('Кнопка устарела');
    expect(decideCompanyVerification).not.toHaveBeenCalled();
  });
});
