import { describe, expect, it } from 'vitest';
import { classNames } from './class-names';

describe('classNames', () => {
  it('joins the classes it is given', () => {
    expect(classNames('pickListLink_a1b2', 'button-link')).toBe('pickListLink_a1b2 button-link');
  });

  it('drops a CSS Module class that is not there, keeping the global one', () => {
    // The whole point: a control whose stylesheet has lost its size rule is
    // still drawn as an available or unavailable control, not as bare text.
    expect(classNames(undefined, 'button-danger')).toBe('button-danger');
  });

  it('drops a conditional class that is off', () => {
    const confirmButton = (destructive: boolean) =>
      classNames('submit_x9', destructive && 'button-danger');

    expect(confirmButton(true)).toBe('submit_x9 button-danger');
    expect(confirmButton(false)).toBe('submit_x9');
  });

  it('returns an empty string when it is given nothing to say', () => {
    expect(classNames(undefined, false)).toBe('');
  });
});
