import { useEffect, useRef } from 'react';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
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
  const focusedDirection = useRef<'previous' | 'next' | null>(null);

  /* When activating the last available direction removes that control, keep a
     keyboard user in the pager rather than dropping focus to the document. */
  useEffect(() => {
    const strandedOnPrevious = focusedDirection.current === 'previous' && page <= 1;
    const strandedOnNext = focusedDirection.current === 'next' && page >= pageCount;
    if (strandedOnPrevious || strandedOnNext) statusRef.current?.focus();
    focusedDirection.current = null;
  }, [page, pageCount]);

  if (pageCount <= 1) return null;

  return (
    <nav aria-label="Pagination" className={styles.pagination}>
      {page > 1 && (
        <button
          aria-label="Previous page"
          onClick={() => {
            focusedDirection.current = 'previous';
            onPageChange(page - 1);
          }}
          ref={previousRef}
          type="button"
        >
          <ChevronLeftIcon />
        </button>
      )}
      <span aria-live="polite" ref={statusRef} tabIndex={-1}>
        {`Page ${String(page)} of ${String(pageCount)}`}
      </span>
      {page < pageCount && (
        <button
          aria-label="Next page"
          onClick={() => {
            focusedDirection.current = 'next';
            onPageChange(page + 1);
          }}
          ref={nextRef}
          type="button"
        >
          <ChevronRightIcon />
        </button>
      )}
    </nav>
  );
}
