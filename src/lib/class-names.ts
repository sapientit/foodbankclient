/**
 * Joins a CSS Module class with the global control classes from `index.css`.
 *
 * It exists because of one type: a CSS Module's export is an index signature,
 * and `noUncheckedIndexedAccess` makes every lookup `string | undefined`. So
 * `` `${styles.submit} button-danger` `` is a lint error, and writing it as
 * `[styles.submit, 'button-danger'].join(' ')` silently produces the class name
 * `"undefined"` if the module ever loses the rule. Neither is worth repeating at
 * a dozen call sites.
 *
 * `undefined` in, nothing out — a missing module class leaves the global one
 * doing its job, which is the right way round: the colour of a control must not
 * depend on a stylesheet remembering to define its size.
 */
export function classNames(...names: readonly (string | undefined | false)[]): string {
  return names.filter((name) => typeof name === 'string' && name !== '').join(' ');
}
