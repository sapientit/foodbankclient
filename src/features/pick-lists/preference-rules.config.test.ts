import { expect, it } from 'vitest';
import rawConfig from './preference-rules.config.json';
import { parsePreferenceRuleConfig } from './preference-rules';

it('accepts the generated preference-rules configuration shipped with the client', () => {
  expect(parsePreferenceRuleConfig(rawConfig)).toEqual(rawConfig);
});
