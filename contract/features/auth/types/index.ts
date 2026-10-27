// Synced from the web app (src/features/auth/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type { Profile, User } from "@/features/profiles/types";

export type AuthMethod = "GOOGLE" | "FACEBOOK" | "PHONE" | "EMAIL";

/** Sign-in providers that leave the page (enabled in Supabase → Authentication → Providers). */
export const OAUTH_PROVIDERS = ["google", "facebook"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

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
