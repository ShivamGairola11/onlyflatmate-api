// Synced from the web app (src/features/payments/upgrade.ts) by scripts/sync-contract.mjs — do not edit here.
import type { PassPlan, PassPlanId, UpgradeOffer } from "./types";

/**
 * Upgrade pricing (retention): someone holding an unexpired pass who buys a longer plan than the one they hold
 * pays this much less for it. One rule for the API (which charges it; synced into basera-api/contract) and the
 * web app (which shows it). Same or shorter plans cost the full price.
 */
export const UPGRADE_PERCENT_OFF = 15;

const RANK: Record<PassPlanId, number> = { MINI: 0, PRO: 1, MAX: 2 };

/**
 * The holder's level: the longest plan among their unexpired passes, or -1 with none. Passes from before plans
 * existed (plan null) were a week, so they count as Pro.
 */
export function holderRank(activePlans: readonly (PassPlanId | null | undefined)[]): number {
  return activePlans.reduce((top, p) => Math.max(top, RANK[p ?? "PRO"]), -1);
}

/** What `plan` costs at this holder level: discounted (whole rupees) when it's an upgrade, else the list price. */
export function planPrice(plan: PassPlan, rank: number): number {
  return rank >= 0 && RANK[plan.id] > rank ? Math.round((plan.priceInr * (100 - UPGRADE_PERCENT_OFF)) / 100) : plan.priceInr;
}

/** The upgrade prices on offer at this holder level, or undefined when there's nothing to upgrade to. */
export function upgradeOffer(plans: readonly PassPlan[], rank: number): UpgradeOffer | undefined {
  const prices: Partial<Record<PassPlanId, number>> = {};
  for (const p of plans) if (rank >= 0 && RANK[p.id] > rank) prices[p.id] = planPrice(p, rank);
  return Object.keys(prices).length ? { percentOff: UPGRADE_PERCENT_OFF, prices } : undefined;
}
