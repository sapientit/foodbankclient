/**
 * A small set of decorative glyphs for navigation and section headings.
 *
 * Hand-authored rather than a dependency — six icons do not justify one, per
 * `CLAUDE.md`. Each is sized at `1em` and coloured with `currentColor`, so it
 * follows the font-size and colour of whatever text it sits beside rather
 * than carrying its own. Every icon is `aria-hidden`: it sits next to a text
 * label that already says what it is, so it must not be announced a second
 * time.
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
