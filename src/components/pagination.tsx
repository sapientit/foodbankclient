import { useEffect, useRef } from 'react';
import styles from './pagination.module.css';

/** A presentational pager for a list that is already loaded in memory. */
export function Pagination({
  page,
  pageCount,
  onPageChange,
}: {
  /** One-indexed, because that is how the page is announced to a person. */
  readonly page: number;
  readonly pageCount: number;
  readonly onPageChange: (page: number) => void;
}) {
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);

  /*
   * A native `disabled` element cannot hold focus — the browser drops it to
   * `<body>`. A keyboard user who presses Enter on "Next" while it lands them
   * on the last page would otherwise silently lose their place on the page.
   * If the button that was just focused is now the disabled one, move focus
   * to the page indicator instead of letting it fall out of the document.
   */
  useEffect(() => {
    const active = document.activeElement;
    const previous = previousRef.current;
    const next = nextRef.current;
    const strandedOnPrevious = active === previous && previous?.disabled === true;
    const strandedOnNext = active === next && next?.disabled === true;
    if (strandedOnPrevious || strandedOnNext) statusRef.current?.focus();
  }, [page, pageCount]);

  return (
    <nav aria-label="Pagination" className={styles.pagination}>
      <button
        disabled={page <= 1}
        onClick={() => {
          onPageChange(page - 1);
        }}
        ref={previousRef}
        type="button"
      >
        Previous
      </button>
      <span aria-live="polite" ref={statusRef} tabIndex={-1}>
        {`Page ${String(page)} of ${String(pageCount)}`}
      </span>
      <button
        disabled={page >= pageCount}
        onClick={() => {
          onPageChange(page + 1);
        }}
        ref={nextRef}
        type="button"
      >
        Next
      </button>
    </nav>
  );
}
