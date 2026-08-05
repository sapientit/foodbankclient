import { useEffect, useState } from 'react';

/**
 * The value, once it has stopped changing for `delayMs`.
 *
 * **Shared because two features need it for the same reason**, and the reason is
 * not cosmetic. Both the public referrer check and the stock autocomplete run a
 * request as somebody types, on a hall's wifi, and an un-debounced field spends
 * one request per keystroke to show twenty-four answers nobody read. On the
 * public side that is also a rate-limit defence — roughly sixty calls per IP per
 * minute for the whole food bank.
 *
 * The delay belongs to the caller: what counts as "stopped typing" depends on
 * what is being asked and how expensive the asking is.
 */
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
