import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/*
 * **A longer timeout, because the work really is that slow.**
 *
 * The first `lintFiles` call pays for typescript-eslint's `projectService`
 * building a TypeScript program over the whole app project — seconds of genuine
 * work, not a hang — and this file competes with every other test file for CPU.
 * The 5s default is ample when it runs alone and not enough under full parallel
 * load, which is exactly how this presented: an intermittent failure that always
 * passed in isolation and so read as flakiness rather than as a limit set too
 * low. Raising it is the honest fix; retrying or skipping would hide a rule that
 * had genuinely stopped firing, which is the one thing this file exists to
 * catch.
 */
vi.setConfig({ testTimeout: 30_000 });

/**
 * Tests the lint config, not the app.
 *
 * Several rules in `eslint.config.js` exist to turn CLAUDE.md prose into
 * something the build enforces. Each guards a failure that is silent when it
 * happens: personal data written to a shared laptop, every session shown in the
 * wrong timezone, a component bypassing the single-flight refresh. A rule that
 * stops firing — because a plugin changed shape, a selector went stale, or a
 * peer range moved — fails open, and nothing else here would notice.
 *
 * `jsx-a11y` in particular is pinned past its declared eslint peer range (see
 * the note in package.json). This is what makes that override a verified claim
 * rather than an assumption.
 *
 * Two things about the fixtures, both forced rather than chosen:
 *
 * - They are **real files**, because the config uses typescript-eslint's
 *   `projectService`. It resolves each file to the tsconfig that includes it, so
 *   source passed to `lintText` under a path that does not exist is a parse
 *   error, not a lint result.
 * - They sit at **realistic paths**, because the import rule keys on the path: a
 *   feature's `queries.ts` may reach the API client and a component under that
 *   feature may not. A fixture parked somewhere convenient would test nothing.
 *
 * They are removed afterwards, and gitignored so a crashed run cannot commit
 * one. A leftover fixture breaks `npm run lint` loudly, which is the right
 * failure mode.
 */

const FIXTURES = {
  writesToDisk: 'src/features/lint-fixture/components/draft.tsx',
  formatsLocally: 'src/features/lint-fixture/components/row.tsx',
  componentImportsClient: 'src/features/lint-fixture/components/list.tsx',
  queriesImportsClient: 'src/features/lint-fixture/queries.ts',
  apiLayerImportsClient: 'src/api/lint-fixture.ts',
  inaccessibleImage: 'src/components/lint-fixture-logo.tsx',
  nonErasableSyntax: 'src/lib/lint-fixture-status.ts',
  workerImportsApp: 'src/worker/lint-fixture-proxy.ts',
  appImportsWorker: 'src/lib/lint-fixture-proxy.ts',
} as const;

const SOURCES: Record<string, string> = {
  [FIXTURES.writesToDisk]: `export function Draft() {
  localStorage.setItem('draft', 'a name and an address');
  return null;
}
`,
  [FIXTURES.formatsLocally]: `export function Row({ at }: { at: Date }) {
  return <span>{at.toLocaleDateString()}</span>;
}
`,
  [FIXTURES.componentImportsClient]: `import { api } from '../../../api/client';

export const list = api;
`,
  [FIXTURES.queriesImportsClient]: `import { api } from '../../api/client';

export const list = api;
`,
  [FIXTURES.apiLayerImportsClient]: `import { api } from './client';

export const list = api;
`,
  [FIXTURES.inaccessibleImage]: `export function Logo() {
  return <img src="/logo.png" />;
}
`,
  [FIXTURES.nonErasableSyntax]: `export enum Status {
  Draft,
  Printed,
}
`,
  [FIXTURES.workerImportsApp]: `import { api } from '../api/client';

export const forward = api;
`,
  [FIXTURES.appImportsWorker]: `import proxy from '../worker/index';

export const forward = proxy;
`,
};

/** Removed in full afterwards. Order matters: deepest first. */
const CLEANUP = [
  'src/features/lint-fixture',
  FIXTURES.apiLayerImportsClient,
  FIXTURES.inaccessibleImage,
  FIXTURES.nonErasableSyntax,
  FIXTURES.workerImportsApp,
  FIXTURES.appImportsWorker,
];

let eslint: ESLint;

beforeAll(() => {
  // Written before the ESLint instance exists, so the project service sees them.
  for (const [path, source] of Object.entries(SOURCES)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source, 'utf8');
  }
  eslint = new ESLint({ cwd: process.cwd() });
});

afterAll(() => {
  for (const path of CLEANUP) rmSync(path, { recursive: true, force: true });
});

async function rulesFiredIn(path: string): Promise<string[]> {
  const results = await eslint.lintFiles([path]);
  return (results[0]?.messages ?? []).map((message) => message.ruleId ?? message.message);
}

describe('lint rules that enforce the charter', () => {
  it('refuses to let anything be written to disk', async () => {
    expect(await rulesFiredIn(FIXTURES.writesToDisk)).toContain('no-restricted-globals');
  });

  it('refuses date formatting that silently uses the device timezone', async () => {
    expect(await rulesFiredIn(FIXTURES.formatsLocally)).toContain('no-restricted-syntax');
  });

  it('refuses a component reaching past its feature queries to the API client', async () => {
    expect(await rulesFiredIn(FIXTURES.componentImportsClient)).toContain('no-restricted-imports');
  });

  it('still lets a feature queries module and the api layer import the client', async () => {
    // The rule has to permit the data boundary, or it only moves the problem.
    expect(await rulesFiredIn(FIXTURES.queriesImportsClient)).not.toContain(
      'no-restricted-imports',
    );
    expect(await rulesFiredIn(FIXTURES.apiLayerImportsClient)).not.toContain(
      'no-restricted-imports',
    );
  });

  it('still catches an accessibility violation, despite the pinned eslint peer', async () => {
    expect(await rulesFiredIn(FIXTURES.inaccessibleImage)).toContain('jsx-a11y/alt-text');
  });

  it('refuses syntax that is not erasable', async () => {
    expect(await rulesFiredIn(FIXTURES.nonErasableSyntax)).toContain('no-restricted-syntax');
  });

  it('keeps the app and the proxy Worker from importing each other', async () => {
    // Two tsconfig projects already stop the DOM and Workers types mixing, but
    // only after someone runs a build. This fails at the import.
    expect(await rulesFiredIn(FIXTURES.workerImportsApp)).toContain('no-restricted-imports');
    expect(await rulesFiredIn(FIXTURES.appImportsWorker)).toContain('no-restricted-imports');
  });
});
