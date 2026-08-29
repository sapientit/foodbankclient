import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Tests the stylesheets, not the app.
 *
 * **Whether a control can be used is said by its colour: blue works, grey does
 * not**, and that has to hold on every screen or it is not a signal at all. The
 * failure it guards against already happened: an available control and an
 * unavailable one differed by a shade of grey inside identical white boxes, a
 * working stock check was read as the dead control beside it, and it was
 * reported as broken in the middle of a session.
 *
 * The fix was one global style in `src/index.css`. What keeps it fixed is that
 * no screen draws its own — fifteen stylesheets each with their own idea of a
 * button is exactly the state this replaced, and it comes back one innocuous
 * `background:` at a time. jsdom evaluates no CSS, so no rendering test can
 * catch that; reading the stylesheets can.
 *
 * A screen may still say how big its controls are. Size is local — a table row
 * wants a compact chip, a form filled in on a phone wants a thumb target — and
 * none of it can make a dead control look live.
 */

/* Vitest runs from the project root. `import.meta.url` is not a file URL under
   jsdom, so it is not an alternative here. */
const REPO_ROOT = process.cwd();

/**
 * The control palette, which lives in exactly one file.
 *
 * `#b3261e` is deliberately not on this list even though a red button uses it:
 * it is also the colour every error message on every screen is written in, so a
 * module holding it says nothing about buttons either way.
 */
const CONTROL_ONLY_COLOURS = [
  '#0b5cab', // available
  '#084684', // available, hovered
  '#dcdcdc', // unavailable
  '#8c1e18', // cannot be undone, hovered
];

describe('the global control style', () => {
  const globalStyles = readFileSync(join(REPO_ROOT, 'src/index.css'), 'utf8').toLowerCase();

  it('is hung off `button` itself, so a button written tomorrow is drawn correctly', () => {
    expect(globalStyles).toMatch(/^button,$/m);
  });

  it.each(['button-secondary', 'button-danger', 'button-plain'])(
    'says grey after %s, so that no variant can make a dead control look live',
    (variant) => {
      const unavailable = globalStyles.indexOf("button[aria-disabled='true']");
      const declared = globalStyles.indexOf(`button:where(.${variant})`);

      expect(declared).toBeGreaterThan(0);
      expect(unavailable).toBeGreaterThan(declared);
    },
  );

  /*
   * The variants are wrapped in `:where()` so each weighs one element selector
   * and a screen's own `.editMenu button` outranks it on size. Unwrapped they
   * tie with it, and this file is bundled after the CSS Modules, so the tie went
   * to the global rule — a menu whose padding silently collapsed to nothing.
   */
  it.each(['button-secondary', 'button-danger', 'button-plain', 'button-link'])(
    'lets a screen outweigh %s on size',
    (variant) => {
      expect(globalStyles).not.toMatch(new RegExp(`(?:^|[\\s,])(?:button|a)\\.${variant}\\b`, 'm'));
    },
  );

  it('holds the whole palette', () => {
    for (const colour of [...CONTROL_ONLY_COLOURS, '#b3261e']) {
      expect(globalStyles).toContain(colour);
    }
  });

  it('takes its available colour from the current work category', () => {
    expect(globalStyles).toContain('var(--category-action, #0b5cab)');
    expect(globalStyles).toContain('var(--category-action-hover, #084684)');
  });

  /*
   * The contrast figures in that file's comments were the only place the claim
   * was made, and two of them were wrong — copied forward from an older
   * stylesheet and never re-derived. A volunteer reads these controls on a phone
   * in a hall, so the arithmetic is checked here instead: AA wants 4.5:1 for
   * text and 3:1 for the edge of a control.
   */
  it.each([
    ['available', '#ffffff', '#0b5cab', 4.5],
    ['available, hovered', '#ffffff', '#084684', 4.5],
    ['cannot be undone', '#ffffff', '#b3261e', 4.5],
    ['cannot be undone, hovered', '#ffffff', '#8c1e18', 4.5],
    ['quieter half', '#0b5cab', '#ffffff', 4.5],
    ['quieter half, hovered', '#084684', '#eaf1f9', 4.5],
    ['sessions', '#ffffff', '#176b3a', 4.5],
    ['referrals', '#ffffff', '#6d3a8c', 4.5],
    ['stock', '#ffffff', '#a84f0a', 4.5],
    ['unavailable', '#333333', '#dcdcdc', 4.5],
    ['unavailable, plain', '#595959', '#ffffff', 4.5],
    ['the edge of an unavailable control', '#767676', '#dcdcdc', 3],
    ['that edge against the page', '#767676', '#ffffff', 3],
    ['the focus ring against the page', '#1a1a1a', '#ffffff', 3],
  ])('reads %s at the contrast the guidelines ask for', (_label, ink, ground, minimum) => {
    expect(contrastRatio(ink, ground)).toBeGreaterThanOrEqual(minimum);
  });
});

/** WCAG 2.x relative luminance, and the ratio built from it. */
function relativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => {
    const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [red = 0, green = 0, blue = 0] = channels;

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(one: string, other: string): number {
  const [darker = 0, lighter = 0] = [relativeLuminance(one), relativeLuminance(other)].sort(
    (a, b) => a - b,
  );

  return (lighter + 0.05) / (darker + 0.05);
}

describe('the CSS modules', () => {
  const modules = globSync('src/**/*.module.css', { cwd: REPO_ROOT }).sort();

  it('finds the stylesheets it is checking', () => {
    // A glob that quietly matched nothing would make the assertion below
    // vacuous, which is the one way this file could fail open.
    expect(modules.length).toBeGreaterThan(20);
  });

  it.each(modules)('%s leaves the control palette to `index.css`', (modulePath) => {
    // Lower-cased because CSS does not care and `toContain` does: `#0B5CAB`
    // would otherwise walk straight past this.
    const stylesheet = readFileSync(join(REPO_ROOT, modulePath), 'utf8').toLowerCase();

    for (const colour of CONTROL_ONLY_COLOURS) {
      expect(stylesheet).not.toContain(colour);
    }
  });
});
