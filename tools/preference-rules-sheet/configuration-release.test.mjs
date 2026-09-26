import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const directory = dirname(fileURLToPath(import.meta.url));

function loadConfigurationReleaseScript() {
  const context = {
    Date,
    JSON,
    Map,
    Math,
    Number,
    Set,
    String,
    Utilities: {
      Charset: { UTF_8: 'UTF_8' },
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      computeDigest: (_algorithm, value) =>
        [...createHash('sha256').update(value, 'utf8').digest()].map((byte) =>
          byte > 127 ? byte - 256 : byte,
        ),
      getUuid: () => 'generated-id',
    },
    SpreadsheetApp: {},
  };
  vm.createContext(context);
  const source = [
    readFileSync(join(directory, 'Code.gs'), 'utf8'),
    readFileSync(join(directory, 'questionnaire.gs'), 'utf8'),
  ].join('\n');
  vm.runInContext(
    `${source}
function runConfigurationActionForTest_(action, rulesResult, questionnaireResult) {
  const events = [];
  const original = {
    validateRules_,
    validateQuestionnaireConfig_,
    writeConfigurationValidation_,
    clearConfigurationReleaseManifest_,
    writeRulesJson_,
    writeQuestionnaireJson_,
    writeConfigurationReleaseManifest_,
    showConfigurationToast_,
  };
  try {
    validateRules_ = () => {
      events.push('validate rules');
      return rulesResult;
    };
    validateQuestionnaireConfig_ = () => {
      events.push('validate questionnaire');
      return questionnaireResult;
    };
    writeConfigurationValidation_ = (release) => events.push({ validation: release.errors });
    clearConfigurationReleaseManifest_ = () => events.push('clear');
    writeRulesJson_ = (output) => events.push({ rules: output });
    writeQuestionnaireJson_ = (output) => events.push({ questionnaire: output });
    writeConfigurationReleaseManifest_ = (manifest) => events.push(manifest);
    showConfigurationToast_ = (message) => events.push({ toast: message });
    if (action === 'validate') validateConfigurationRelease();
    else generateConfigurationRelease();
    return JSON.parse(JSON.stringify(events));
  } finally {
    validateRules_ = original.validateRules_;
    validateQuestionnaireConfig_ = original.validateQuestionnaireConfig_;
    writeConfigurationValidation_ = original.writeConfigurationValidation_;
    clearConfigurationReleaseManifest_ = original.clearConfigurationReleaseManifest_;
    writeRulesJson_ = original.writeRulesJson_;
    writeQuestionnaireJson_ = original.writeQuestionnaireJson_;
    writeConfigurationReleaseManifest_ = original.writeConfigurationReleaseManifest_;
    showConfigurationToast_ = original.showConfigurationToast_;
  }
}
globalThis.configurationReleaseTest = {
  createConfigurationReleaseManifest_,
  runConfigurationActionForTest_,
};`,
    context,
  );
  return context.configurationReleaseTest;
}

test('binds the generated questionnaire and rules payloads with stable SHA-256 hashes', () => {
  const { createConfigurationReleaseManifest_ } = loadConfigurationReleaseScript();
  const manifest = createConfigurationReleaseManifest_(
    '{"version":4}',
    '{"rules":[]}',
    '2026-09-26T12:34:56.000Z',
    'release-123',
  );

  assert.deepEqual(JSON.parse(JSON.stringify(manifest)), {
    version: 1,
    generationId: 'release-123',
    generatedAt: '2026-09-26T12:34:56.000Z',
    questionnaireSha256: createHash('sha256').update('{"version":4}').digest('hex'),
    rulesSha256: createHash('sha256').update('{"rules":[]}').digest('hex'),
  });
});

test('generates Rules before Questionnaire and writes a manifest only after both validate', () => {
  const { runConfigurationActionForTest_ } = loadConfigurationReleaseScript();
  const events = runConfigurationActionForTest_(
    'generate',
    { errors: [], output: '{"rules":[]}' },
    { errors: [], output: '{"version":4}', questionCount: 2, pageCount: 1 },
  );

  assert.deepEqual(events.slice(0, 6), [
    'validate rules',
    'validate questionnaire',
    { validation: [] },
    'clear',
    { rules: '{"rules":[]}' },
    { questionnaire: '{"version":4}' },
  ]);
  const manifest = events[6];
  assert.equal(typeof manifest, 'object');
  assert.equal(manifest.rulesSha256, createHash('sha256').update('{"rules":[]}').digest('hex'));
  assert.equal(
    manifest.questionnaireSha256,
    createHash('sha256').update('{"version":4}').digest('hex'),
  );
});

test('validation checks both sources without overwriting a generated release', () => {
  const { runConfigurationActionForTest_ } = loadConfigurationReleaseScript();
  const events = runConfigurationActionForTest_(
    'validate',
    { errors: [], output: '{"rules":[]}' },
    { errors: [], output: '{"version":4}', questionCount: 2, pageCount: 1 },
  );

  assert.deepEqual(events.slice(0, 3), [
    'validate rules',
    'validate questionnaire',
    { validation: [] },
  ]);
  assert.equal(events.length, 4);
  assert.match(events[3].toast, /Configuration is valid/);
});

test('generation leaves previous JSON and manifest untouched if either validation fails', () => {
  const { runConfigurationActionForTest_ } = loadConfigurationReleaseScript();
  const events = runConfigurationActionForTest_(
    'generate',
    { errors: ['Rules: bad item'], output: null },
    { errors: ['Questionnaire: bad key'], output: null, questionCount: 0, pageCount: 0 },
  );

  assert.deepEqual(events.slice(0, 3), [
    'validate rules',
    'validate questionnaire',
    { validation: ['Rules: bad item', 'Questionnaire: bad key'] },
  ]);
  assert.equal(events.length, 4);
  assert.match(events[3].toast, /No JSON was generated/);
});

test('has only combined actions and no modal feedback that can pause an execution', () => {
  const source = [
    readFileSync(join(directory, 'Code.gs'), 'utf8'),
    readFileSync(join(directory, 'questionnaire.gs'), 'utf8'),
  ].join('\n');

  assert.match(source, /Validate configuration/);
  assert.match(source, /Generate configuration release/);
  assert.doesNotMatch(source, /getUi\(\)\.alert|showModalDialog/);
  assert.doesNotMatch(
    source,
    /setupRulesSheet|generateRulesJson|formatQuestionnaireAsJson|copyReviewed/,
  );
});
