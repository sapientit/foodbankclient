const QUESTIONNAIRE_SHEET = 'Referral Form';
const GENERATED_QUESTIONNAIRE_SHEET = 'Generated Questionnaire JSON';
const QUESTIONNAIRE_HEADER_ROW = 5;
const QUESTIONNAIRE_FIRST_DATA_ROW = 6;
const QUESTIONNAIRE_COLUMNS = [
  'Page',
  'Question key',
  'Question wording',
  'Answer format',
  'Selection',
  'Required',
  'Use for picking rules?',
  'Answer / option shown',
  'Default?',
  'Shown when key',
  'Shown when answer',
  'Pick-list information',
  'For Fuel Team',
];
const QUESTIONNAIRE_FORMATS = new Set([
  'Text',
  'Email address',
  'Phone number',
  'Date',
  'UK postcode',
  'Session date',
  'Yes / No',
  'Cause of crisis',
  'Choice list',
  'Organisation',
  'householdComposition',
  'No Answer',
]);
const CLIENT_KEY_FIELDS = new Map([
  ['referrerName', 'Text'],
  ['referrerEmail', 'Email address'],
  ['referrerOrganisation', 'Organisation'],
  ['referrerPhone', 'Phone number'],
  ['refereeFirstName', 'Text'],
  ['refereeSurname', 'Text'],
  ['refereeDateOfBirth', 'Date'],
  ['refereeAddress', 'Text'],
  ['refereePostcode', 'UK postcode'],
  ['refereePhone', 'Phone number'],
  ['sessionId', 'Session date'],
  ['reasonId', 'Cause of crisis'],
  ['needsFuelHelp', 'Yes / No'],
]);
const CLIENT_TEXT_MAX_LENGTH = 500;

/** Call this from the existing Rules script's `onOpen` function. */
function addQuestionnaireMenu_() {
  SpreadsheetApp.getUi()
    .createMenu('Foodbank questionnaire')
    .addItem('Validate questionnaire', 'validateQuestionnaire')
    .addItem('Format as JSON', 'formatQuestionnaireAsJson')
    .addToUi();
}

/** Validates the Referral Form tab without creating or changing an output tab. */
function validateQuestionnaire() {
  const result = parseQuestionnaire_();
  const converted = toClientConfig_(result.json);
  const errors = result.errors.concat(converted.errors);
  if (errors.length > 0) {
    showQuestionnaireErrors_('The questionnaire needs correction', errors);
    return;
  }
  SpreadsheetApp.getUi().alert(
    'Questionnaire is valid',
    `${String(result.questionCount)} questions on ${String(result.json.pages.length)} pages are ready to format as JSON.`,
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

/** Validates then writes the pretty-printed referral-form source JSON to its own tab. */
function formatQuestionnaireAsJson() {
  const result = parseQuestionnaire_();
  const converted = toClientConfig_(result.json);
  const errors = result.errors.concat(converted.errors);
  if (errors.length > 0) {
    showQuestionnaireErrors_('The questionnaire JSON was not generated', errors);
    return;
  }

  const output = JSON.stringify(converted.json, null, 2);
  const sheet = getOrCreateSheet_(GENERATED_QUESTIONNAIRE_SHEET);
  ensureSize_(sheet, 2, 1);
  sheet
    .getRange('A1')
    .setValue('Reviewed client questionnaire JSON — copy only after checking it.')
    .setFontWeight('bold')
    .setBackground('#d9eaf7');
  sheet.getRange('A2').setValue(output).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sheet.setColumnWidth(1, 900);
  sheet.setRowHeight(2, Math.min(Math.max(180, output.split('\n').length * 18), 1600));
  SpreadsheetApp.getUi().alert(
    'Questionnaire JSON generated',
    'Check the generated JSON tab, then copy it into the reviewed client configuration workflow.',
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}

/** Turns the Sheet's authoring fields into the exact client configuration schema. */
function toClientConfig_(source) {
  const errors = [];
  const pages = source.pages.map((page) => ({
    pageNum: page.pageNum,
    pageTitle: page.pageTitle,
    questions: page.questions.map((question) => toClientQuestion_(question, errors)),
  }));
  return { json: { version: 4, pages }, errors };
}

function toClientQuestion_(source, errors) {
  if (source.answerFormat === 'No Answer') return source;

  if (source.questionKey === 'isDelivery') {
    errors.push(
      `Question "${source.questionTitle}": use "Collection method" as its Question key; isDelivery is derived by the client.`,
    );
  }
  const wording = splitQuestionWording_(source.questionTitle);
  const shared = {
    questionNum: source.questionNum,
    questionKey: source.questionKey,
    questionTitle: wording.questionTitle,
    required: source.required,
    ...(wording.helpText === undefined ? {} : { helpText: wording.helpText }),
    ...(source.enabledWhen === undefined ? {} : { enabledWhen: source.enabledWhen }),
    ...(source.forFuelTeam === undefined ? {} : { forFuelTeam: source.forFuelTeam }),
    ...(source.pickListInformation === 'Yes' ? { pickListInformation: 'Yes' } : {}),
  };
  const expectedFormat = CLIENT_KEY_FIELDS.get(source.questionKey);
  if (expectedFormat !== undefined) {
    if (source.answerFormat !== expectedFormat)
      errors.push(
        `Question "${source.questionKey}": ${expectedFormat} is required for this fixed field, not ${source.answerFormat}.`,
      );
    return { ...shared, keyField: source.questionKey };
  }
  if (source.answerFormat === 'householdComposition') {
    if (source.questionKey !== 'Household Components')
      errors.push('householdComposition must use the fixed Question key "Household Components".');
    return {
      ...shared,
      preference: source.preference,
      validation: { type: 'HouseholdComposition' },
    };
  }
  if (source.answerFormat === 'Choice list' || source.answerFormat === 'Cause of crisis') {
    const validation = {
      type: 'CheckBox',
      answerMin: source.answerMin,
      answerMax: source.answerMax,
      ...(source.answerFormat === 'Cause of crisis'
        ? { optionsFrom: 'referralReasons', maxAnswerLength: 200 }
        : {}),
    };
    return {
      ...shared,
      preference: source.preference,
      validation,
      ...(source.answerFormat === 'Cause of crisis' ? {} : { answers: source.answers || [] }),
      ...(source.default === undefined ? {} : { default: source.default }),
    };
  }
  if (['Text', 'Email address', 'Phone number'].includes(source.answerFormat))
    return {
      ...shared,
      preference: source.preference,
      validation: { type: 'String', maxLength: CLIENT_TEXT_MAX_LENGTH },
    };

  errors.push(
    `Question "${source.questionKey}": ${source.answerFormat} can only be used with its matching fixed field.`,
  );
  return { ...shared, preference: source.preference, validation: { type: 'String', maxLength: 1 } };
}

function splitQuestionWording_(wording) {
  const parts = wording.split(/\n\s*\n/);
  const questionTitle = (parts.shift() || '').trim();
  const helpText = parts.join('\n\n').trim();
  return { questionTitle, ...(helpText === '' ? {} : { helpText }) };
}

function parseQuestionnaire_() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(QUESTIONNAIRE_SHEET);
  if (sheet === null)
    return {
      json: { version: 1, pages: [] },
      errors: [`The ${QUESTIONNAIRE_SHEET} tab does not exist.`],
      questionCount: 0,
    };

  const headerErrors = validateQuestionnaireHeaders_(sheet);
  if (headerErrors.length > 0)
    return { json: { version: 1, pages: [] }, errors: headerErrors, questionCount: 0 };

  const lastRow = sheet.getLastRow();
  if (lastRow < QUESTIONNAIRE_FIRST_DATA_ROW)
    return {
      json: { version: 1, pages: [] },
      errors: ['Add at least one questionnaire row.'],
      questionCount: 0,
    };

  const rows = sheet
    .getRange(
      QUESTIONNAIRE_FIRST_DATA_ROW,
      1,
      lastRow - QUESTIONNAIRE_FIRST_DATA_ROW + 1,
      QUESTIONNAIRE_COLUMNS.length,
    )
    .getDisplayValues();
  const errors = [];
  const pages = [];
  const pagesByNumber = new Map();
  const questionKeys = new Set();
  let currentQuestion = null;
  let currentPage = null;

  function error(rowNumber, message) {
    errors.push(`Row ${rowNumber}: ${message}`);
  }

  function readPage(pageValue, rowNumber) {
    const match = pageValue.match(/^(\d+)\s*[—–-]\s*(.+)$/);
    if (match === null) {
      error(rowNumber, 'Page must be like "1 — Referrer and client details".');
      return null;
    }
    const pageNum = Number(match[1]);
    const pageTitle = match[2].trim();
    if (!Number.isInteger(pageNum) || pageNum < 1 || pageTitle === '') {
      error(rowNumber, 'Page needs a positive number and a title.');
      return null;
    }
    const existing = pagesByNumber.get(pageNum);
    if (existing !== undefined) {
      if (existing.pageTitle !== pageTitle)
        error(rowNumber, `Page ${pageNum} has a different title to its first row.`);
      return existing;
    }
    const page = { pageNum, pageTitle, questions: [] };
    pagesByNumber.set(pageNum, page);
    pages.push(page);
    return page;
  }

  rows.forEach((row, index) => {
    const rowNumber = QUESTIONNAIRE_FIRST_DATA_ROW + index;
    const line = Object.fromEntries(
      QUESTIONNAIRE_COLUMNS.map((column, columnIndex) => [
        column,
        String(row[columnIndex] || '').trim(),
      ]),
    );
    if (Object.values(line).every((value) => value === '')) return;

    const format = line['Answer format'];
    const key = line['Question key'];
    const isDisplayOnly = format === 'No Answer';
    const startsQuestion = key !== '' || isDisplayOnly;

    if (startsQuestion) {
      if (line.Page === '') {
        error(rowNumber, 'A new question needs a Page value.');
        currentQuestion = null;
        return;
      }
      currentPage = readPage(line.Page, rowNumber);
      if (currentPage === null) {
        currentQuestion = null;
        return;
      }
      if (line['Question wording'] === '') error(rowNumber, 'A new question needs wording.');
      if (!QUESTIONNAIRE_FORMATS.has(format))
        error(rowNumber, `Unknown Answer format "${format}".`);
      if (line.Required !== 'Yes' && line.Required !== 'No')
        error(rowNumber, 'Required must be Yes or No.');
      if (!['Yes', 'No', 'Not applicable'].includes(line['Use for picking rules?']))
        error(rowNumber, 'Use for picking rules? must be Yes, No or Not applicable.');
      if (!['', 'Yes', 'No'].includes(line['Pick-list information']))
        error(rowNumber, 'Pick-list information must be Yes, No or blank.');
      if (!['', 'Yes', 'No'].includes(line['For Fuel Team']))
        error(rowNumber, 'For Fuel Team must be blank, Yes or No.');
      if ((line['Shown when key'] === '') !== (line['Shown when answer'] === ''))
        error(
          rowNumber,
          'Shown when key and Shown when answer must either both be filled or both be blank.',
        );

      if (isDisplayOnly) {
        if (key !== '')
          error(rowNumber, 'No Answer is display-only and must have a blank Question key.');
        if (
          line.Selection !== '' ||
          line['Answer / option shown'] !== '' ||
          line['Default?'] !== ''
        )
          error(rowNumber, 'No Answer cannot have a selection, answer option or default.');
        if (line.Required !== 'No') error(rowNumber, 'No Answer must not be required.');
        if (line['Use for picking rules?'] !== 'No')
          error(rowNumber, 'No Answer cannot be used for picking rules.');
        if (line['Pick-list information'] !== '')
          error(rowNumber, 'No Answer cannot be pick-list information.');
        currentPage.questions.push({
          questionNum: currentPage.questions.length + 1,
          questionTitle: line['Question wording'],
          answerFormat: 'No Answer',
          ...(line['Shown when key'] === ''
            ? {}
            : {
                enabledWhen: {
                  questionKey: line['Shown when key'],
                  hasAnswer: line['Shown when answer'],
                },
              }),
        });
        currentQuestion = null;
        return;
      }

      if (key === '') {
        error(rowNumber, 'Only a No Answer row may have a blank Question key.');
        currentQuestion = null;
        return;
      }
      if (questionKeys.has(key)) error(rowNumber, `Question key "${key}" is used more than once.`);
      questionKeys.add(key);
      currentQuestion = {
        questionNum: currentPage.questions.length + 1,
        questionKey: key,
        questionTitle: line['Question wording'],
        answerFormat: format,
        ...(line.Selection === '' ? {} : { selection: line.Selection }),
        required: line.Required === 'Yes',
        preference: line['Use for picking rules?'] === 'Yes',
        ...(line['Pick-list information'] === 'Yes' ? { pickListInformation: 'Yes' } : {}),
        ...(line['For Fuel Team'] === 'Yes' ? { forFuelTeam: true } : {}),
        ...(line['Shown when key'] === ''
          ? {}
          : {
              enabledWhen: {
                questionKey: line['Shown when key'],
                hasAnswer: line['Shown when answer'],
              },
            }),
      };
      currentPage.questions.push(currentQuestion);
    } else {
      if (currentQuestion === null) {
        error(rowNumber, 'This answer option does not follow a question.');
        return;
      }
      const inheritedColumns = [
        'Page',
        'Question wording',
        'Answer format',
        'Selection',
        'Required',
        'Use for picking rules?',
        'Pick-list information',
        'Shown when key',
        'Shown when answer',
        'For Fuel Team',
      ];
      inheritedColumns.forEach((column) => {
        if (line[column] !== '')
          error(rowNumber, `${column} must be blank on an inherited answer-option row.`);
      });
    }

    if (currentQuestion === null) return;
    validateQuestionLine_(line, currentQuestion, rowNumber, error);
  });

  pages.sort((left, right) => left.pageNum - right.pageNum);
  pages.forEach((page, pageIndex) => {
    if (page.pageNum !== pageIndex + 1)
      errors.push(`Page ${page.pageNum}: page numbers must start at 1 and have no gaps.`);
  });
  pages.forEach((page) => {
    page.questions.forEach((question) => finalizeQuestion_(question, errors));
  });
  pages.forEach((page) => {
    page.questions.forEach((question) => {
      if (question.enabledWhen !== undefined && !questionKeys.has(question.enabledWhen.questionKey))
        errors.push(
          `Question "${question.questionTitle}": Shown when key "${question.enabledWhen.questionKey}" is not a questionnaire key.`,
        );
    });
  });
  return {
    json: { version: 1, pages },
    errors,
    questionCount: pages.reduce((total, page) => total + page.questions.length, 0),
  };
}

function validateQuestionLine_(line, question, rowNumber, error) {
  const format = question.answerFormat;
  const option = line['Answer / option shown'];
  const defaultValue = line['Default?'];
  if (format === 'Choice list') {
    if (option === '') error(rowNumber, 'Choice list needs an Answer / option shown value.');
    if (!['', 'Yes', 'No'].includes(defaultValue))
      error(rowNumber, 'Default? must be Yes, No or blank.');
    if (option !== '') {
      if (option.includes(','))
        error(rowNumber, 'Put one choice option on each row; do not separate options with commas.');
      if (question.answers === undefined) question.answers = [];
      if (question.answers.includes(option))
        error(rowNumber, `Choice option "${option}" is repeated.`);
      question.answers.push(option);
      if (defaultValue === 'Yes') {
        if (question.default === undefined) question.default = [];
        question.default.push(option);
      }
    }
    return;
  }
  if (option !== '' || defaultValue !== '')
    error(rowNumber, `${format} cannot have an Answer / option shown value or a default.`);
  if (format === 'householdComposition' && question.selection !== undefined)
    error(rowNumber, 'householdComposition cannot have a selection.');
  if (format === 'No Answer') error(rowNumber, 'No Answer cannot be an answer-option row.');
}

function finalizeQuestion_(question, errors) {
  if (question.pickListInformation === 'Yes' && !question.preference)
    errors.push(
      `Question "${question.questionKey}": Pick-list information requires Use for picking rules? to be Yes.`,
    );
  if (!['Choice list', 'Cause of crisis'].includes(question.answerFormat)) return;
  const selection = parseSelection_(question.selection);
  if (selection === null) {
    errors.push(
      `Question "${question.questionKey}": Selection must be Choose one, Choose 1 or Choose up to N.`,
    );
    return;
  }
  question.selection = selection.label;
  // “Choose up to N” describes the ceiling. Required supplies its natural
  // floor of one, so a required Cooking Facility choice can mean 1–3.
  question.answerMin = question.required ? Math.max(1, selection.minimum) : selection.minimum;
  question.answerMax = selection.maximum;
  if (!question.required && selection.minimum > 0)
    errors.push(
      `Question "${question.questionKey}": an optional Choice list cannot require an answer.`,
    );
  if (question.answerFormat === 'Choice list' && (question.answers || []).length === 0)
    errors.push(`Question "${question.questionKey}": Choice list has no answer options.`);
  if ((question.default || []).length > selection.maximum)
    errors.push(`Question "${question.questionKey}": more defaults than the selection allows.`);
  if ((question.default || []).length === 0) delete question.default;
}

function parseSelection_(value) {
  if (value === 'Choose one' || value === 'Choose 1')
    return { label: value, minimum: 1, maximum: 1 };
  const match = value.match(/^Choose up to (\d+)$/);
  if (match === null) return null;
  const maximum = Number(match[1]);
  return Number.isInteger(maximum) && maximum >= 1 ? { label: value, minimum: 0, maximum } : null;
}

function validateQuestionnaireHeaders_(sheet) {
  const headers = sheet
    .getRange(QUESTIONNAIRE_HEADER_ROW, 1, 1, QUESTIONNAIRE_COLUMNS.length)
    .getDisplayValues()[0];
  return QUESTIONNAIRE_COLUMNS.flatMap((column, index) =>
    headers[index] === column
      ? []
      : [`Questionnaire row ${QUESTIONNAIRE_HEADER_ROW} column ${index + 1} must be "${column}".`],
  );
}

function showQuestionnaireErrors_(title, errors) {
  SpreadsheetApp.getUi().alert(
    title,
    errors.map((error) => `• ${error}`).join('\n'),
    SpreadsheetApp.getUi().ButtonSet.OK,
  );
}
