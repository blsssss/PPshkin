import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedGuest } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { fakeLogger, fakeMessenger } from '../../test/max-api.ts';
import { queuedNotifications } from '../../test/notifications.ts';
import {
  seedCompany,
  seedCompanyVenue,
  seedDemoVenue,
  seedMember,
  seedMenuItem,
  seedUser,
} from '../../test/venues.ts';
import type { Company, Venue } from '../domain/models.ts';
import { createOutbox } from '../notifications/outbox.ts';
import type { CompanyRegistry, RegistryCompany } from '../ports/company-registry.ts';
import type { Messenger, OutgoingMessage } from '../ports/messenger.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { createAccountService } from './account.ts';
import { createBookingsService } from './bookings.ts';
import { createCatalogService } from './catalog.ts';
import { createCompaniesService, type CompaniesService } from './companies.ts';
import { createConsentsService } from './consents.ts';
import { createModerationService, type ModerationService } from './moderation.ts';

const pool = testPool();
const clock = fixedClock('2026-09-26T09:00:00Z');
const ADMIN = 900;
const OTHER_ADMIN = 901;
const OWNER = 101;
const SECOND_OWNER = 102;
const GUEST = 301;
const STRANGER = 302;
const DEMO_VENUE_ID = 900_001;
const INN = '7707083893';
const HOUR = 3_600_000;

const registered: RegistryCompany = {
  kind: 'legal',
  inn: INN,
  ogrn: '1027700132195',
  kpp: '770701001',
  name: 'ООО "КОФЕЙНЯ ЗЕРНО"',
  address: 'г Москва, ул Тестовая, д 1',
  okved: '47.11',
  status: 'ACTIVE',
  managerName: 'Иванов Иван Иванович',
};
const registry: CompanyRegistry = {
  findByInn: () => Promise.resolve({ status: 'found', company: registered }),
};

const background = createBackgroundTasks({ error: () => undefined });
const sendToUser = vi.fn<Messenger['sendToUser']>(() => Promise.resolve({ messageId: 'mid' }));
const outbox = createOutbox({
  pool,
  clock,
  bot: () => ({ messenger: fakeMessenger({ sendToUser }), username: 'ppshkin_bot' }),
  miniAppEnabled: true,
  diaryDay: () => Promise.reject(new Error('the diary is not used here')),
  reports: {
    build: () => Promise.reject(new Error('reports are not used here')),
    file: () => Promise.reject(new Error('reports are not used here')),
  },
  background,
  logger: fakeLogger(),
});
const consents = createConsentsService({ pool, clock });

let companies: CompaniesService;
let moderation: ModerationService;
let company: Company;
let venue: Venue;

const sentTo = async (): Promise<[number, OutgoingMessage][]> => {
  await background.idle();
  await outbox.deliverDue(clock.now());
  const calls = sendToUser.mock.calls.map(([userId, message]): [number, OutgoingMessage] => [
    userId,
    message,
  ]);
  sendToUser.mockClear();
  return calls;
};

async function makeCompany(verification: Company['verification'], ownerId = OWNER, name = 'Зерно') {
  const created = await seedCompany(pool, ownerId, name);
  await pool.query(
    `update companies set verification = $2, kind = 'legal', inn = $3, verified_at = case when $2 = 'verified' then now() end where id = $1`,
    [created.id, verification, String(7_700_000_000 + created.id)],
  );
  const place = await seedCompanyVenue(pool, created.id, { name });
  return { company: created, venue: place };
}

function wire(verificationRequired: boolean) {
  companies = createCompaniesService({
    pool,
    clock,
    registry,
    notifications: outbox,
    adminIds: [ADMIN, OTHER_ADMIN],
    verificationRequired,
    botUsername: () => 'ppshkin_bot',
  });
  moderation = createModerationService({
    pool,
    clock,
    notifications: outbox,
    adminIds: [ADMIN, OTHER_ADMIN],
    companies,
    reports: { venuesWithNotClosedStreak: () => Promise.resolve([]) },
  });
}

beforeEach(async () => {
  await background.idle();
  await resetDatabase(pool);
  clock.set('2026-09-26T09:00:00Z');
  sendToUser.mockClear();
  wire(false);
  await seedUser(pool, ADMIN);
  await seedUser(pool, OTHER_ADMIN);
  await seedGuest(pool, GUEST, clock.now());
  await seedUser(pool, STRANGER);
  ({ company, venue } = await makeCompany('pending'));
});

afterAll(async () => {
  await background.idle();
  await closeTestPool();
});

describe('venue visibility with VENUE_VERIFICATION_REQUIRED', () => {
  const catalog = (required: boolean, demoMode = false) =>
    createCatalogService({ pool, clock, demoMode, verificationRequired: required });
  const ids = async (required: boolean, demoMode = false) =>
    (await catalog(required, demoMode).venues(GUEST, { point: null, radiusM: 3000 })).items.map(
      (card) => card.venue.id,
    );

  it('shows every venue as before while the flag is off', async () => {
    const rejected = await makeCompany('rejected', 103, 'Отклонённое');
    expect(await ids(false)).toEqual([venue.id, rejected.venue.id]);
    await expect(catalog(false).venue(GUEST, venue.id)).resolves.toMatchObject({ venue: { id: venue.id } });
  });

  it('shows only venues of verified companies while the flag is on', async () => {
    const verified = await makeCompany('verified', 104, 'Проверенное');
    await makeCompany('rejected', 105, 'Отклонённое');
    await makeCompany('unverified', 106, 'Без реквизитов');
    expect(await ids(true)).toEqual([verified.venue.id]);
    await expect(catalog(true).venue(GUEST, venue.id)).rejects.toMatchObject({ code: 'venue_not_found' });
    await expect(catalog(true).venue(GUEST, verified.venue.id)).resolves.toBeDefined();
  });

  it('keeps the demo venues in demo mode', async () => {
    await seedDemoVenue(pool, DEMO_VENUE_ID, { name: 'Демо' });
    const verified = await makeCompany('verified', 104, 'Проверенное');
    expect(await ids(true, true)).toEqual([DEMO_VENUE_ID, verified.venue.id]);
  });

  it('forbids booking at a venue of an unverified company and allows it after the decision', async () => {
    const item = await seedMenuItem(pool, venue.id, { name: 'Эклер', priceRub: 200 });
    const book = (required: boolean) =>
      createBookingsService({
        pool,
        clock,
        consents,
        notifications: outbox,
        verificationRequired: required,
      }).create(GUEST, { menuItemId: item.id }, 'miniapp');
    await expect(book(true)).rejects.toMatchObject({ code: 'menu_item_not_found' });
    await pool.query(`update companies set verification = 'verified' where id = $1`, [company.id]);
    await expect(book(true)).resolves.toMatchObject({ booking: { menuItemId: item.id } });
  });

  it('marks workplaces hidden until the verification, only while the flag is on', async () => {
    const hidden = (await companies.workplaces(OWNER)).map((place) => place.hiddenUntilVerified);
    expect(hidden).toEqual([false]);
    wire(true);
    expect((await companies.workplaces(OWNER)).map((place) => place.hiddenUntilVerified)).toEqual([true]);
    await pool.query(`update companies set verification = 'verified' where id = $1`, [company.id]);
    expect((await companies.workplaces(OWNER)).map((place) => place.hiddenUntilVerified)).toEqual([false]);
  });
});

describe('the card of a company waiting for a decision', () => {
  it('goes to every administrator with the registry data, the submitter and the buttons', async () => {
    const created = await companies.create(STRANGER, INN);
    await seedCompanyVenue(pool, created.company.id, { name: 'Зерно на Баумана' });
    const delivered = await sentTo();
    expect(delivered.map(([userId]) => userId).sort()).toEqual([ADMIN, OTHER_ADMIN]);
    const [, card] = delivered[0] ?? [];
    const text = card?.text ?? '';
    expect(text).toContain('Компания на проверку');
    expect(text).toContain(`ИНН ${INN}`);
    expect(text).toContain('ОГРН 1027700132195');
    expect(text).toContain('Статус в реестре: ACTIVE');
    expect(text).toContain('ОКВЭД 47.11 (не относится к общепиту)');
    expect(text).toContain('Руководитель: Иванов Иван Иванович');
    expect(text).toContain(`id ${String(STRANGER)}`);
    expect(text).toContain('Зерно на Баумана');
    expect(text).toContain('https://egrul.nalog.ru');
    const buttons = (card?.buttons ?? []).flat().map((button) => ('payload' in button ? button : null));
    expect(buttons.map((button) => button?.text)).toEqual(['Подтвердить', 'Отклонить']);
    expect(buttons.map((button) => button?.payload)).toEqual([
      `ad:cv:${String(created.company.id)}`,
      `ad:cr:${String(created.company.id)}`,
    ]);
  });

  it('is skipped when the company has been decided before the delivery', async () => {
    await outbox.enqueue(
      pool,
      { kind: 'company_pending', companyId: company.id, adminId: ADMIN },
      clock.now(),
    );
    await moderation.decideCompanyVerification(ADMIN, company.id, { decision: 'verified' }, 'api');
    const pending = (await queuedNotifications(pool)).filter((row) => row.kind === 'company_pending');
    expect(pending).toHaveLength(1);
    const delivered = await sentTo();
    expect(delivered.filter(([, message]) => message.text.includes('Компания на проверку'))).toEqual([]);
  });
});

describe('the decision on a company', () => {
  it('verifies the company, stores the decision and tells every owner', async () => {
    await seedMember(pool, company.id, SECOND_OWNER, 'owner');
    await seedMember(pool, company.id, 303, 'cashier', venue.id);
    clock.advance(HOUR);
    const view = await moderation.decideCompanyVerification(
      ADMIN,
      company.id,
      { decision: 'verified' },
      'bot',
    );
    expect(view.company).toMatchObject({ verification: 'verified', verificationNote: null });
    expect(view.company.verifiedAt).toEqual(clock.now());
    const delivered = await sentTo();
    expect(delivered.map(([userId]) => userId).sort()).toEqual([OWNER, SECOND_OWNER]);
    expect(delivered[0]?.[1].text).toContain('Компания проверена, заведение видно гостям');
    const actions = await pool.query<{
      action: string;
      company_id: number;
      venue_id: number | null;
      actor: number;
    }>(
      `select action, company_id, venue_id, actor_user_id as actor from audit_events where action like 'admin.company.%'`,
    );
    expect(actions.rows).toEqual([
      { action: 'admin.company.verify', company_id: company.id, venue_id: null, actor: ADMIN },
    ]);
  });

  it('rejects the company with the reason and the contacts of the team', async () => {
    const view = await moderation.decideCompanyVerification(
      ADMIN,
      company.id,
      { decision: 'rejected', note: ' Нет подтверждения полномочий ' },
      'api',
    );
    expect(view.company).toMatchObject({
      verification: 'rejected',
      verificationNote: 'Нет подтверждения полномочий',
      verifiedAt: null,
    });
    const delivered = await sentTo();
    expect(delivered.map(([userId]) => userId)).toEqual([OWNER]);
    const message = delivered[0]?.[1];
    expect(message?.text).toContain('Компания не прошла проверку: Нет подтверждения полномочий');
    expect(message?.text).toContain('https://max.ru/t516_hakaton_max_bot');
  });

  it('answers 409 not_pending to a repeated decision and keeps the first one', async () => {
    await moderation.decideCompanyVerification(ADMIN, company.id, { decision: 'verified' }, 'api');
    await expect(
      moderation.decideCompanyVerification(
        ADMIN,
        company.id,
        { decision: 'rejected', note: 'Другое' },
        'api',
      ),
    ).rejects.toMatchObject({ status: 409, code: 'not_pending' });
    expect(
      (
        await pool.query<{ verification: string }>('select verification from companies where id = $1', [
          company.id,
        ])
      ).rows,
    ).toEqual([{ verification: 'verified' }]);
  });

  it('does not decide a company without a requisites review', async () => {
    const draft = await makeCompany('unverified', 107, 'Черновик');
    await expect(
      moderation.decideCompanyVerification(ADMIN, draft.company.id, { decision: 'verified' }, 'api'),
    ).rejects.toMatchObject({ code: 'not_pending' });
    await expect(
      moderation.decideCompanyVerification(ADMIN, 99_999, { decision: 'verified' }, 'api'),
    ).rejects.toMatchObject({ status: 404, code: 'company_not_found' });
  });

  it('requires a reason of up to 500 characters to reject', async () => {
    for (const note of [undefined, '   ', 'я'.repeat(501)]) {
      await expect(
        moderation.decideCompanyVerification(ADMIN, company.id, { decision: 'rejected', note }, 'api'),
      ).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
    }
    expect(
      (
        await pool.query<{ verification: string }>('select verification from companies where id = $1', [
          company.id,
        ])
      ).rows,
    ).toEqual([{ verification: 'pending' }]);
  });

  it('hides all company actions from a user who is not an administrator', async () => {
    await expect(moderation.listCompaniesForReview(OWNER, 'pending')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
    await expect(
      moderation.decideCompanyVerification(OWNER, company.id, { decision: 'verified' }, 'api'),
    ).rejects.toMatchObject({ status: 404, code: 'not_found' });
    await expect(moderation.createOwnerInviteAsAdmin(OWNER, company.id, 'api')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
    });
  });

  it('lists the companies by the verification status with their venues', async () => {
    await makeCompany('verified', 108, 'Проверенная');
    const pending = await moderation.listCompaniesForReview(ADMIN, 'pending');
    expect(pending.map((view) => view.company.id)).toEqual([company.id]);
    expect(pending[0]?.venues).toEqual([{ id: venue.id, name: 'Зерно' }]);
    expect(await moderation.listCompaniesForReview(ADMIN, 'verified')).toHaveLength(1);
  });
});

describe('a company left without an owner', () => {
  it('tells the administrators when the last owner deletes the account', async () => {
    await seedMember(pool, company.id, 303, 'manager', venue.id);
    const account = createAccountService({
      pool,
      clock,
      notifications: outbox,
      adminIds: [ADMIN, OTHER_ADMIN],
    });
    await account.deleteAccount(OWNER);
    const delivered = await sentTo();
    expect(delivered.map(([userId]) => userId).sort()).toEqual([ADMIN, OTHER_ADMIN]);
    expect(delivered[0]?.[1].text).toContain('Компания осталась без владельца');
    expect(delivered[0]?.[1].text).toContain('Зерно');
    const button = delivered[0]?.[1].buttons?.flat()[0];
    expect(button).toMatchObject({
      text: 'Создать приглашение владельца',
      payload: `ad:oi:${String(company.id)}`,
    });
  });

  it('stays quiet when another owner remains', async () => {
    await seedMember(pool, company.id, SECOND_OWNER, 'owner');
    const account = createAccountService({ pool, clock, notifications: outbox, adminIds: [ADMIN] });
    await account.deleteAccount(OWNER);
    expect(await sentTo()).toEqual([]);
  });

  it('lets an administrator invite a new owner who then joins the company', async () => {
    const account = createAccountService({ pool, clock, notifications: outbox, adminIds: [ADMIN] });
    await seedUser(pool, SECOND_OWNER);
    await account.deleteAccount(OWNER);
    const created = await moderation.createOwnerInviteAsAdmin(ADMIN, company.id, 'bot');
    expect(created.invite).toMatchObject({ role: 'owner', venueId: null, createdBy: ADMIN });
    expect(created.botLink).toBe(`https://max.ru/ppshkin_bot?start=j_${created.token}`);
    const accepted = await companies.acceptInvite(SECOND_OWNER, created.token);
    expect(accepted.workplace).toMatchObject({ role: 'owner', venue: { id: venue.id } });
    const actions = await pool.query<{ action: string; company_id: number }>(
      `select action, company_id from audit_events where action = 'admin.company.invite'`,
    );
    expect(actions.rows).toEqual([{ action: 'admin.company.invite', company_id: company.id }]);
    await expect(moderation.createOwnerInviteAsAdmin(ADMIN, 99_999, 'api')).rejects.toMatchObject({
      code: 'company_not_found',
    });
  });
});
