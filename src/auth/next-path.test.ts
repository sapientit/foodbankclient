import { describe, expect, it } from 'vitest';
import { safeNextPath } from './next-path';

describe('safeNextPath', () => {
  it('keeps a path on this origin', () => {
    expect(safeNextPath('/sessions/1?week=2')).toBe('/sessions/1?week=2');
  });

  it('refuses anything that is not a path', () => {
    // `?next=` arrives from the URL bar, and each of these would send someone
    // who has just signed in to a site the food bank does not control.
    expect(safeNextPath('https://evil.example/login')).toBe('/');
    expect(safeNextPath('//evil.example')).toBe('/');
    expect(safeNextPath('/\\evil.example')).toBe('/');
    expect(safeNextPath('javascript:alert(1)')).toBe('/');
    expect(safeNextPath(null)).toBe('/');
  });
});
