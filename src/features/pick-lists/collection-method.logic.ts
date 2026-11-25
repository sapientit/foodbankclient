/**
 * The Run sheet's `Del?`/`Ref?` columns and the listener sheet's `Ref?`
 * column, derived from the referral's own `Collection method` answer —
 * question 21 in `referral-form.config.json` — rather than any server-side
 * category. The server's own `collectionMethod` column (when it carried one)
 * collapsed Car, Public Transport and On Foot into a single `collection`
 * value, which already said everything these two flags need: delivery and
 * referrer-collection are the two answers that change what a team lead or
 * listener does, and every other answer is an ordinary collection.
 * `screenDetails.md`, "#Session processing" and "#Listener sheet".
 */
const COLLECTION_METHOD_ANSWER_KEY = 'Collection method';
const DELIVERY_REQUESTED = 'Delivery Requested';
const REFERRER_WILL_COLLECT = 'Referrer will collect';

function collectionAnswer(holder: {
  readonly answers: Readonly<Record<string, unknown>>;
}): unknown {
  return holder.answers[COLLECTION_METHOD_ANSWER_KEY];
}

/** `true` only where the household's own Collection method answer is `Delivery Requested`. */
export function isDeliveryAnswer(holder: {
  readonly answers: Readonly<Record<string, unknown>>;
}): boolean {
  return collectionAnswer(holder) === DELIVERY_REQUESTED;
}

/** `true` only where the household's own Collection method answer is `Referrer will collect`. */
export function isReferrerCollectAnswer(holder: {
  readonly answers: Readonly<Record<string, unknown>>;
}): boolean {
  return collectionAnswer(holder) === REFERRER_WILL_COLLECT;
}
