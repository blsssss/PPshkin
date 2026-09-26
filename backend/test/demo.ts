import { vi } from 'vitest';
import type { DemoService } from '../src/services/demo.ts';

export function fakeDemo(overrides: Partial<Omit<DemoService, 'enabled'>> = {}): DemoService {
  return {
    enabled: true,
    seed: vi.fn<DemoService['seed']>(() => Promise.reject(new Error('demo.seed is not stubbed'))),
    refresh: vi.fn<DemoService['refresh']>(() => Promise.reject(new Error('demo.refresh is not stubbed'))),
    claimVenue: vi.fn<DemoService['claimVenue']>(() =>
      Promise.reject(new Error('demo.claimVenue is not stubbed')),
    ),
    fillDiary: vi.fn<DemoService['fillDiary']>(() =>
      Promise.resolve({ mealsAdded: 26, fromDate: '2026-09-21', toDate: '2026-09-25' }),
    ),
    ...overrides,
  };
}
