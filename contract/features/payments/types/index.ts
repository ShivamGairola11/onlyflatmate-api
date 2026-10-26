// Synced from the web app (src/features/payments/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type { ID, ISODateString, Rupees } from "@/types/common";

export type PaymentStatus =
  "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
export type PaymentProvider = "MOCK" | "RAZORPAY" | "STRIPE";
export type PaymentMethod = "UPI" | "CARD" | "NETBANKING";
export type PassPlanId = "MINI" | "PRO" | "MAX";

export interface PassPlan {
  id: PassPlanId;
  name: string;
  days: number;
  priceInr: Rupees;
}

/** A pass holder's discounted prices for the plans longer than the one they hold (see upgrade.ts). */
export interface UpgradeOffer {
  percentOff: number;
  prices: Partial<Record<PassPlanId, Rupees>>;
}

export interface Payment {
  id: ID;
  userId: ID;
  amount: Rupees;
  currency: "INR";
  provider: PaymentProvider;
  providerOrderId: string;
  providerPaymentId?: string;
  method?: PaymentMethod;
  status: PaymentStatus;
  purpose: "CONTACT_PASS";
  /** Absent on complimentary passes and ones bought before plans existed. */
  plan?: PassPlanId;
  createdAt: ISODateString;
}

export interface ContactPass {
  id: ID;
  userId: ID;
  paymentId: ID;
  startsAt: ISODateString;
  expiresAt: ISODateString;
  status: "ACTIVE" | "EXPIRED";
  /** Absent on complimentary passes and ones bought before plans existed. */
  plan?: PassPlanId;
}

export interface PaymentOrder {
  paymentId: ID;
  providerOrderId: string;
  amount: Rupees;
  currency: "INR";
  /** Razorpay key id (public). Present only when the backend charges through Razorpay. */
  keyId?: string;
}

export interface ConfirmPaymentInput {
  paymentId: ID;
  method: PaymentMethod;
  /** Razorpay's payment id (`razorpay_payment_id`). */
  providerPaymentId?: string;
  /** Provider signature — verified server-side, never trusted from the client. */
  providerSignature?: string;
}
