import { describe, expect, it } from 'vitest';
import { listPathFor, listReturnContext, returnContextFromState } from './list-return';

describe('list return context', () => {
  it('keeps the list URL and stable row id without putting them in a query string', () => {
    const path = listPathFor('/referrals', '?sessionId=session-1&status=active');

    expect(path).toBe('/referrals?sessionId=session-1&status=active');
    expect(returnContextFromState(listReturnContext(path, 'referral-1'))).toEqual({
      listPath: path,
      itemId: 'referral-1',
    });
  });

  it('rejects malformed or off-origin return state', () => {
    expect(
      returnContextFromState({ listReturn: { listPath: '//outside.test', itemId: 'r1' } }),
    ).toBeNull();
    expect(returnContextFromState({ listReturn: { listPath: '/referrals' } })).toBeNull();
  });
});
