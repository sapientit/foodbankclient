/**
 * The query keys this feature owns. Two independent roots, not one — unlike
 * `modelParcelKeys`, nothing here couples the two resources: an authorised
 * referrer never names a reason and a reason never names a referrer, so a
 * mutation on one has nothing useful to invalidate on the other.
 */
export const authorisedReferrerKeys = {
  all: ['authorised-referrers'] as const,
  list: () => [...authorisedReferrerKeys.all, 'list'] as const,
};

export const referralReasonKeys = {
  all: ['referral-reasons'] as const,
  list: () => [...referralReasonKeys.all, 'list'] as const,
};
