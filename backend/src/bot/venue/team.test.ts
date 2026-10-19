import { describe, expect, it, vi } from 'vitest';
import { answers, labels, payloads, sent, texts } from '../../../test/bot.ts';
import { OWNER_ID, venueChat, type VenueChat } from '../../../test/venue-bot.ts';
import { sampleVenue } from '../../../test/venues.ts';
import type { Role } from '../../domain/roles.ts';
import { ROLE_PERMISSIONS } from '../../domain/roles.ts';
import type { Workplace } from '../../services/access.ts';
import { conflict, forbidden, notFound } from '../../shared/errors.ts';

const TOKEN = 'aB3dE5gH7jK9mN2pQ4rS6tU8';
const NO_RIGHTS = 'Это действие доступно владельцу или управляющему.';

function staffChat(role: Role, options: { consent?: boolean; inCompany?: boolean } = {}) {
  const uploadImage = vi.fn(() => Promise.resolve('qr-token'));
  const chat = venueChat({ api: { uploadImage } });
  if (options.consent !== true) chat.world.consents.clear();
  chat.fake.seedVenue();
  chat.fake.state.role = role;
  chat.fake.companies.workplaces.mockImplementation(() =>
    Promise.resolve([place(role, options.inCompany === false ? null : 3)]),
  );
  chat.fake.seedBooking(chat.fake.seedItem({ name: 'Эклер' }));
  return { ...chat, uploadImage };
}

function place(role: Role, companyId: number | null, venueId = sampleVenue.id): Workplace {
  return {
    venue: { ...sampleVenue, id: venueId, ownerId: companyId === null ? OWNER_ID : null, companyId },
    company: companyId === null ? null : { id: companyId, name: 'Компания', verification: 'unverified' },
    role,
    permissions: ROLE_PERMISSIONS[role],
    venueScoped: false,
    hiddenUntilVerified: false,
  };
}

describe('a cashier without the guest consent', () => {
  it('opens the venue and sees only the counter', async () => {
    const chat = staffChat('cashier');

    const [reply] = sent(await chat.send('/venue'));

    expect(reply?.text).toContain('Активных броней: 1');
    expect(labels(reply)).toEqual(['Погасить код', 'Брони', 'Горящее']);
  });

  it('is asked for the consent by a guest command', async () => {
    const chat = staffChat('cashier');

    const replies = await chat.send('/today');

    expect(payloads(sent(replies)[0])).toContain('cs:pd:more');
  });

  it('redeems a booking by the staff link and the button', async () => {
    const chat = staffChat('cashier');

    const [question] = sent(await chat.start('r_K7M2QX'));
    expect(payloads(question)).toEqual([`vn:rd_ok:K7M2QX:${sampleVenue.id}`, 'vn:rd_no']);
    const replies = await chat.press(`vn:rd_ok:K7M2QX:${sampleVenue.id}`);

    expect(texts(replies).join('\n')).toContain('Погашено: Эклер');
    expect(chat.fake.services.bookings.redeem).toHaveBeenCalledWith(
      { userId: OWNER_ID, venueId: sampleVenue.id },
      'K7M2QX',
      'bot',
    );
  });

  it('redeems a typed code in the redeem dialog', async () => {
    const chat = staffChat('cashier');

    await chat.press('vn:redeem', 'mid.home');
    const replies = await chat.send('k7m 2qx');

    expect(texts(replies)).toEqual(['Погашено: Эклер, 120 ₽. Блюдо добавлено гостю в дневник.']);
  });

  it('cannot open the menu, the wizard of deals or the statistics', async () => {
    const chat = staffChat('cashier');

    for (const payload of ['vn:menu', 'vn:menu:upload', 'vn:dl:new', 'vn:stats:today', 'vn:team']) {
      const [reply] = answers(await chat.press(payload, `mid.${payload}`));
      expect(reply?.message?.text, payload).toBe(NO_RIGHTS);
    }
    expect(chat.fake.services.menu.list).not.toHaveBeenCalled();
  });

  it('sees the live deals without the buttons that change them', async () => {
    const chat = staffChat('cashier');
    chat.fake.seedDeal(chat.fake.state.items[0]!);

    const [reply] = answers(await chat.press('vn:deals', 'mid.home'));

    expect(payloads(reply?.message)).toEqual(['vn:home']);
  });
});

describe('a user without a workplace and without the guest consent', () => {
  it('is asked for the consent by /venue and by the buttons of the venue', async () => {
    const chat = venueChat();
    chat.world.consents.clear();

    const command = await chat.send('/venue');
    expect(payloads(sent(command)[0])).toContain('cs:pd:more');

    const button = await chat.press('vn:bk', 'mid.old');
    expect(answers(button)[0]?.notification).toBe('Сначала нужно согласие на обработку данных');
  });
});

describe('several venues', () => {
  function chatWithTwo(): VenueChat {
    const chat = venueChat();
    chat.fake.seedVenue();
    chat.fake.seedItem({ name: 'Эклер' });
    chat.fake.companies.workplaces.mockImplementation(() =>
      Promise.resolve([place('owner', 3), place('owner', 3, 8)]),
    );
    return chat;
  }

  it('asks which venue to use and remembers the answer', async () => {
    const chat = chatWithTwo();

    const [choice] = sent(await chat.send('/venue'));
    expect(choice?.text).toBe('Выберите заведение');
    expect(payloads(choice)).toEqual([`vn:pick:${sampleVenue.id}`, 'vn:pick:8']);

    const [home] = answers(await chat.press(`vn:pick:${sampleVenue.id}`, 'mid.pick'));
    expect(home?.message?.text).toContain('Активных броней: 0');
    expect(payloads(home?.message)).toContain('vn:switch');
    expect(chat.states.peek(OWNER_ID).activeVenueId).toBe(sampleVenue.id);
  });

  it('works with the remembered venue and offers to switch', async () => {
    const chat = chatWithTwo();
    chat.states.put(OWNER_ID, { activeVenueId: sampleVenue.id });

    const [home] = sent(await chat.send('/venue'));
    expect(home?.text).toContain('Активных броней: 0');

    const [again] = answers(await chat.press('vn:switch', 'mid.home'));
    expect(payloads(again?.message)).toEqual([`vn:pick:${sampleVenue.id}`, 'vn:pick:8']);
  });

  it('ignores a venue the user does not work in', async () => {
    const chat = chatWithTwo();

    const [reply] = answers(await chat.press('vn:pick:99', 'mid.pick'));

    expect(reply?.notification).not.toBeNull();
    expect(chat.states.peek(OWNER_ID).activeVenueId).toBeNull();
  });

  it('asks again when the remembered venue is gone', async () => {
    const chat = chatWithTwo();
    chat.states.put(OWNER_ID, { activeVenueId: 99 });

    const [choice] = answers(await chat.press('vn:bk', 'mid.old'));

    expect(choice?.message?.text).toBe('Выберите заведение');
  });
});

describe('the team screen', () => {
  const member = (userId: number, firstName: string | null, role: Role) => ({
    userId,
    firstName,
    role,
    venueId: null,
    since: new Date('2026-09-20T09:00:00Z'),
  });

  it('shows the staff and offers both invites to the owner', async () => {
    const chat = staffChat('owner', { consent: true });
    chat.fake.companies.listMembers.mockResolvedValue([
      member(OWNER_ID, 'Анна', 'owner'),
      member(303, 'Пётр', 'cashier'),
      member(404, null, 'manager'),
    ]);

    const [reply] = answers(await chat.press('vn:team', 'mid.home'));

    expect(reply?.message?.text).toBe(
      ['**Сотрудники**', 'Анна: владелец', 'Пётр: кассир', 'id 404: управляющий'].join('\n'),
    );
    expect(payloads(reply?.message)).toEqual(['vn:team:inv:cashier', 'vn:team:inv:manager', 'vn:home']);
    expect(chat.fake.companies.listMembers).toHaveBeenCalledWith(OWNER_ID, 3);
  });

  it('offers a manager to invite only cashiers', async () => {
    const chat = staffChat('manager', { consent: true });

    const [reply] = answers(await chat.press('vn:team', 'mid.home'));

    expect(reply?.message?.text).toContain('Пока вы здесь одни');
    expect(payloads(reply?.message)).toEqual(['vn:team:inv:cashier', 'vn:home']);
  });

  it('sends the invite link with a QR', async () => {
    const chat = staffChat('owner', { consent: true });
    chat.fake.companies.createInvite.mockResolvedValue({
      invite: {
        id: 9,
        companyId: 3,
        venueId: sampleVenue.id,
        role: 'cashier',
        createdBy: OWNER_ID,
        createdByName: 'Анна',
        expiresAt: new Date('2026-09-29T09:00:00Z'),
        acceptedBy: null,
        acceptedAt: null,
        revokedAt: null,
        createdAt: new Date('2026-09-26T09:00:00Z'),
      },
      token: TOKEN,
      startappLink: `https://max.ru/ppshkin_bot?startapp=join_${TOKEN}`,
      botLink: `https://max.ru/ppshkin_bot?start=j_${TOKEN}`,
    });

    const replies = await chat.press('vn:team:inv:cashier', 'mid.team');

    expect(chat.fake.companies.createInvite).toHaveBeenCalledWith(OWNER_ID, 3, {
      role: 'cashier',
      venueId: sampleVenue.id,
    });
    const [invite] = sent(replies);
    expect(invite?.text).toContain(`https://max.ru/ppshkin_bot?start=j_${TOKEN}`);
    expect(invite?.text).toContain('кассир');
    expect(invite?.images).toEqual(['qr-token']);
    expect(chat.uploadImage).toHaveBeenCalledOnce();
  });

  it('still sends the link when the QR cannot be uploaded', async () => {
    const chat = staffChat('owner', { consent: true });
    chat.uploadImage.mockRejectedValue(new Error('upload failed'));
    chat.fake.companies.createInvite.mockResolvedValue({
      invite: {
        id: 9,
        companyId: 3,
        venueId: sampleVenue.id,
        role: 'cashier',
        createdBy: OWNER_ID,
        createdByName: null,
        expiresAt: new Date('2026-09-29T09:00:00Z'),
        acceptedBy: null,
        acceptedAt: null,
        revokedAt: null,
        createdAt: new Date('2026-09-26T09:00:00Z'),
      },
      token: TOKEN,
      startappLink: 'https://max.ru/ppshkin_bot?startapp=join_x',
      botLink: `https://max.ru/ppshkin_bot?start=j_${TOKEN}`,
    });

    const [invite] = sent(await chat.press('vn:team:inv:cashier', 'mid.team'));

    expect(invite?.text).toContain(`j_${TOKEN}`);
    expect(invite?.images).toEqual([]);
  });

  it('tells about the invite limit and about a manager asking for a manager', async () => {
    const chat = staffChat('owner', { consent: true });
    chat.fake.companies.createInvite.mockRejectedValueOnce(conflict('invite_limit', 'Limit'));
    const [limit] = answers(await chat.press('vn:team:inv:cashier', 'mid.team'));
    expect(limit?.message?.text).toBe('Действующих приглашений уже 20, отзовите лишние в кабинете');

    chat.fake.companies.createInvite.mockRejectedValueOnce(forbidden('company_forbidden', 'No'));
    const [denied] = answers(await chat.press('vn:team:inv:manager', 'mid.team'));
    expect(denied?.message?.text).toBe(NO_RIGHTS);
  });

  it('is not offered to a venue without a company', async () => {
    const chat = staffChat('owner', { consent: true, inCompany: false });

    const [home] = sent(await chat.send('/venue'));
    expect(payloads(home)).not.toContain('vn:team');

    const [reply] = answers(await chat.press('vn:team', 'mid.home'));
    expect(reply?.message?.text).toBe(NO_RIGHTS);
  });
});

describe('the invite link', () => {
  const preview = {
    companyName: 'Кофейни «Зерно»',
    venueName: 'Зерно на Баумана',
    role: 'cashier' as const,
    expiresAt: new Date('2026-09-29T09:00:00Z'),
  };

  function newcomer() {
    const chat = venueChat();
    chat.world.consents.clear();
    chat.fake.companies.previewInvite.mockResolvedValue(preview);
    return chat;
  }

  it('is shown before the guest consent and never stored in the chat state', async () => {
    const chat = newcomer();

    const [reply] = sent(await chat.start(`j_${TOKEN}`));

    expect(reply?.text).toBe(
      'Вас приглашают в «Кофейни «Зерно»»: кассир, Зерно на Баумана. Приглашение действует ограниченное время.',
    );
    expect(payloads(reply)).toEqual([`vn:inv:ok:${TOKEN}`, 'vn:inv:no']);
    expect(JSON.stringify(chat.states.peek(OWNER_ID))).not.toContain(TOKEN);
    expect(chat.states.peek(OWNER_ID).pendingStart).toBeNull();
  });

  it('accepts the invite without the guest consent and shows the data notice', async () => {
    const chat = newcomer();
    chat.fake.companies.acceptInvite.mockResolvedValue({
      workplace: { ...place('cashier', 3), venueScoped: true },
      companyName: 'Компания',
      inviterId: 202,
    });

    const [reply] = answers(await chat.press(`vn:inv:ok:${TOKEN}`, 'mid.invite'));

    expect(chat.fake.companies.acceptInvite).toHaveBeenCalledWith(OWNER_ID, TOKEN);
    expect(reply?.message?.text).toContain('Готово, кабинет в /venue.');
    expect(reply?.message?.text).toContain('Согласие гостя на дневник питания для этого не нужно.');
    expect(chat.states.peek(OWNER_ID).activeVenueId).toBe(sampleVenue.id);
    expect(JSON.stringify(chat.states.peek(OWNER_ID))).not.toContain(TOKEN);
  });

  it('lets the user decline', async () => {
    const chat = newcomer();

    const [reply] = answers(await chat.press('vn:inv:no', 'mid.invite'));

    expect(reply?.message?.text).toBe('Хорошо, приглашение не принято.');
    expect(chat.fake.companies.acceptInvite).not.toHaveBeenCalled();
  });

  it.each([
    ['invite_expired', 'Срок приглашения вышел. Попросите новое'],
    ['invite_used', 'Это приглашение уже принято'],
    ['already_member', 'Вы уже работаете в этой компании: кабинет в /venue'],
  ])('explains %s on accept', async (code, text) => {
    const chat = newcomer();
    chat.fake.companies.acceptInvite.mockRejectedValue(conflict(code, 'No'));

    const [reply] = answers(await chat.press(`vn:inv:ok:${TOKEN}`, 'mid.invite'));

    expect(reply?.message?.text).toBe(text);
  });

  it.each([
    [notFound('invite_not_found', 'No'), 'Приглашение не найдено или отозвано. Попросите новое'],
    [conflict('invite_expired', 'No'), 'Срок приглашения вышел. Попросите новое'],
  ])('explains a bad link on the preview', async (error, text) => {
    const chat = newcomer();
    chat.fake.companies.previewInvite.mockRejectedValue(error);

    expect(texts(await chat.start(`j_${TOKEN}`))).toEqual([text]);
  });

  it('refuses a token of a wrong shape without asking the service', async () => {
    const chat = newcomer();

    expect(texts(await chat.press('vn:inv:ok:short', 'mid.invite'))).toEqual([
      'Приглашение не найдено или отозвано. Попросите новое',
    ]);
    expect(chat.fake.companies.acceptInvite).not.toHaveBeenCalled();
  });
});
