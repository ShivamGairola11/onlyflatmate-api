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

export interface Verification {
  id: ID;
  userId: ID;
  type: VerificationType;
  status: VerificationStatus;
  verifiedAt?: ISODateString;
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
