import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Photo, photoSrc } from './Photo.tsx';

const URL_CARD = `/api/v1/photos/${'a'.repeat(64)}.webp`;

describe('Photo', () => {
  it('renders nothing without a photo', () => {
    const { container, rerender } = render(<Photo url={null} alt="Блюдо" />);
    expect(container.querySelector('img')).toBeNull();
    rerender(<Photo url={undefined} alt="Блюдо" />);
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows the card size by default and the large size on request', () => {
    const { container, rerender } = render(<Photo url={URL_CARD} alt="Блюдо" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(URL_CARD);
    expect(container.querySelector('img')?.getAttribute('loading')).toBe('lazy');
    rerender(<Photo url={URL_CARD} alt="Блюдо" size="large" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(`${URL_CARD}?size=large`);
    expect(photoSrc(URL_CARD, 'large')).toBe(`${URL_CARD}?size=large`);
  });

  it('removes a broken image so the card keeps its old look', () => {
    const { container } = render(<Photo url={URL_CARD} alt="" />);
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    if (image) fireEvent.error(image);
    expect(container.querySelector('img')).toBeNull();
  });
});
