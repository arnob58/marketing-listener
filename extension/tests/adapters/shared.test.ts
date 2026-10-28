import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { countNearIcon } from '../../src/adapters/shared';

const root = (html: string): Element => {
  const doc = new Window().document;
  doc.body.innerHTML = html;
  return doc.body as unknown as Element;
};
const svg = (label: string) => `<svg aria-label="${label}" role="img"><title>${label}</title><path d="M0 0"/></svg>`;

describe('countNearIcon', () => {
  it('reads a count inside the same button as the icon', () => {
    const r = root(`<button>${svg('Like')}<span>1,234</span></button>`);
    expect(countNearIcon(r, ['Like'])?.value).toBe(1234);
  });

  it('reads the count sitting in the next sibling of the button', () => {
    const r = root(`<div><div><button>${svg('Like')}</button><span>12K</span></div></div>`);
    const m = countNearIcon(r, ['Like'])!;
    expect(m.value).toBe(12_000);
    expect(m.low).toBeLessThan(m.high); // abbreviated, so a range
  });

  it('climbs a few levels when the icon is wrapped', () => {
    const r = root(`<section><div><span><button><div>${svg('Comment')}</div></button></span></div><span>45</span></section>`);
    expect(countNearIcon(r, ['Comment'])?.value).toBe(45);
  });

  it('matches any of several labels, case-insensitively', () => {
    const r = root(`<button>${svg('Unlike')}</button><span>7</span>`);
    expect(countNearIcon(r, ['like', 'Unlike'])?.value).toBe(7);
  });

  it("does not take the next icon's count for this one", () => {
    const r = root(`<div><div><button>${svg('Like')}</button></div><div><button>${svg('Comment')}<span>9</span></button></div></div>`);
    expect(countNearIcon(r, ['Like'])).toBeNull();
    expect(countNearIcon(r, ['Comment'])?.value).toBe(9);
  });

  it('ignores neighbours that are words rather than counts', () => {
    const r = root(`<div><button>${svg('Like')}</button><span>Liked by someone and others</span></div>`);
    expect(countNearIcon(r, ['Like'])).toBeNull();
  });

  it('returns null when the icon is absent', () => {
    expect(countNearIcon(root('<button>Like</button><span>5</span>'), ['Like'])).toBeNull();
  });
});
