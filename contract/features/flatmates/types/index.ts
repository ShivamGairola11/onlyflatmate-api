// Synced from the web app (src/features/flatmates/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type {
  BHK,
  Gender,
  GenderPreference,
  ID,
  ISODateString,
  LifestyleTag,
  Rupees,
} from "@/types/common";

/** A person on the platform looking for someone to live with. */
export interface FlatmateProfile {
  id: ID;
  userId: ID;
  name: string;
  age: number;
  gender: Gender;
  profession: string;
  workArea: string;
  workplaceId?: string;
  bio: string;
  budgetMin: Rupees;
  budgetMax: Rupees;
  preferredAreas: string[];
  lookingFor: BHK[];
  moveIn: ISODateString;
  lifestyle: LifestyleTag[];
  genderPreference: GenderPreference;
  /** Already has a flat and needs a flatmate, or needs both. */
  hasPlace: boolean;
  listingId?: ID;
  languages: string[];
  verified: { phone: boolean; identity: boolean; workplace: boolean };
  lastActiveAt: ISODateString;
}

/**
 * What a person fills in to appear in Find a Flatmate. Name, age, gender,
 * profession and verification come from their account profile, not from here.
 */
export type FlatmateProfileInput = Pick<
  FlatmateProfile,
  "bio" | "budgetMin" | "budgetMax" | "preferredAreas" | "lookingFor" | "moveIn" | "lifestyle" | "genderPreference" | "hasPlace" | "languages" | "workplaceId"
> & {
  /** Defaults to the account profile's work area. */
  workArea?: string;
};

export interface FlatmateSearchParams {
  area?: string;
  budgetMax?: number;
  moveInBefore?: ISODateString;
  gender?: GenderPreference;
  lifestyle?: LifestyleTag[];
  workplaceId?: string;
  hasPlace?: boolean;
}
