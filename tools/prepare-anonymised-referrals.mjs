#!/usr/bin/env node

/**
 * Turns a legacy Google Forms referral export into safe, current-form payloads.
 *
 * This tool intentionally only prepares data.  The public referral endpoint is
 * not an import API: it is rate limited and, in deployed environments, guarded
 * by single-use Turnstile tokens.  A separate, privileged dev/test ingestion
 * route must consume the JSON produced here.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');
const defaultQuestionnairePath = resolve(
  projectRoot,
  'src/features/referrals/referral-form.config.json',
);

const sourceHeaders = {
  timestamp: 'Timestamp',
  adults: 'Number of adults in clients family',
  children: "Number of children in client's family",
  age0To2: 'Number of children in each age bracket (if unknown tick 0) [Age 0-2]',
  age3To4: 'Number of children in each age bracket (if unknown tick 0) [Age 3-4]',
  age5To11: 'Number of children in each age bracket (if unknown tick 0) [Age 5-11]',
  age12To17: 'Number of children in each age bracket (if unknown tick 0) [Age 12-17]',
  sessionPreference:
    'Which branch and sessions would the client prefer to collect/ have a delivery from?',
  deliveryEligibility:
    'Is the client eligible for delivery? (Housebound or Covid positive ONLY.) Otherwise clients must make their own arrangements. Someone else can collect on their behalf.',
  collection: 'How will the parcel be collected?',
  pastaRice: 'Would they prefer pasta or rice?',
  sugarFlour: 'Would they like flour or sugar?',
  spread:
    'What would be their preference of spread (Please only select 1 spread if 1-2 peopleand 2 spreads if 3 or more in household)',
  teaCoffee: 'Would they prefer tea, coffee or hot chocolate?',
  porridge: 'Would they like porridge oats?',
  eggs: 'Would they like eggs?',
  toiletries:
    'Please select which THREE toiletries they require most. We give everyone toilet roll.',
  household: 'Please select which THREE household items they require most.',
  householdDuplicate: 'Please select which THREE household items they require most.',
  nappies: 'Do they require nappies?',
  nappySize: 'What size nappies do they require?',
  babyFood: 'Do they require baby food?',
  babyMilk: 'Do they require baby milk?',
  babyMilkType: 'What type of baby milk do they require?',
  petFood:
    "Would they like cat/ dog food? (Please state number of cats/ dogs in 'other' free text box.) Please note we do not have other types of pet food.",
  sanitary: 'Would they like sanitary products?',
  deliveryComment: 'Details of query',
};

function normalise(value) {
  return value
    .replace(/^\uFEFF/, '')
    .toLocaleLowerCase('en-GB')
    .replaceAll('\u00a0', ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sourceValue(row, header) {
  return row.get(normalise(header))?.trim() ?? '';
}

function isYes(value) {
  return /^(yes|y|true|required|delivery)$/i.test(value.trim());
}

function splitChoices(value) {
  return value
    .split(/\s*,\s*|\s*;\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

function isOmittedLegacyDefault(value) {
  const source = normalise(value);
  return (
    ['no', 'none', 'no preference', 'dont mind', 'does not mind', 'either'].includes(source) ||
    source.includes('standard parcel') ||
    source.includes('unless specified')
  );
}

function count(value) {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 30 ? parsed : 0;
}

/** Parses RFC 4180-style CSV without treating a quoted newline as a row break. */
export function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell]);
  return rows;
}

function questionnaireChoices(questionnaire) {
  return new Map(
    questionnaire.pages
      .flatMap((page) => page.questions)
      .filter((question) => question.questionKey !== undefined && question.answers !== undefined)
      .map((question) => [
        question.questionKey,
        { options: question.answers, answerMax: question.validation?.answerMax ?? 1 },
      ]),
  );
}

function chooseExisting(value, options) {
  const byNormalised = new Map(options.map((option) => [normalise(option), option]));
  const exact = splitChoices(value).flatMap((choice) => {
    const selected = byNormalised.get(normalise(choice));
    return selected === undefined ? [] : [selected];
  });
  if (exact.length > 1 && options.includes('Both')) return ['Both'];
  if (exact.length > 0) return exact;
  const source = normalise(value);
  if (isOmittedLegacyDefault(value)) return [];
  const matched = options.filter((option) => {
    const candidate = normalise(option);
    return new RegExp(`(^| )${candidate.replaceAll(' ', '\\s+')}( |$)`).test(source);
  });
  if (matched.length > 1 && options.includes('Both')) return ['Both'];
  return matched;
}

function setChoices(answers, report, rowNumber, key, source, question) {
  if (source === '') return;
  if (question === undefined) {
    report.unresolved.push({ row: rowNumber, source: key, reason: 'current question is absent' });
    return;
  }
  const selected = chooseExisting(source, question.options);
  if (selected.length === 0) {
    if (isOmittedLegacyDefault(source)) return;
    report.unresolved.push({ row: rowNumber, source: key, reason: 'no current option matches' });
    return;
  }
  if (selected.length > question.answerMax) {
    report.unresolved.push({
      row: rowNumber,
      source: key,
      reason: 'more answers than the current question allows',
    });
    return;
  }
  answers[key] = question.answerMax === 1 ? selected[0] : selected;
}

function householdComposition(row) {
  const infants =
    count(sourceValue(row, sourceHeaders.age0To2)) + count(sourceValue(row, sourceHeaders.age3To4));
  const schoolAge = count(sourceValue(row, sourceHeaders.age5To11));
  const teenagers = count(sourceValue(row, sourceHeaders.age12To17));
  const adults = count(sourceValue(row, sourceHeaders.adults));
  const composition = {};
  if (infants > 0) composition['0-4'] = { female: infants };
  if (schoolAge > 0) composition['5-11'] = { female: schoolAge };
  if (teenagers > 0) composition['12-17'] = { female: teenagers };
  if (adults > 0) composition['working-age'] = { female: adults };
  return composition;
}

function collectionMethod(row) {
  return /\bdelivery\b/i.test(sourceValue(row, sourceHeaders.deliveryComment))
    ? 'delivery'
    : 'collection';
}

function mapPreferences(row, answers, choices, report, rowNumber) {
  const exact = [
    ['Pasta/Rice', sourceHeaders.pastaRice],
    ['Sugar/Flour', sourceHeaders.sugarFlour],
    ['Spread', sourceHeaders.spread],
    ['Tea/Coffee', sourceHeaders.teaCoffee],
    ['Porridge', sourceHeaders.porridge],
    ['Eggs', sourceHeaders.eggs],
    ['Toiletries', sourceHeaders.toiletries],
    ['Household', sourceHeaders.household],
  ];
  for (const [key, header] of exact)
    setChoices(answers, report, rowNumber, key, sourceValue(row, header), choices.get(key));

  const sanitary = sourceValue(row, sourceHeaders.sanitary);
  if (sanitary !== '') {
    const normalised = normalise(sanitary);
    if (normalised.includes('tampon')) answers.Tampons = '1';
    if (normalised.includes('pad') || normalised.includes('towel')) answers['Sanitary Pads'] = '1';
    if (normalised.includes('incontinence')) answers['Incontinence products'] = '1';
    if (
      !normalised.includes('tampon') &&
      !normalised.includes('pad') &&
      !normalised.includes('towel') &&
      !normalised.includes('incontinence')
    )
      report.unresolved.push({
        row: rowNumber,
        source: 'sanitary products',
        reason: 'type is not specified',
      });
  }

  const nappySize = sourceValue(row, sourceHeaders.nappySize);
  if (isYes(sourceValue(row, sourceHeaders.nappies)) && nappySize !== '') {
    const size = nappySize.match(/\b([1-8])\b/)?.[1];
    if (size !== undefined) answers.Nappies = [`Nappies - size ${size}`];
    else
      report.unresolved.push({
        row: rowNumber,
        source: 'nappy size',
        reason: 'no current size matches',
      });
  }
  if (isYes(sourceValue(row, sourceHeaders.babyFood))) answers['Baby Food'] = 'Yes';
  if (isYes(sourceValue(row, sourceHeaders.babyMilk))) {
    const milk = sourceValue(row, sourceHeaders.babyMilkType);
    const stage = milk.match(/stage\s*([12])/i)?.[1];
    if (stage !== undefined) answers['Baby Milk'] = [`Baby formula - Stage ${stage}`];
    else
      report.unresolved.push({
        row: rowNumber,
        source: 'baby milk',
        reason: 'stage is not specified',
      });
  }

  const petFood = normalise(sourceValue(row, sourceHeaders.petFood));
  if (petFood.includes('cat') && !petFood.includes('no cat')) answers['Cat food'] = 'Both';
  if (petFood.includes('dog') && !petFood.includes('no dog')) answers['Dog food'] = 'Both';
}

/**
 * Converts timestamped legacy rows only. Source identifiers and free text never
 * reach a returned payload or report.
 */
export function prepareReferrals({ csv, questionnaire }) {
  const rows = parseCsv(csv);
  const [headers = [], ...dataRows] = rows;
  const normalisedHeaders = headers.map(normalise);
  if (!normalisedHeaders.includes(normalise(sourceHeaders.timestamp)))
    throw new Error(
      'The CSV has no Timestamp column, so it is not a recognised legacy referral export.',
    );
  const choices = questionnaireChoices(questionnaire);
  const report = { sourceRows: 0, prepared: 0, assumptions: [], unresolved: [] };
  const referrals = [];

  for (const [index, cells] of dataRows.entries()) {
    const row = new Map(normalisedHeaders.map((header, column) => [header, cells[column] ?? '']));
    if (sourceValue(row, sourceHeaders.timestamp) === '') continue;
    const rowNumber = index + 2;
    report.sourceRows += 1;
    const composition = householdComposition(row);
    if (composition['12-17'] === undefined && composition['working-age'] === undefined) {
      composition['working-age'] = { female: 1 };
      report.assumptions.push({
        row: rowNumber,
        source: 'household size',
        value: 'one synthetic adult',
      });
    }
    const answers = {
      gender: 'Female',
      ethnicity: 'White -British',
      'source of income': 'Benefits',
      'Household Components': composition,
      'Cooking Facility': ['Oven'],
    };
    mapPreferences(row, answers, choices, report, rowNumber);
    const ordinal = referrals.length + 1;
    const adults = (composition['12-17']?.female ?? 0) + (composition['working-age']?.female ?? 0);
    const children = composition['5-11']?.female ?? 0;
    referrals.push({
      referrerName: `referrer${ordinal}`,
      referrerEmail: `referrer${ordinal}@example.test`,
      referrerOrganisation: 'Test organisation',
      referrerPhone: `00000000${String(ordinal).padStart(2, '0')}`,
      refereeFirstName: `name${ordinal}`,
      refereeSurname: `surname${ordinal}`,
      refereeDateOfBirth: '1980-01-01',
      refereeAddress: `${ordinal} Test Street`,
      refereePostcode: `TE1 ${String(ordinal).padStart(1, '0')}ST`,
      refereePhone: `00000001${String(ordinal).padStart(2, '0')}`,
      adults: Math.max(1, adults),
      children,
      collectionMethod: collectionMethod(row),
      needsFuelHelp: false,
      answers,
    });
  }
  report.prepared = referrals.length;
  return { referrals, report };
}

function usage() {
  return 'Usage: node tools/prepare-anonymised-referrals.mjs --file LEGACY.csv [--questionnaire FILE]\n\nProduces an anonymised, system-independent scenario file as JSON on stdout. It never sends data.\n';
}

function argumentsFrom(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') return { help: true };
    if (!['--file', '--questionnaire'].includes(argument))
      throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`Missing value for ${argument}`);
    values[argument.slice(2)] = value;
    index += 1;
  }
  return values;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = argumentsFrom(process.argv.slice(2));
    if (arguments_.help) process.stdout.write(usage());
    else {
      if (arguments_.file === undefined) throw new Error(usage());
      const questionnairePath = arguments_.questionnaire ?? defaultQuestionnairePath;
      const result = prepareReferrals({
        csv: readFileSync(arguments_.file, 'utf8'),
        questionnaire: JSON.parse(readFileSync(questionnairePath, 'utf8')),
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
