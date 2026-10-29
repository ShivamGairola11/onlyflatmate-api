// Synced from the web app (src/features/payments/reply-guarantee.ts) by scripts/sync-contract.mjs — do not edit here.
/**
 * Reply guarantee: if nobody a seeker contacted on a paid pass replies within `hours` of their first message,
 * the pass gets `days` more, free, once per pass. One rule for the API (whose hourly job credits it; synced into
 * basera-api/contract) and the web app (which promises it). Never a refund — see the Refund Policy.
 */
export const REPLY_GUARANTEE = { hours: 48, days: 3 } as const;

export const replyGuaranteeText = `No reply within ${REPLY_GUARANTEE.hours} hours? We add ${REPLY_GUARANTEE.days} days to your pass, free.`;
