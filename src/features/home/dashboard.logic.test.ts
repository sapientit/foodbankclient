import { describe, expect, it } from 'vitest';
import { previousWeeksNotCompleted } from './dashboard.logic';

describe('previousWeeksNotCompleted', () => {
  it('includes only planned or in-progress sessions before this week', () => {
    expect(
      previousWeeksNotCompleted(
        [
          { sessionDate: '2026-08-16', status: 'planned' as const },
          { sessionDate: '2026-08-16', status: 'confirmed' as const },
          { sessionDate: '2026-08-17', status: 'in_progress' as const },
        ],
        '2026-08-17',
      ),
    ).toEqual([{ sessionDate: '2026-08-16', status: 'planned' }]);
  });
});
