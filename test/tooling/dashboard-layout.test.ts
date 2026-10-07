import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync('src/features/home/home-screen.module.css', 'utf8');

describe('dashboard layout', () => {
  it("keeps today's group content-sized while wrapping multiple session cards alongside each other", () => {
    expect(stylesheet).toMatch(/\.todaySessions\s*\{[\s\S]*?justify-self:\s*start;/);
    expect(stylesheet).toMatch(
      /\.todayList\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;[\s\S]*?inline-size:\s*fit-content;[\s\S]*?max-inline-size:\s*100%;/,
    );
    expect(stylesheet).toMatch(/\.todayList li\s*\{[\s\S]*?flex:\s*0 1 auto;/);
  });
});
