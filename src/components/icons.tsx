/**
 * A small set of decorative glyphs for navigation, section headings and named
 * icon controls.
 *
 * Hand-authored rather than a dependency — six icons do not justify one, per
 * `CLAUDE.md`. Each is sized at `1em` and coloured with `currentColor`, so it
 * follows the font-size and colour of whatever text it sits beside rather
 * than carrying its own. Every icon is `aria-hidden`: it sits next to a text
 * label or control name that already says what it is, so it must not be
 * announced a second time.
 */

interface IconProps {
  readonly className?: string | undefined;
}

const shared = {
  'aria-hidden': true,
  focusable: false,
  viewBox: '0 0 24 24',
  width: '1em',
  height: '1em',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function HomeIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
    </svg>
  );
}

export function UsersIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17.5" cy="8.5" r="2.5" />
      <path d="M15.5 14.3c2.5.5 4.3 2.7 4.3 5.7" />
    </svg>
  );
}

export function BoxIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M3 7.5 12 3l9 4.5-9 4.5-9-4.5Z" />
      <path d="M3 7.5v9L12 21l9-4.5v-9" />
      <path d="M12 12v9" />
    </svg>
  );
}

/** Three parcels together: the visual cue for a stock-take grouping. */
export function BoxesIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="m3 8 4-2 4 2-4 2-4-2Z" />
      <path d="M3 8v4l4 2 4-2V8" />
      <path d="m13 6 4-2 4 2-4 2-4-2Z" />
      <path d="M13 6v4l4 2 4-2V6" />
      <path d="m8 15 4-2 4 2-4 2-4-2Z" />
      <path d="M8 15v4l4 2 4-2v-4" />
    </svg>
  );
}

export function TargetIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

export function CartIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M3 4h2l2.2 11h10.6l2.2-8H7" />
      <circle cx="9" cy="19" r="1.25" />
      <circle cx="17" cy="19" r="1.25" />
    </svg>
  );
}

export function KeyIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 9-9" />
      <path d="m16 5 3 3" />
      <path d="m14 7 3 3" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

export function ClipboardCheckIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M9 5a3 3 0 0 1 6 0" />
      <path d="m8.5 13 2.2 2.2 4.8-5" />
    </svg>
  );
}

export function SpreadsheetIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 8h8M8 12h8M8 16h8M12 8v8" />
    </svg>
  );
}

export function CalendarIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9.5h18" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </svg>
  );
}

export function GridIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

/** A short checklist: the visual cue for a stock take. */
export function ListIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M8 6h12" />
      <path d="M8 12h12" />
      <path d="M8 18h12" />
      <path d="m3.5 6 1.2 1.2L6.5 5" />
      <path d="m3.5 12 1.2 1.2L6.5 11" />
      <path d="m3.5 18 1.2 1.2L6.5 17" />
    </svg>
  );
}

export function FuelIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M12 3c3.5 4.2 6 7.6 6 10.5a6 6 0 0 1-12 0C6 10.6 8.5 7.2 12 3Z" />
    </svg>
  );
}

export function BellIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 12 6 8Z" />
      <path d="M9.5 17.5a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="m4 20 4.1-1 10.8-10.8a2.1 2.1 0 0 0-3-3L5.1 16 4 20Z" />
      <path d="m13.8 7.3 3 3" />
    </svg>
  );
}

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="m9 5 10 7-10 7V5Z" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="m14.5 5-7 7 7 7" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="m9.5 5 7 7-7 7" />
    </svg>
  );
}

export function ArchiveIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M4 8h16v12H4z" />
      <path d="M3 4h18v4H3z" />
      <path d="M12 11v5" />
      <path d="m9.5 13.5 2.5 2.5 2.5-2.5" />
    </svg>
  );
}

export function RestoreIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M4 8h16v12H4z" />
      <path d="M3 4h18v4H3z" />
      <path d="M12 16v-5" />
      <path d="m9.5 13.5 2.5-2.5 2.5 2.5" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...shared} className={className}>
      <path d="M5 7h14" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}
