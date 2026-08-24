#!/usr/bin/env node

/**
 * Imports reviewed preference-rule JSON into the Foodbank client.
 *
 * Run via ~/bin/import-foodbank-preference-rules. The Rules Sheet validates
 * authoring syntax; this importer independently validates the client JSON
 * before it can replace the released configuration.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = process.env.FOODBANK_CLIENT_ROOT ?? resolve(scriptDirectory, '..');
const configPathFrom = (projectRoot) =>
  resolve(projectRoot, 'src/features/pick-lists/preference-rules.config.json');
const referralFormPathFrom = (projectRoot) =>
  resolve(projectRoot, 'src/features/referrals/referral-form.config.json');

export function parsePreferenceRuleConfig(value) {
  if (!isRecord(value) || !Array.isArray(value.rules))
    throw new Error('Rules JSON must be an object with a rules array.');
  value.rules.forEach((rule, index) => validateRule(rule, `Rule ${index + 1}`));
  return value;
}

/** Validates references the local client can know without calling the API. */
export function validatePreferenceRuleReferences(config, referralForm) {
  const preferences = new Map();
  if (isRecord(referralForm) && Array.isArray(referralForm.pages)) {
    for (const page of referralForm.pages) {
      if (!isRecord(page) || !Array.isArray(page.questions)) continue;
      for (const question of page.questions) {
        if (
          isRecord(question) &&
          question.keyField === undefined &&
          question.preference === true &&
          nonEmptyString(question.questionKey)
        ) {
          preferences.set(question.questionKey, question);
        }
      }
    }
  }

  const errors = [];
  for (const rule of config.rules) {
    const question = preferences.get(rule.when.key);
    if (question === undefined) {
      errors.push(`Rule ${rule.when.key}: the preference question does not exist.`);
      continue;
    }
    const answers = Array.isArray(question.answers) ? question.answers : undefined;
    if (
      rule.when.hasAnswer !== undefined &&
      answers !== undefined &&
      !answers.includes(rule.when.hasAnswer)
    ) {
      errors.push(`Rule ${rule.when.key}: ${rule.when.hasAnswer} is not an offered answer.`);
    }
  }
  return errors;
}

function validateRule(rule, path) {
  if (!isRecord(rule) || !isRecord(rule.when) || !nonEmptyString(rule.when.key))
    throw new Error(`${path} needs a non-empty when.key.`);
  if (rule.when.hasAnswer !== undefined && !nonEmptyString(rule.when.hasAnswer))
    throw new Error(`${path} hasAnswer must be a non-empty string when present.`);
  if (rule.when.hasAnswer === '$selectedAnswer')
    throw new Error(`${path} may use $selectedAnswer only as a stock item.`);
  if (rule.cases !== undefined && !Array.isArray(rule.cases))
    throw new Error(`${path} cases must be an array when present.`);
  if (rule.otherwise !== undefined) validateOutcome(rule.otherwise, `${path} otherwise`);
  if (rule.cases === undefined && rule.otherwise === undefined)
    throw new Error(`${path} needs cases and/or otherwise.`);
  if (rule.cases !== undefined && rule.otherwise === undefined)
    throw new Error(`${path} with cases needs otherwise.`);
  rule.cases?.forEach((outcome, index) => {
    if (!isRecord(outcome) || !isRecord(outcome.familySize))
      throw new Error(`${path} case ${index + 1} needs familySize.`);
    const { people, atLeast } = outcome.familySize;
    if (!['adults', 'children', 'total'].includes(people))
      throw new Error(`${path} case ${index + 1} has an invalid familySize.people.`);
    if (!Number.isInteger(atLeast) || atLeast < 0)
      throw new Error(`${path} case ${index + 1} needs a whole-number familySize.atLeast.`);
    validateOutcome(outcome, `${path} case ${index + 1}`);
  });
}

function validateOutcome(outcome, path) {
  if (!isRecord(outcome) || !Array.isArray(outcome.set) || outcome.set.length === 0)
    throw new Error(`${path} needs a non-empty set.`);
  outcome.set.forEach((line, index) => {
    if (!isRecord(line) || !nonEmptyString(line.stock))
      throw new Error(`${path} item ${index + 1} needs a non-empty stock item.`);
    if (
      line.quantity !== -1 &&
      (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 10)
    )
      throw new Error(`${path} item ${index + 1} quantity must be 1 to 10 or -1.`);
  });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function readInput(argument) {
  if (argument === undefined) {
    try {
      return execFileSync('pbpaste', { encoding: 'utf8' });
    } catch {
      throw new Error('Could not read the clipboard. Pass the reviewed JSON file path instead.');
    }
  }
  if (!existsSync(argument)) throw new Error(`Input file does not exist: ${argument}`);
  return readFileSync(argument, 'utf8');
}

function run(command, arguments_, projectRoot) {
  const result = spawnSync(command, arguments_, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${arguments_.join(' ')} failed.`);
}

function writeAtomically(path, content) {
  const temporaryPath = `${path}.import-preference-rules-${process.pid}`;
  writeFileSync(temporaryPath, content);
  renameSync(temporaryPath, path);
}

export function importPreferenceRules({
  input,
  projectRoot = defaultProjectRoot,
  runCommand = run,
}) {
  let config;
  try {
    config = parsePreferenceRuleConfig(JSON.parse(input));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The preference rules are invalid: ${detail}`, { cause: error });
  }
  let referralForm;
  try {
    referralForm = JSON.parse(readFileSync(referralFormPathFrom(projectRoot), 'utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read the local referral form: ${detail}`, { cause: error });
  }
  const referenceErrors = validatePreferenceRuleReferences(config, referralForm);
  if (referenceErrors.length > 0)
    throw new Error(`The preference rules are invalid: ${referenceErrors.join(' ')}`);
  const configPath = configPathFrom(projectRoot);
  const originalConfig = readFileSync(configPath, 'utf8');
  const nextConfig = `${JSON.stringify(config, null, 2)}\n`;
  try {
    writeAtomically(configPath, nextConfig);
    runCommand('npx', ['prettier', '--write', configPath], projectRoot);
    runCommand(
      'npx',
      ['vitest', 'run', 'src/features/pick-lists/preference-rules.config.test.ts'],
      projectRoot,
    );
  } catch (error) {
    writeAtomically(configPath, originalConfig);
    throw error;
  }
  process.stdout.write(
    `Imported preference rules into ${configPath}. Run npm run check and release the client when the reviewed change is ready to publish.\n`,
  );
}

function usage() {
  return 'Usage: import-foodbank-preference-rules [reviewed-preference-rules.json]\nWithout a file path, imports JSON from the macOS clipboard.\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [argument] = process.argv.slice(2);
  if (argument === '--help' || argument === '-h') {
    process.stdout.write(usage());
  } else if (process.argv.length > 3) {
    process.stderr.write(usage());
    process.exitCode = 2;
  } else {
    try {
      importPreferenceRules({ input: readInput(argument) });
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
