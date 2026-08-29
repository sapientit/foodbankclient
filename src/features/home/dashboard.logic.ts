import type { SessionStatus } from '../sessions/keys';

export function previousWeeksNotCompleted<
  T extends { readonly sessionDate: string; readonly status: SessionStatus },
>(sessions: readonly T[], startOfCurrentWeek: string): T[] {
  return sessions.filter(
    (session) =>
      session.sessionDate < startOfCurrentWeek &&
      (session.status === 'planned' || session.status === 'in_progress'),
  );
}
