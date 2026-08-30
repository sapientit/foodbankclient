import { NavLink } from 'react-router';
import { Toast } from '../../../components/toast';
import { useToast } from '../../../components/use-toast';
import {
  PRINT_UNAVAILABLE_REASON,
  allParcelsReviewed,
  isCurrentParcel,
} from '../run-session.logic';
import { useSessionPickList, useSmsSummary } from '../queries';
import styles from './run-session-tabs.module.css';

/**
 * The five destinations a team lead has for one session, as navigation
 * rather than as a row of buttons. Settled by Pete on 2026-08-30 —
 * `screenDetails.md`, "Session processing": these are places to look, not
 * actions taken on the session, and Print/Listener sheet/Referral
 * details/Text messages were already separate routes wearing button
 * costumes.
 *
 * Modelled on `app-shell.tsx`'s `subtabsFor` — a `<nav>` of real `NavLink`s
 * with `aria-current="page"`, not the `role="tablist"` swap-in-place pattern
 * `home-screen.tsx` uses for This week/Next week. Those are a same-page
 * filter; these are five different pages.
 */
export function RunSessionTabs({ readOnly, sessionId }: { readOnly: boolean; sessionId: string }) {
  const pickList = useSessionPickList(sessionId);
  const currentParcels = (pickList.data?.parcels ?? []).filter(isCurrentParcel);
  const readyToPrint = pickList.data !== undefined && allParcelsReviewed(currentParcels);
  // Disabled while the session is read-only, for the same reason the SMS
  // panel disables its own poll: a finished session's unread total cannot
  // change, so polling it every five seconds asks nothing.
  const smsSummary = useSmsSummary(sessionId, !readOnly);
  const unreadTotal = smsSummary.data?.unreadTotal ?? 0;
  const { message: toastMessage, show: showToast } = useToast();

  return (
    <>
      <nav aria-label="Session navigation" className={styles.tabs}>
        <ul className={styles.tabList}>
          <li>
            <NavLink end to={`/run-sessions/${sessionId}`}>
              Clients
            </NavLink>
          </li>
          <li>
            <PrintTab
              onUnavailablePress={() => {
                showToast(PRINT_UNAVAILABLE_REASON);
              }}
              readOnly={readOnly}
              readyToPrint={readyToPrint}
              sessionId={sessionId}
            />
          </li>
          <li>
            <NavLink end to={`/run-sessions/${sessionId}/listener`}>
              Listener sheet
            </NavLink>
          </li>
          <li>
            <NavLink end to={`/run-sessions/${sessionId}/referral-details`}>
              Referral details
            </NavLink>
          </li>
          <li>
            <NavLink
              aria-label={
                unreadTotal > 0 ? `Text messages (${String(unreadTotal)} unread)` : undefined
              }
              end
              to={`/run-sessions/${sessionId}/messages`}
            >
              Text messages
              {unreadTotal > 0 && (
                <span aria-hidden="true" className={styles.badge}>
                  {unreadTotal}
                </span>
              )}
            </NavLink>
          </li>
        </ul>
      </nav>
      <Toast message={toastMessage} />
    </>
  );
}

/**
 * The Print all pick lists tab's own three states, moved verbatim from what
 * `SessionActions` used to do as a button: ready to navigate, unavailable
 * and reachable, or — a finished session that never generated any pick
 * lists at all — nothing there is to print.
 *
 * **`aria-label` carries the reason directly, not `aria-describedby`.** The
 * persistent sentence explaining *why* is visible on the Clients tab (in
 * `SessionActions`'s `.hints`), settled by Pete — it is not repeated on
 * every tab. But this button is shared chrome rendered on all five, and that
 * sentence is not in the DOM at all while looking at another tab, so a
 * reference to it there would point at nothing for anyone not currently on
 * Clients. Self-describing is what keeps this control honest from every tab,
 * not just the one the sentence happens to live on — a deliberate, documented
 * divergence from `aria-describedby`, the pattern every other unavailable
 * control on this screen uses, not an oversight.
 */
function PrintTab({
  onUnavailablePress,
  readOnly,
  readyToPrint,
  sessionId,
}: {
  onUnavailablePress: () => void;
  readOnly: boolean;
  readyToPrint: boolean;
  sessionId: string;
}) {
  if (readyToPrint) {
    return (
      <NavLink end to={`/run-sessions/${sessionId}/print`}>
        {readOnly ? 'View all pick lists' : 'Print all pick lists'}
      </NavLink>
    );
  }
  if (readOnly) return <span>No pick lists were prepared for this session.</span>;
  return (
    <button
      aria-label={`Print all pick lists — unavailable. ${PRINT_UNAVAILABLE_REASON}`}
      aria-disabled
      onClick={onUnavailablePress}
      type="button"
    >
      Print all pick lists
    </button>
  );
}
