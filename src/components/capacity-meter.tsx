import styles from './capacity-meter.module.css';

/**
 * A compact count and its capacity at a glance. The written status remains
 * beside the bar: colour helps scan, but never carries the only meaning.
 */
export function CapacityMeter({
  capacity,
  noun,
  value,
}: {
  readonly capacity: number;
  readonly noun: string;
  readonly value: number;
}) {
  const isOver = value > capacity;
  const isFull = value === capacity;
  const state = isOver ? 'over' : isFull ? 'full' : 'open';
  // A zero session capacity is an administrator's temporary block on new
  // bookings, not empty space. Draw it as a full bar rather than the otherwise
  // misleading zero-width green fill for `0 of 0`.
  const isZeroCapacity = capacity === 0;
  const percentage = isZeroCapacity ? 100 : Math.min(100, (value / capacity) * 100);
  const status = isOver ? ' (over capacity)' : isFull ? ' (full)' : '';

  return (
    <span
      className={styles.meter}
      data-state={state}
      data-zero-capacity={isZeroCapacity ? 'true' : undefined}
    >
      <span>{`${String(value)} of ${String(capacity)}${noun === '' ? '' : ` ${noun}`}${status}`}</span>
      <span aria-hidden="true" className={styles.track}>
        <span className={styles.fill} style={{ inlineSize: `${String(percentage)}%` }} />
      </span>
    </span>
  );
}
