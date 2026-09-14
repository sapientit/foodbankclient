import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(resolve('index.html'), 'utf8');
const favicon = resolve('public/favicon.png');

describe('browser icon', () => {
  it('links a transparent square PNG favicon', async () => {
    expect(indexHtml).toContain('<link rel="icon" type="image/png" href="/favicon.png" />');

    const metadata = await sharp(favicon).metadata();

    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(metadata.height);
    expect(metadata.hasAlpha).toBe(true);
  });
});
