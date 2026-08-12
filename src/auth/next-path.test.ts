import { describe, expect, it } from 'vitest';
import { postLoginPath, safeNextPath } from './next-path';

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

describe('postLoginPath', () => {
  it('takes a fuel administrator to their one permitted screen', () => {
    expect(postLoginPath(null, 'fuel_admin')).toBe('/fuel-help');
    expect(postLoginPath('/', 'fuel_admin')).toBe('/fuel-help');
  });

  it('keeps a requested, on-origin return path for any role', () => {
    expect(postLoginPath('/fuel-help', 'fuel_admin')).toBe('/fuel-help');
    expect(postLoginPath('/sessions', 'admin')).toBe('/sessions');
  });
});
