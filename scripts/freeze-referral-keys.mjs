/*
 * Appends newly added referral-form answer keys to the frozen ledger.
 *
 * The charity changes `referral-form.config.json`. Every answer key that config
 * has ever released is recorded in `referral-answer-keys.frozen.ts`, and the
 * `unrecordedKeys` guard fails `npm run check` when the two disagree. This is
 * what does that recording, so adding a question is not a hand edit.
 *
 *   npm run form:freeze          append what is missing
 *   npm run form:freeze:check    report only, change nothing, exit 1 if behind
 *
 * WHAT IT WILL NOT DO, because the ledger's whole value is that it remembers
 * what a key used to mean:
 *
 *   - It never edits or removes an existing line. Retiring a question is a
 *     config change and nothing else; the key stays recorded.
 *   - It refuses outright when a key already in the ledger comes back as a
 *     different kind of question. That is the silent meaning-change `reusedKeys`
 *     exists to catch, and it needs a person, not an append.
 *
 * What no script can catch: a retired key reused for a NEW question of the SAME
 * type. Two free-text questions are indistinguishable to a machine, so this
 * prints "read the diff" after every write and means it.
 *
 * **The question list comes from the app's own parser, through Vite.** The
 * mapping from `validation.type` to a field type is spoken once, in
 * `referral-form-config.ts`, and a second copy here would drift the first time
 * a validation type is added. Loading it through Vite rather than a bundler of
 * this script's own choosing also means the resolution, the TypeScript and the
 * JSON import all behave exactly as they do in the app — and Vite is a declared
 * dependency, which esbuild underneath it is not.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';

const LEDGER = 'src/features/referrals/referral-answer-keys.frozen.ts';
const CONFIG_MODULE = '/src/features/referrals/referral-form-config.ts';
const DEFINITION_MODULE = '/src/features/referrals/referral-form-definition.ts';

const checkOnly = process.argv.includes('--check');

function fail(message) {
  console.error(`form:freeze — ${message}`);
  process.exit(1);
}

/** The live questions, straight from the app's own definition. */
async function liveQuestions() {
  // `configFile: false` keeps the Cloudflare and React plugins out of it: this
  // needs module resolution and transforms, not an app.
  const vite = await createServer({
    configFile: false,
    logLevel: 'warn',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const { referralFormDefinition } = await vite.ssrLoadModule(CONFIG_MODULE);
    const { dynamicQuestions } = await vite.ssrLoadModule(DEFINITION_MODULE);
    return dynamicQuestions(referralFormDefinition).map(({ key, type }) => ({ key, type }));
  } finally {
    await vite.close();
  }
}

/*
 * Existing entries are read from the source text rather than by importing it.
 * The file is maintained by appending text, so the text is what has to be
 * understood — and a parse that silently found nothing would look exactly like
 * an empty ledger, which is why zero entries is an error below.
 */
function ledgerEntries(source) {
  const body = source.slice(source.indexOf('FROZEN_ANSWER_KEYS'));
  const pattern = /\{\s*key:\s*'((?:[^'\\]|\\.)*)',\s*type:\s*'([a-zA-Z]+)'\s*\}/g;
  const entries = [];
  let match;
  while ((match = pattern.exec(body)) !== null) {
    entries.push({ key: match[1].replace(/\\'/g, "'"), type: match[2] });
  }
  return entries;
}

function quote(key) {
  return `'${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

const questions = await liveQuestions();
const source = readFileSync(LEDGER, 'utf8');
const recorded = new Map(ledgerEntries(source).map((entry) => [entry.key, entry.type]));

if (recorded.size === 0) fail(`could not read any entries from ${LEDGER} — has its shape changed?`);

const conflicts = questions.filter(
  (question) => recorded.has(question.key) && recorded.get(question.key) !== question.type,
);

if (conflicts.length > 0) {
  console.error('Refusing to change anything. These keys are already recorded as a different kind');
  console.error('of question, which would silently change what every old referral meant:\n');
  for (const { key, type } of conflicts) {
    console.error(`  ${key}: recorded as ${recorded.get(key)}, the form now asks it as ${type}`);
  }
  console.error('\nGive the new question its own key, or restore the old question type.');
  process.exit(1);
}

const missing = questions.filter((question) => !recorded.has(question.key));

if (missing.length === 0) {
  console.log(`form:freeze — nothing to do, all ${questions.length} answer keys are recorded.`);
  process.exit(0);
}

console.log(`${missing.length} key${missing.length === 1 ? '' : 's'} to freeze:`);
for (const { key, type } of missing) console.log(`  ${key} (${type})`);

if (checkOnly) {
  console.log('\n--check: nothing written. Run `npm run form:freeze` to append these.');
  process.exit(1);
}

const closing = source.lastIndexOf('\n];');
if (closing === -1) fail(`could not find the end of FROZEN_ANSWER_KEYS in ${LEDGER}.`);

const today = new Date().toISOString().slice(0, 10);
const addition = [
  '',
  `  // Added ${today}.`,
  ...missing.map(({ key, type }) => `  { key: ${quote(key)}, type: '${type}' },`),
].join('\n');

writeFileSync(LEDGER, source.slice(0, closing) + addition + source.slice(closing), 'utf8');

console.log(`\nAppended to ${LEDGER}.`);
console.log('Read the diff — a key reused for a new question of the same type looks exactly like');
console.log('a new one here. Then run `npm run check`.');
