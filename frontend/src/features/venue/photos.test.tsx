import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '../../../test/app.tsx';
import { json, problem } from '../../../test/http.ts';
import { imageFile, useNodeFormData } from '../../../test/multipart.ts';
import type { MenuItem, Venue } from './model.ts';

vi.mock('../../api/index.ts', async () => (await import('../../../test/apiModule.ts')).apiModule);
const { server, startSession } = await import('../../../test/apiModule.ts');

const PHOTO = `/api/v1/photos/${'b'.repeat(64)}.webp`;

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

const ITEM: MenuItem = {
  id: 1,
  name: 'Капучино',
  description: null,
  category: 'drink',
  priceRub: 190,
  weightG: 250,
  kcal: 120,
  proteinG: null,
  fatG: null,
  carbsG: null,
  nutritionSource: 'venue',
  tags: [],
  isAvailable: true,
  photoUrl: null,
};

let venue: Venue;
let menu: MenuItem[];

async function start(patch: { venue?: Partial<Venue>; item?: Partial<MenuItem> } = {}) {
  venue = { ...VENUE, ...patch.venue };
  menu = [{ ...ITEM, ...patch.item }];
  await startSession();
  server.on('GET', '/api/v1/venue', () => json(venue));
  server.on('GET', '/api/v1/venue/menu', () => json({ items: menu }));
}

function chooseFile(label: string, file = imageFile()) {
  const input = screen.getByLabelText(`${label}: выбрать файл`);
  fireEvent.change(input, { target: { files: [file] } });
}

beforeEach(async () => {
  localStorage.clear();
  await useNodeFormData();
});

describe('venue photo', () => {
  it('uploads a photo of the venue as multipart and shows it', async () => {
    await start();
    server.on('PUT', '/api/v1/venue/photo', () => {
      venue = { ...venue, photoUrl: PHOTO };
      return json(venue);
    });
    await renderApp('/venue/settings');
    const field = await screen.findByRole('region', { name: 'Фото заведения' });
    expect(within(field).getByText(/Фото увидят гости/)).toBeTruthy();
    expect(field.querySelector('img')).toBeNull();
    chooseFile('Фото заведения');
    await waitFor(() => {
      expect(field.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
    });
    const call = server.callsTo('PUT', '/api/v1/venue/photo')[0];
    expect(call?.contentType).toMatch(/^multipart\/form-data/);
    expect(String(call?.body)).toContain('name="image"');
    expect(within(field).getByRole('button', { name: 'Заменить фото' })).toBeTruthy();
  });

  it('removes the photo of the venue', async () => {
    await start({ venue: { photoUrl: PHOTO } });
    server.on('DELETE', '/api/v1/venue/photo', () => {
      venue = { ...venue, photoUrl: null };
      return json(venue);
    });
    await renderApp('/venue/settings');
    const field = await screen.findByRole('region', { name: 'Фото заведения' });
    expect(field.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
    fireEvent.click(within(field).getByRole('button', { name: 'Удалить фото' }));
    await waitFor(() => {
      expect(field.querySelector('img')).toBeNull();
    });
    expect(server.callsTo('DELETE', '/api/v1/venue/photo')).toHaveLength(1);
    expect(within(field).getByRole('button', { name: 'Загрузить фото' })).toBeTruthy();
  });

  it('explains a rejected photo and keeps the old one', async () => {
    await start({ venue: { photoUrl: PHOTO } });
    server.on('PUT', '/api/v1/venue/photo', () => problem(422, 'image_unreadable'));
    await renderApp('/venue/settings');
    const field = await screen.findByRole('region', { name: 'Фото заведения' });
    chooseFile('Фото заведения');
    expect(
      await within(field).findByText(/Не удалось прочитать фото или оно слишком маленькое/),
    ).toBeTruthy();
    expect(field.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
  });

  it('tells a cashier-level refusal in words', async () => {
    await start();
    server.on('PUT', '/api/v1/venue/photo', () => problem(403, 'venue_forbidden'));
    await renderApp('/venue/settings');
    const field = await screen.findByRole('region', { name: 'Фото заведения' });
    chooseFile('Фото заведения');
    expect(await within(field).findByRole('alert')).toBeTruthy();
  });

  it('is not offered while the venue is being created', async () => {
    await startSession();
    server.on('GET', '/api/v1/venue', () => problem(404, 'venue_not_found'));
    await renderApp('/venue/settings');
    await screen.findByLabelText('Название');
    expect(screen.queryByRole('region', { name: 'Фото заведения' })).toBeNull();
  });

  it('shows the venue photo on the cabinet home', async () => {
    await start({ venue: { photoUrl: PHOTO } });
    await renderApp('/venue');
    const head = await screen.findByRole('region', { name: 'Заведение' });
    expect(head.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
  });
});

describe('menu item photo', () => {
  it('uploads a photo of the item and shows a thumbnail in the menu', async () => {
    await start();
    server.on('PUT', '/api/v1/venue/menu/items/{id}/photo', () => {
      menu = [{ ...ITEM, photoUrl: PHOTO }];
      return json(menu[0]);
    });
    const { router } = await renderApp('/venue/menu/1');
    const field = await screen.findByRole('region', { name: 'Фото позиции' });
    chooseFile('Фото позиции');
    await waitFor(() => {
      expect(field.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
    });
    expect(server.callsTo('PUT', '/api/v1/venue/menu/items/1/photo')).toHaveLength(1);
    await router.navigate('/venue/menu');
    const row = (await screen.findByText('Капучино')).closest('li');
    expect(row?.querySelector('img')?.getAttribute('src')).toBe(PHOTO);
  });

  it('removes the photo of the item', async () => {
    await start({ item: { photoUrl: PHOTO } });
    server.on('DELETE', '/api/v1/venue/menu/items/{id}/photo', () => {
      menu = [{ ...ITEM, photoUrl: null }];
      return json(menu[0]);
    });
    await renderApp('/venue/menu/1');
    const field = await screen.findByRole('region', { name: 'Фото позиции' });
    fireEvent.click(within(field).getByRole('button', { name: 'Удалить фото' }));
    await waitFor(() => {
      expect(field.querySelector('img')).toBeNull();
    });
    expect(server.callsTo('DELETE', '/api/v1/venue/menu/items/1/photo')).toHaveLength(1);
  });

  it('asks to save a new item before adding a photo', async () => {
    await start();
    await renderApp('/venue/menu/new');
    expect(await screen.findByText('Фото можно добавить, когда позиция сохранена')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Фото позиции' })).toBeNull();
  });

  it('keeps menu rows as they were when there is no photo', async () => {
    await start();
    await renderApp('/venue/menu');
    const row = (await screen.findByText('Капучино')).closest('li');
    expect(row?.querySelector('img')).toBeNull();
  });
});
