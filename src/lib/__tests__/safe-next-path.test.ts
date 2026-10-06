import { describe, it, expect } from 'vitest';
import { safeNextPath } from '../safe-next-path';

const ORIGIN = 'https://terminal.johnwesleyhicks.com';
const next = (raw: string | null) => safeNextPath(raw, ORIGIN);

// The post-login bounce became a hard navigation (window.location.assign), so
// anything this lets through is a real cross-origin redirect.
describe('safeNextPath — post-login redirect stays on this origin', () => {
  it('keeps same-origin paths, with query and hash', () => {
    expect(next('/')).toBe('/');
    expect(next('/wealth')).toBe('/wealth');
    expect(next('/api/oauth/authorize?client_id=gt_x&state=a%2Fb#frag'))
      .toBe('/api/oauth/authorize?client_id=gt_x&state=a%2Fb#frag');
  });

  it.each([
    ['//evil.example'],
    ['/\\evil.example'],
    ['/\t/evil.example'],       // parsers strip the tab → //evil.example
    ['/\n/evil.example'],
    ['/\r/evil.example'],
    ['/ok\\..\\evil'],
    ['https://evil.example/'],
    ['javascript:alert(1)'],
    ['evil.example'],
    [''],
  ])('refuses %j', (raw) => {
    expect(next(raw)).toBe('/');
  });

  it('never returns a value that resolves off-origin', () => {
    for (const raw of ['/\t/evil.example', '/%09/evil.example', '/.//evil.example', '/a/../../evil.example', '/?next=//evil.example']) {
      expect(new URL(next(raw), ORIGIN).origin).toBe(ORIGIN);
    }
  });

  it('defaults to the dashboard for a missing value', () => {
    expect(next(null)).toBe('/');
  });
});
