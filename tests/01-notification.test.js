import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showTemporaryNotification } from '../src/sections/01-config-status.js';
import { cssNumber } from '../src/sections/08-color-geometry.js';

globalThis.cssNumber = cssNumber;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
});

const el = () => document.getElementById('temp-notification');

describe('showTemporaryNotification', () => {
  it('creates the notification element and fades it in', () => {
    showTemporaryNotification('Hallo');
    expect(el().textContent).toBe('Hallo');
    expect(el().classList.contains('visible')).toBe(false);
    vi.advanceTimersByTime(10);
    expect(el().classList.contains('visible')).toBe(true);
  });

  it('reuses the existing element and updates the message', () => {
    showTemporaryNotification('Erste');
    const first = el();
    showTemporaryNotification('Zweite');
    expect(el()).toBe(first);
    expect(el().textContent).toBe('Zweite');
    expect(document.querySelectorAll('#temp-notification')).toHaveLength(1);
  });

  it('hides and removes the element after the duration', () => {
    showTemporaryNotification('Weg damit', 1000);
    vi.advanceTimersByTime(1000);
    expect(el().classList.contains('visible')).toBe(false);
    vi.advanceTimersByTime(300);
    expect(el()).toBeNull();
  });

  it('resets the hide timer when re-shown before expiry', () => {
    showTemporaryNotification('A', 1000);
    vi.advanceTimersByTime(900);
    showTemporaryNotification('B', 1000); // old timer must be cancelled
    vi.advanceTimersByTime(900);
    expect(el()).not.toBeNull(); // still visible: new timer not yet expired
    vi.advanceTimersByTime(100 + 300);
    expect(el()).toBeNull();
  });
});
