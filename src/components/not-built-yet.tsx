import { EmptyState } from './empty-state';
import { PageHeader } from './page-header';

/**
 * A routed screen that admits it does not exist yet.
 *
 * The menu is the real menu from `API.md` section 2, so its links have to lead
 * somewhere: a link that 404s in a hall is worse than a screen that says it is
 * not built. Each reserved route in `routes.tsx` uses this until its slice lands
 * and replaces it, at which point one line of the route table changes and this
 * file eventually goes with the last of them.
 */
export function NotBuiltYet({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        headline="Not built yet"
        sentence="This screen has not been built. It is in the menu so the navigation matches what the app will do — nothing is missing from your account."
      />
    </>
  );
}
