/**
 * Foodbank preference-rule workbook. Paste into Extensions > Apps Script.
 * This deliberately handles only the Rules tab; questionnaire authoring waits
 * for the outstanding charity decision.
 */
const RULES_SHEET = 'Rules';
const GENERATED_SHEET = 'Generated Rules JSON';
const HEADER_ROW = 1;
const HEADING_ROW = 2;
const FIRST_DATA_ROW = 3;
const NEEDS_ATTENTION = 'Needs team-leader attention';
const COLUMNS = [
  ['questionKey', 'Preference key'],
  ['answer', 'Answer (optional)'],
  ['outcome', 'Outcome'],
  ['people', 'People'],
  ['atLeast', 'At least'],
  ['stock', 'Stock item'],
  ['quantity', 'Quantity'],
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Foodbank rules')
    .addItem('Set up Rules tab', 'setupRulesSheet')
    .addItem('Generate JSON', 'generateRulesJson')
    .addToUi();
}

/** Creates or repairs the Rules tab. Row 1 keys are hidden and never edited. */
function setupRulesSheet() {
  const sheet = getOrCreateSheet_(RULES_SHEET);
  ensureSize_(sheet, FIRST_DATA_ROW, COLUMNS.length);
  sheet.getRange(HEADER_ROW, 1, 1, COLUMNS.length).setValues([COLUMNS.map(([key]) => key)]);
  sheet.getRange(HEADER_ROW, 1, 1, COLUMNS.length).setNote('Stable generator keys. Do not edit.');
  sheet
    .getRange(HEADING_ROW, 1, 1, COLUMNS.length)
    .setValues([COLUMNS.map(([, heading]) => heading)]);
  sheet.getRange(HEADING_ROW, 1, 1, COLUMNS.length).setFontWeight('bold').setBackground('#d9eaf7');
  sheet.setFrozenRows(HEADING_ROW);
  sheet.hideRows(HEADER_ROW);
  sheet.autoResizeColumns(1, COLUMNS.length);
  const dataRows = Math.max(sheet.getMaxRows() - FIRST_DATA_ROW + 1, 1);
  setListValidation_(sheet, 'outcome', ['Case', 'Otherwise'], dataRows);
  setListValidation_(sheet, 'people', ['Adults', 'Children', 'Total'], dataRows);
  setListValidation_(
    sheet,
    'quantity',
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', NEEDS_ATTENTION],
    dataRows,
  );
}

/** Validates the Rules tab and writes the pretty-printed client JSON to another tab. */
function generateRulesJson() {
  const result = parseRules_();
  if (result.errors.length > 0) {
    SpreadsheetApp.getUi().alert(
      'The rules were not generated',
      result.errors.map((error) => `• ${error}`).join('\n'),
      SpreadsheetApp.getUi().ButtonSet.OK,
    );
    return;
  }
  const output = JSON.stringify({ rules: result.rules }, null, 2);
  const sheet = getOrCreateSheet_(GENERATED_SHEET);
  ensureSize_(sheet, 2, 1);
  sheet
    .getRange('A1')
    .setValue('Copy this JSON into preference-rules.config.json')
    .setFontWeight('bold')
    .setBackground('#d9eaf7');
  sheet.getRange('A2').setValue(output).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sheet.setColumnWidth(1, 720);
  sheet.setRowHeight(2, Math.min(Math.max(180, output.split('\n').length * 18), 800));
  SpreadsheetApp.getUi().alert(
    'Rules JSON generated',
    'Check the expanded JSON, then copy it into the client configuration.',
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

function parseRules_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(RULES_SHEET);
  if (sheet === null) return { rules: [], errors: [`The ${RULES_SHEET} tab does not exist.`] };
  const headerErrors = validateHeaders_(sheet);
  if (headerErrors.length > 0) return { rules: [], errors: headerErrors };
  if (sheet.getLastRow() < FIRST_DATA_ROW)
    return { rules: [], errors: ['Add at least one rule row.'] };

  const rows = sheet
    .getRange(FIRST_DATA_ROW, 1, sheet.getLastRow() - FIRST_DATA_ROW + 1, COLUMNS.length)
    .getDisplayValues();
  const errors = [];
  const rules = [];
  let rule = null;
  let outcome = null;

  function finishRule() {
    if (rule === null) return;
    if (rule.otherwise === null)
      errors.push(`Rule starting on row ${rule.row}: every rule needs an Otherwise outcome.`);
    [...rule.cases, rule.otherwise].filter(Boolean).forEach((entry) => {
      if (entry.set.length === 0)
        errors.push(`Rule starting on row ${rule.row}: every outcome needs an item.`);
      const seen = new Set();
      entry.set.forEach((line) => {
        if (seen.has(line.stock))
          errors.push(
            `Rule starting on row ${rule.row}: ${line.stock} appears twice in one outcome.`,
          );
        seen.add(line.stock);
      });
    });
    rules.push(rule);
  }

  rows.forEach((row, index) => {
    const line = Object.fromEntries(
      COLUMNS.map(([key], column) => [key, String(row[column] || '').trim()]),
    );
    if (Object.values(line).every((value) => value === '')) return;
    const rowNumber = FIRST_DATA_ROW + index;
    if (line.questionKey !== '') {
      finishRule();
      rule = { row: rowNumber, when: { key: line.questionKey }, cases: [], otherwise: null };
      if (line.answer !== '') rule.when.hasAnswer = line.answer;
      outcome = null;
    } else if (rule === null) {
      errors.push(`Row ${rowNumber}: the first rule row must name a preference key.`);
      return;
    } else if (line.answer !== '') {
      errors.push(
        `Row ${rowNumber}: repeat the preference key when starting a rule with a different answer.`,
      );
    }

    if (line.outcome !== '') {
      if (line.outcome === 'Case') {
        if (rule.otherwise !== null)
          errors.push(`Row ${rowNumber}: a Case cannot follow Otherwise in the same rule.`);
        const people = { Adults: 'adults', Children: 'children', Total: 'total' }[line.people];
        const atLeast = Number(line.atLeast);
        if (people === undefined)
          errors.push(`Row ${rowNumber}: Case needs People: Adults, Children or Total.`);
        if (line.atLeast === '' || !Number.isInteger(atLeast) || atLeast < 0)
          errors.push(
            `Row ${rowNumber}: Case needs a whole-number At least value of zero or more.`,
          );
        outcome =
          people === undefined || line.atLeast === '' || !Number.isInteger(atLeast) || atLeast < 0
            ? null
            : { familySize: { people, atLeast }, set: [] };
        if (outcome !== null) rule.cases.push(outcome);
      } else if (line.outcome === 'Otherwise') {
        if (line.people !== '' || line.atLeast !== '')
          errors.push(`Row ${rowNumber}: Otherwise cannot have People or At least values.`);
        if (rule.otherwise !== null)
          errors.push(`Row ${rowNumber}: a rule can have only one Otherwise outcome.`);
        outcome = { set: [] };
        rule.otherwise = outcome;
      } else {
        errors.push(`Row ${rowNumber}: Outcome must be Case or Otherwise.`);
        outcome = null;
      }
    } else {
      if (outcome === null) errors.push(`Row ${rowNumber}: start the rule with Case or Otherwise.`);
      if (line.people !== '' || line.atLeast !== '')
        errors.push(
          `Row ${rowNumber}: leave People and At least blank when adding another item to the same outcome.`,
        );
    }

    if (line.stock === '') errors.push(`Row ${rowNumber}: Stock item is required.`);
    if (line.quantity === '') errors.push(`Row ${rowNumber}: Quantity is required.`);
    const quantity = line.quantity === NEEDS_ATTENTION ? -1 : Number(line.quantity);
    if (
      line.quantity !== '' &&
      quantity !== -1 &&
      (!Number.isInteger(quantity) || quantity < 1 || quantity > 10)
    )
      errors.push(`Row ${rowNumber}: Quantity must be 1 to 10 or ${NEEDS_ATTENTION}.`);
    if (
      outcome !== null &&
      line.stock !== '' &&
      line.quantity !== '' &&
      (quantity === -1 || (Number.isInteger(quantity) && quantity >= 1 && quantity <= 10))
    )
      outcome.set.push({ stock: line.stock, quantity });
  });
  finishRule();
  return {
    rules: errors.length === 0 ? rules.map(({ row, ...rule }) => rule) : [],
    errors: errors.length === 0 && rules.length === 0 ? ['Add at least one rule row.'] : errors,
  };
}

function validateHeaders_(sheet) {
  const headers = sheet.getRange(HEADER_ROW, 1, 1, COLUMNS.length).getDisplayValues()[0];
  return COLUMNS.flatMap(([key], index) =>
    headers[index] === key
      ? []
      : [`Rules row 1 column ${index + 1} must be ${key}. Run Set up Rules tab to repair it.`],
  );
}

function getOrCreateSheet_(name) {
  const spreadsheet = SpreadsheetApp.getActive();
  return spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
}

function setListValidation_(sheet, key, values, rows) {
  const column = COLUMNS.findIndex(([columnKey]) => columnKey === key) + 1;
  sheet
    .getRange(FIRST_DATA_ROW, column, rows, 1)
    .setDataValidation(
      SpreadsheetApp.newDataValidation()
        .requireValueInList(values, true)
        .setAllowInvalid(false)
        .build(),
    );
}

function ensureSize_(sheet, rows, columns) {
  if (sheet.getMaxRows() < rows)
    sheet.insertRowsAfter(sheet.getMaxRows(), rows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < columns)
    sheet.insertColumnsAfter(sheet.getMaxColumns(), columns - sheet.getMaxColumns());
}
