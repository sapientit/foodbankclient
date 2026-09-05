import { Link } from 'react-router';
import { PageHeader } from '../../../components/page-header';
import styles from './prototype-home-screen.module.css';

/**
 * A menu for the whole stock-handling prototype (see `../README.md`). Not part of the real
 * navigation menu — reachable only by direct URL — so this is the only way anyone finds the other
 * prototype screens.
 */
const PROTOTYPE_LINKS = [
  {
    to: '/stock-prototype/groupings',
    label: 'Stock-take groupings',
    description: 'Which items are counted together, and by what.',
  },
  {
    to: '/stock-prototype/crates',
    label: 'Crates',
    description: 'Commingled shelf stock counted and shopped for as one thing.',
  },
  {
    to: '/stock-prototype/take',
    label: 'Stock take',
    description: 'Counting a grouping, including crate lines and packing units.',
  },
  {
    to: '/stock-prototype/validation',
    label: 'Validation',
    description: 'What needs fixing when a crate and its shelves disagree.',
  },
  {
    to: '/stock-prototype/shopping',
    label: 'Targets and shopping',
    description: 'Setting targets against items and crates, and the resulting buy list.',
  },
] as const;

export function PrototypeHomeScreen() {
  return (
    <>
      <PageHeader title="Stock handling prototype" />
      <p className={styles.intro}>
        This is a disposable demo of a proposed stock-handling change, built to show what it would
        feel like to use — nothing here is connected to the real system, and reloading the page
        resets it back to the demo starting point.
      </p>
      <ul className={styles.list}>
        {PROTOTYPE_LINKS.map((link) => (
          <li className={styles.item} key={link.to}>
            <Link className="button-link" to={link.to}>
              {link.label}
            </Link>
            <p className={styles.description}>{link.description}</p>
          </li>
        ))}
      </ul>
    </>
  );
}
