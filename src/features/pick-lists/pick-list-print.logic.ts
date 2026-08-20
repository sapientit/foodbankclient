/**
 * Splits already shelf-ordered lines into contiguous, column-first groups for
 * a printed sheet. CSS columns may balance or paginate their contents; explicit
 * groups keep the picker walking down the first shelf column before the next.
 */
export function splitPrintLines<T>(lines: readonly T[], columns = 3): T[][] {
  const linesPerColumn = Math.ceil(lines.length / columns);
  return Array.from({ length: columns }, (_, column) =>
    lines.slice(column * linesPerColumn, (column + 1) * linesPerColumn),
  );
}
