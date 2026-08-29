export type WholeNumberProblem = 'empty' | 'not-a-whole-number' | 'below-minimum' | 'above-maximum';

export type WholeNumber =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly problem: WholeNumberProblem };

/**
 * An unsigned whole number within `[minimum, maximum]`, held and parsed as
 * text. An `<input type="number">` reports an empty box and a lone minus sign
 * identically, although they need different, useful errors.
 */
export function parseWholeNumber(
  text: string,
  bounds: { readonly minimum: number; readonly maximum: number },
): WholeNumber {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, problem: 'empty' };
  if (!/^\d+$/.test(trimmed)) return { ok: false, problem: 'not-a-whole-number' };

  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return { ok: false, problem: 'not-a-whole-number' };
  if (value < bounds.minimum) return { ok: false, problem: 'below-minimum' };
  if (value > bounds.maximum) return { ok: false, problem: 'above-maximum' };

  return { ok: true, value };
}
