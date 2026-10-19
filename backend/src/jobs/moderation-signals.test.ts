import { describe, expect, it, vi } from 'vitest';
import { fakeLogger, fakeMessenger } from '../../test/max-api.ts';
import type { VenueSignal } from '../domain/moderation.ts';
import type { Messenger } from '../ports/messenger.ts';
import { moderationSignalsJob } from './moderation-signals.ts';

const signal: VenueSignal = {
  venueId: 7,
  name: 'Кофейня «Зерно»',
  reasons: ['open_complaints', 'low_redeem_rate'],
  openComplaints: 3,
  bookings: 12,
  redeemRate: 0.25,
};

const NOW = new Date('2026-09-25T07:00:00Z');

function jobWith(signals: VenueSignal[], adminIds = [900, 901]) {
  const sendToUser = vi.fn<Messenger['sendToUser']>(() => Promise.resolve({ messageId: 'mid' }));
  const job = moderationSignalsJob({
    moderation: { signals: () => Promise.resolve(signals) },
    adminIds,
    messenger: () => fakeMessenger({ sendToUser }),
    logger: fakeLogger(),
  });
  return { job, sendToUser };
}

describe('moderationSignalsJob', () => {
  it('runs every day at ten in the morning in Moscow', () => {
    expect(jobWith([]).job.schedule).toEqual({ dailyAt: '10:00', timeZone: 'Europe/Moscow' });
  });

  it('sends nothing when no venue needs attention', async () => {
    const { job, sendToUser } = jobWith([]);
    await job.run(NOW);
    expect(sendToUser).not.toHaveBeenCalled();
  });

  it('sends the list to every administrator', async () => {
    const { job, sendToUser } = jobWith([signal]);
    await job.run(NOW);
    expect(sendToUser.mock.calls.map(([userId]) => userId)).toEqual([900, 901]);
    const text = sendToUser.mock.calls[0]?.[1].text ?? '';
    expect(text).toContain('Кофейня');
    expect(text).toContain('открытых жалоб: 3');
    expect(text).toContain('погашено 25% из 12 броней');
  });
});
