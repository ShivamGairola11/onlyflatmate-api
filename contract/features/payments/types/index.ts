// Synced from the web app (src/features/payments/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type { ID, ISODateString, Rupees } from "@/types/common";

export type PaymentStatus = "CREATED" | "PENDING" | "SUCCEEDED" | "FAILED";
export type PaymentProvider = "MOCK" | "RAZORPAY" | "STRIPE";
export type PaymentMethod = "UPI" | "CARD" | "NETBANKING";

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
  createdAt: ISODateString;
}

export interface ContactPass {
  id: ID;
  userId: ID;
  paymentId: ID;
  startsAt: ISODateString;
  expiresAt: ISODateString;
  status: "ACTIVE" | "EXPIRED";
}

export interface PaymentOrder {
  paymentId: ID;
  providerOrderId: string;
  amount: Rupees;
  currency: "INR";
}

export interface ConfirmPaymentInput {
  paymentId: ID;
  method: PaymentMethod;
  /** Provider signature — verified server-side, never trusted from the client. */
  providerSignature?: string;
}
