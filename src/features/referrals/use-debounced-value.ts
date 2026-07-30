import { useEffect, useState } from 'react';

/**
 * The value, once it has stopped changing for `delayMs`.
 *
 * **This is a rate-limit defence before it is a nicety.** The referrer check
 * runs as somebody types their address, the public endpoints allow roughly sixty
 * calls per IP per minute, and a twenty-five character address typed straight
 * out would otherwise spend a third of a minute's budget for the whole food bank
 * on one field — on twenty-four answers nobody wanted. One pause, one request.
 *
 * Four hundred milliseconds is long enough to cover the gap between two
 * characters typed by somebody who is not a fast typist, and short enough that
 * the answer arrives while they are still looking at the field.
 */
export const CHECK_DEBOUNCE_MS = 400;

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, delayMs);

    // Each keystroke replaces the pending timer, so only the last one fires.
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return settled;
}
