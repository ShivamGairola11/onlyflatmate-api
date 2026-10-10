// Synced from the web app (src/features/profiles/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type {
  GenderPreference,
  Gender,
  ID,
  ISODateString,
  LifestyleTag,
  Rupees,
  BHK,
} from "@/types/common";

export type VerificationType = "PHONE" | "EMAIL" | "IDENTITY" | "WORKPLACE";
export type VerificationStatus = "PENDING" | "VERIFIED" | "REJECTED";

/** Government IDs accepted for identity verification. */
export type IdDocumentType = "AADHAAR" | "PAN" | "DRIVING_LICENCE" | "PASSPORT" | "VOTER_ID";

export interface Verification {
  id: ID;
  userId: ID;
  type: VerificationType;
  status: VerificationStatus;
  verifiedAt?: ISODateString;
  /** Identity: which ID was submitted. */
  documentType?: IdDocumentType;
  /** Workplace: the verified company domain, e.g. "infosys.com". */
  detail?: string;
  submittedAt?: ISODateString;
  /** Why a submission was rejected, shown to the user. */
  reviewNote?: string;
}

export type UserMode = "SEEKING" | "OFFERING";

export interface User {
  id: ID;
  name: string;
  phone?: string;
  email?: string;
  createdAt: ISODateString;
  /** Which side of the marketplace the UI should emphasise. Not a separate account. */
  mode: UserMode;
  isAdmin?: boolean;
  /** Profile photo (uploaded, or the sign-in provider's). Absent → initials. */
  avatarUrl?: string;
  /** The photo the sign-in provider (Google) has, offered as "Use Google photo". */
  providerAvatarUrl?: string;
}

export interface Profile {
  userId: ID;
  displayName: string;
  age: number;
  gender: Gender;
  profession: string;
  industry: string;
  /** Free-text area, e.g. "Cyber City, Gurugram". Never an exact address. */
  workArea?: string;
  /** Landmark id from `lib/constants/places`, used for commute estimates. */
  workplaceId?: string;
  bio?: string;
  lifestyle: LifestyleTag[];
  languages: string[];
  hometown?: string;
  verifications: Verification[];
  lookingFor?: SearchPreference;
}

export interface SearchPreference {
  areas: string[];
  budgetMin: Rupees;
  budgetMax: Rupees;
  bhk: BHK[];
  moveIn: ISODateString;
  genderPreference: GenderPreference;
}
