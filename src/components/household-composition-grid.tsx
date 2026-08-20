import {
  HOUSEHOLD_AGE_BANDS,
  HOUSEHOLD_GENDERS,
  type HouseholdComposition,
} from '../features/referrals/household-composition';
import styles from './household-composition-grid.module.css';

/**
 * The grid a team lead reads at a glance, and the icons are deliberately the
 * only thing in the header cells — a legend beside it would cost more space
 * than the grid itself.
 *
 * **`title` on the header cell, so hovering an icon says what it means.** It is
 * the whole cell rather than the drawing inside it, so the pointer does not
 * have to find a 1.45rem stroke. It is an addition for a mouse and nothing
 * else: a `title` never appears on a tap and never on paper, so the label a
 * screen reader reads stays the visually hidden text it has always been, and
 * neither of those readers depends on this.
 */
export function HouseholdCompositionGrid({
  composition,
}: {
  readonly composition: HouseholdComposition;
}) {
  return (
    <table className={styles.grid}>
      <caption className={styles.visuallyHidden}>Household composition</caption>
      <thead>
        <tr>
          <th scope="col">
            <span className={styles.visuallyHidden}>Gender</span>
          </th>
          {HOUSEHOLD_AGE_BANDS.map((band) => (
            <th key={band.key} scope="col" title={band.label}>
              <AgeIcon ageBand={band.key} />
              <span className={styles.visuallyHidden}>{band.label}</span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {HOUSEHOLD_GENDERS.map((gender) => (
          <tr key={gender.key}>
            <th scope="row" title={gender.label}>
              <GenderIcon gender={gender.key} />
              <span className={styles.visuallyHidden}>{gender.label}</span>
            </th>
            {HOUSEHOLD_AGE_BANDS.map((band) => (
              <td key={band.key}>
                <span className={styles.visuallyHidden}>
                  {band.label}, {gender.label}: {composition[band.key]?.[gender.key] ?? 0}
                </span>
                <span aria-hidden="true" className={styles.count}>
                  {composition[band.key]?.[gender.key] ?? ''}
                </span>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GenderIcon({ gender }: { readonly gender: (typeof HOUSEHOLD_GENDERS)[number]['key'] }) {
  if (gender === 'female')
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="9" r="5" />
        <path d="M12 14v7m-3-3h6" />
      </svg>
    );
  if (gender === 'male')
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="10" cy="14" r="5" />
        <path d="m13.5 10.5 6.5-6.5m-5 0h5v5" />
      </svg>
    );
  if (gender === 'non-binary')
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="5" r="3" />
        <path d="M12 8v8m0-5-4 3m4-3 4 3m-4 2-3 4m3-4 3 4" />
      </svg>
    );
  return (
    <span aria-hidden="true" className={styles.notSaid}>
      ?
    </span>
  );
}

function AgeIcon({ ageBand }: { readonly ageBand: (typeof HOUSEHOLD_AGE_BANDS)[number]['key'] }) {
  switch (ageBand) {
    case '0-4':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="7" cy="8" r="2.5" />
          <path d="M9 11c4 0 6 2 7 5l2 3M9 12l-4 3-2 4m6-4 4 5" />
        </svg>
      );
    case '5-11':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="10" cy="5" r="2.5" />
          <path d="m10 7.5-1 5.5-4 1.5m4-1.5 4 1.5m-4 0-2 4m2-4 4 3M18 17a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" />
        </svg>
      );
    case '12-17':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 10a7 7 0 0 1 14 0M5 10v4m14-4v4" />
          <circle cx="12" cy="10" r="3" />
          <path d="M12 13v5m0-2-3 2m3-2 3 2" />
        </svg>
      );
    case 'working-age':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="5" r="3" />
          <path d="M12 8v8m0-5-4 3m4-3 4 3m-4 2-3 4m3-4 3 4" />
        </svg>
      );
    case 'state-pension-age':
      return (
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M8 4c2-2 6-2 8 0" />
          <circle cx="12" cy="6" r="3" />
          <path d="M12 9v7m0-4-4 3m4-3 4 3m-4 2-3 4m3-4 3 4M18 12v9" />
        </svg>
      );
  }
}
