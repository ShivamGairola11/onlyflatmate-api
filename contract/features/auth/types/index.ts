// Synced from the web app (src/features/auth/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type { Profile, User } from "@/features/profiles/types";

export type AuthMethod = "GOOGLE" | "PHONE" | "EMAIL";

export type DemoPersona = "SEEKER" | "LISTER" | "FLATMATE_SEEKER" | "GROUP_CREATOR";

export interface Session {
  user: User;
  profile: Profile;
  persona?: DemoPersona;
}

export interface OtpChallenge {
  challengeId: string;
  /** e.g. "+91 98••• ••210", safe to show back to the user. */
  maskedPhone: string;
  expiresAt: string;
  /** The resend button stays disabled until this many seconds have passed. */
  resendAfterSeconds: number;
}
