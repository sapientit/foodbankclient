/** The printed sheet always has three shelf-order columns. */
const PRINT_COLUMNS = 3;

/*
 * A first-page column has 52 print units after its compact heading. A stock
 * line with its separator consumes three units; its optional description
 * makes the item a five-unit block. Information for pickers uses two units
 * for each printed line, including lines formed by wrapping long text.
 *
 * These are deliberately units rather than pixels: the print CSS gives every
 * name, description and separator one predictable line.  The server caps the
 * name at 40 characters and the description at 50 so neither can wrap. The
 * values are calibrated against the UAT A4 print snapshot and can be explored
 * in the standalone tuner. The three-unit margin is included before any item
 * is put into a column.
 */
/* Printers, paper scaling and a near-limit English word can each use a little
   more vertical space than the nominal line unit. Leave one described item of
   slack in every column rather than trusting an exactly full page. */
const FIRST_PAGE_COLUMN_UNITS = 52;
const FOLLOWING_PAGE_COLUMN_UNITS = 92;
const INFORMATION_HEADING_UNITS = 2;
const INFORMATION_LINE_UNITS = 2;
const STOCK_WITHOUT_DESCRIPTION_UNITS = 3;
const STOCK_WITH_DESCRIPTION_UNITS = 5;
const COLUMN_SAFETY_UNITS = 3;

/* The Information for pickers box spans the sheet, not a single column. */
const INFORMATION_CHARACTERS_PER_LINE = 110;

export interface PrintableLine {
  readonly description: string | null;
}

/**
 * The notes keep explicit blank lines (`white-space: pre-wrap` on paper), and
 * long lines wrap at the printable width.  Count both before allocating the
 * stock columns, so an information-heavy first sheet gets fewer whole items
 * instead of allowing a column to run onto the next page.
 */
export function countPickListInformationLines(notes: string | null): number {
  if (notes === null || notes.trim() === '') return 0;

  return notes
    .split(/\r?\n/u)
    .reduce(
      (total, line) =>
        total + Math.max(1, Math.ceil(line.length / INFORMATION_CHARACTERS_PER_LINE)),
      0,
    );
}

function informationUnits(informationLines: number): number {
  return informationLines === 0
    ? 0
    : INFORMATION_HEADING_UNITS + informationLines * INFORMATION_LINE_UNITS;
}

function lineUnits(line: PrintableLine): number {
  return line.description === null ? STOCK_WITHOUT_DESCRIPTION_UNITS : STOCK_WITH_DESCRIPTION_UNITS;
}

/** Whether the information block leaves space for the next whole shelf item. */
export function firstPrintPageHasStockCapacity(
  informationLines: number,
  firstLine: PrintableLine | undefined,
): boolean {
  return (
    firstLine !== undefined &&
    FIRST_PAGE_COLUMN_UNITS - informationUnits(informationLines) - COLUMN_SAFETY_UNITS >=
      lineUnits(firstLine)
  );
}

/**
 * Splits shelf-ordered lines into physical print pages, then contiguous
 * columns on each page.  A page is complete before the next begins: browsers
 * may therefore not continue a first-column shelf walk on a later sheet.
 */
export function splitPrintLines<T extends PrintableLine>(
  lines: readonly T[],
  informationLines: number,
): T[][][] {
  const firstPageUnits = Math.max(
    0,
    FIRST_PAGE_COLUMN_UNITS - informationUnits(informationLines) - COLUMN_SAFETY_UNITS,
  );
  const pages: T[][][] = [];
  let remaining = [...lines];
  let columnUnits = firstPageUnits;

  while (remaining.length > 0) {
    /* If the information block fills the first sheet, stock starts cleanly on
       its own page rather than creating three empty columns. */
    if (pages.length === 0 && columnUnits === 0)
      columnUnits = FOLLOWING_PAGE_COLUMN_UNITS - COLUMN_SAFETY_UNITS;

    const page: T[][] = [];
    for (let column = 0; column < PRINT_COLUMNS && remaining.length > 0; column += 1) {
      const columnLines: T[] = [];
      let usedUnits = 0;

      while (remaining[0] !== undefined) {
        const next = remaining[0];
        const nextUnits = lineUnits(next);
        if (usedUnits + nextUnits > columnUnits) break;
        columnLines.push(next);
        remaining = remaining.slice(1);
        usedUnits += nextUnits;
      }

      /* The one possible line is always smaller than a normal column.  This
         guard only matters if the information block left a first-page column
         with a single unit: put the line on the next physical page intact. */
      if (columnLines.length === 0) break;
      page.push(columnLines);
    }

    if (page.length === 0) {
      columnUnits = FOLLOWING_PAGE_COLUMN_UNITS - COLUMN_SAFETY_UNITS;
      continue;
    }

    pages.push(page);
    columnUnits = FOLLOWING_PAGE_COLUMN_UNITS - COLUMN_SAFETY_UNITS;
  }

  return pages;
}
