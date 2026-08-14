#!/usr/bin/env node

/**
 * Imports reviewed questionnaire JSON into the Foodbank client.
 *
 * Run via ~/bin/import-foodbank-questionnaire. This script deliberately owns
 * the config/ledger pair: the server has no form definition to validate an
 * answer key against, so changing one without the other can reinterpret an
 * old referral.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultProjectRoot = process.env.FOODBANK_CLIENT_ROOT ?? resolve(scriptDirectory, '..');
const configPathFrom = (projectRoot) =>
  resolve(projectRoot, 'src/features/referrals/referral-form.config.json');
const ledgerPathFrom = (projectRoot) =>
  resolve(projectRoot, 'src/features/referrals/referral-answer-keys.frozen.ts');

const validationTypes = new Map([
  ['String', 'text'],
  ['Number', 'number'],
  ['CheckBox', 'choice'],
  ['HouseholdComposition', 'householdComposition'],
]);

export function dynamicQuestionEntries(config) {
  if (!isRecord(config) || !Array.isArray(config.pages)) {
    throw new Error('The questionnaire must be an object with a pages array.');
  }

  return config.pages.flatMap((page) => {
    if (!isRecord(page) || !Array.isArray(page.questions)) {
      throw new Error('Every questionnaire page must have a questions array.');
    }

    return page.questions.flatMap((question) => {
      if (!isRecord(question) || typeof question.questionKey !== 'string' || question.keyField) {
        return [];
      }
      if (!isRecord(question.validation) || typeof question.validation.type !== 'string') {
        throw new Error(
          `Question ${JSON.stringify(question.questionKey)} has no recognised validation type.`,
        );
      }
      const type = validationTypes.get(question.validation.type);
      if (type === undefined) {
        throw new Error(
          `Question ${JSON.stringify(question.questionKey)} uses unsupported validation type ${JSON.stringify(question.validation.type)}.`,
        );
      }
      return [{ key: question.questionKey, type }];
    });
  });
}

export function parseFrozenAnswerKeys(source) {
  const entries = new Map();
  const entryPattern =
    /\{ key: '((?:\\.|[^'])*)', type: '(text|number|choice|householdComposition)' \}/g;
  for (const match of source.matchAll(entryPattern)) {
    const [, encodedKey, type] = match;
    if (encodedKey === undefined || type === undefined) continue;
    const key = unescapeTypeScriptString(encodedKey);
    if (entries.has(key))
      throw new Error(
        `The frozen answer-key ledger records ${JSON.stringify(key)} more than once.`,
      );
    entries.set(key, type);
  }
  if (entries.size === 0)
    throw new Error('Could not read any entries from the frozen answer-key ledger.');
  return entries;
}

export function newFrozenEntries(questionEntries, frozenEntries) {
  const newEntries = [];
  const seen = new Set();
  for (const entry of questionEntries) {
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    const frozenType = frozenEntries.get(entry.key);
    if (frozenType !== undefined && frozenType !== entry.type) {
      throw new Error(
        `Refusing to import ${JSON.stringify(entry.key)}: it was released as ${frozenType}, not ${entry.type}.`,
      );
    }
    if (frozenType === undefined) newEntries.push(entry);
  }
  return newEntries;
}

export function appendFrozenEntries(source, entries) {
  if (entries.length === 0) return source;
  const marker = '\n];';
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error('Could not find the end of the frozen answer-key ledger.');
  const lines = entries.map(
    (entry) => `  { key: ${typeScriptString(entry.key)}, type: '${entry.type}' },`,
  );
  return `${source.slice(0, index)}\n${lines.join('\n')}${source.slice(index)}`;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function typeScriptString(value) {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('\n', '\\n')}'`;
}

function unescapeTypeScriptString(value) {
  return value.replaceAll('\\n', '\n').replaceAll("\\'", "'").replaceAll('\\\\', '\\');
}

function readInput(argument) {
  if (argument === undefined) {
    try {
      return execFileSync('pbpaste', { encoding: 'utf8' });
    } catch {
      throw new Error('Could not read the clipboard. Pass the JSON file path instead.');
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
  const temporaryPath = `${path}.import-questionnaire-${process.pid}`;
  writeFileSync(temporaryPath, content);
  renameSync(temporaryPath, path);
}

function importQuestionnaire({ input, projectRoot = defaultProjectRoot }) {
  const configPath = configPathFrom(projectRoot);
  const ledgerPath = ledgerPathFrom(projectRoot);
  let config;
  try {
    config = JSON.parse(input);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`The questionnaire is not valid JSON: ${detail}`, { cause: error });
  }

  const questionEntries = dynamicQuestionEntries(config);
  const originalConfig = readFileSync(configPath, 'utf8');
  const originalLedger = readFileSync(ledgerPath, 'utf8');
  const newEntries = newFrozenEntries(questionEntries, parseFrozenAnswerKeys(originalLedger));
  const nextConfig = `${JSON.stringify(config, null, 2)}\n`;
  const nextLedger = appendFrozenEntries(originalLedger, newEntries);

  try {
    writeAtomically(configPath, nextConfig);
    writeAtomically(ledgerPath, nextLedger);
    run('npx', ['prettier', '--write', configPath, ledgerPath], projectRoot);
    run(
      'npx',
      ['vitest', 'run', 'src/features/referrals/referral-form-config.test.ts'],
      projectRoot,
    );
  } catch (error) {
    writeAtomically(configPath, originalConfig);
    writeAtomically(ledgerPath, originalLedger);
    throw error;
  }

  process.stdout.write(
    `Imported questionnaire into ${configPath}. ${newEntries.length === 0 ? 'No new answer keys.' : `Added ${newEntries.length} answer key${newEntries.length === 1 ? '' : 's'} to the frozen ledger.`}\nRun npm run check and release the client when the reviewed change is ready to publish.\n`,
  );
}

function usage() {
  return 'Usage: import-foodbank-questionnaire [reviewed-questionnaire.json]\nWithout a file path, imports JSON from the macOS clipboard.\n';
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
      importQuestionnaire({ input: readInput(argument) });
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
}
