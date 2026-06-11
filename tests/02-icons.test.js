import { describe, it, expect, beforeEach } from 'vitest';
import { ICON, SVG_ATTR, setIcon, hydrateIcons } from '../src/sections/02-icons.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('ICON registry', () => {
  it('contains complete inline SVGs sharing the common attribute set', () => {
    expect(Object.keys(ICON).length).toBeGreaterThan(15);
    for (const [name, svg] of Object.entries(ICON)) {
      expect(svg, name).toMatch(/^<svg /);
      expect(svg, name).toContain(SVG_ATTR);
      expect(svg, name).toMatch(/<\/svg>$/);
    }
  });
});

describe('setIcon', () => {
  it('sets the data-icon attribute and injects the SVG', () => {
    const el = document.createElement('span');
    setIcon(el, 'eye');
    expect(el.dataset.icon).toBe('eye');
    expect(el.querySelector('svg')).not.toBeNull();
  });

  it('clears the content for unknown icon names', () => {
    const el = document.createElement('span');
    el.innerHTML = '<b>x</b>';
    setIcon(el, 'does-not-exist');
    expect(el.innerHTML).toBe('');
  });

  it('ignores null elements', () => {
    expect(() => setIcon(null, 'eye')).not.toThrow();
  });
});

describe('hydrateIcons', () => {
  it('injects SVGs into all [data-icon] elements under the root', () => {
    document.body.innerHTML = `
      <span data-icon="eye"></span>
      <span data-icon="save"></span>
      <span data-icon="unknown"></span>
      <span class="plain"></span>`;
    hydrateIcons(document);
    const [eye, save, unknown] = document.querySelectorAll('[data-icon]');
    expect(eye.querySelector('svg')).not.toBeNull();
    expect(save.querySelector('svg')).not.toBeNull();
    expect(unknown.innerHTML).toBe(''); // unknown names stay untouched
    expect(document.querySelector('.plain').innerHTML).toBe('');
  });

  it('is idempotent', () => {
    document.body.innerHTML = '<span data-icon="close"></span>';
    hydrateIcons(document);
    const once = document.body.innerHTML;
    hydrateIcons(document);
    expect(document.body.innerHTML).toBe(once);
  });

  it('hydrates only inside the given root', () => {
    document.body.innerHTML = '<div id="a"><i data-icon="eye"></i></div><div id="b"><i data-icon="eye"></i></div>';
    hydrateIcons(document.getElementById('a'));
    expect(document.querySelector('#a svg')).not.toBeNull();
    expect(document.querySelector('#b svg')).toBeNull();
  });
});
