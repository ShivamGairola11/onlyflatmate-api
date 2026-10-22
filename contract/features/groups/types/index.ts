// Synced from the web app (src/features/groups/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type { BHK, ID, ISODateString, LifestyleTag, Rupees } from "@/types/common";
import type { Listing } from "@/features/listings/types";

export type GroupMemberRole = "OWNER" | "MEMBER";
export type GroupMemberStatus = "JOINED" | "INVITED";

export interface GroupMember {
  id: ID;
  groupId: ID;
  userId?: ID;
  name: string;
  profession: string;
  budget: Rupees;
  role: GroupMemberRole;
  status: GroupMemberStatus;
  joinedAt: ISODateString;
}

/**
 * Signed-out viewers get the brief only: `ownerId` and `inviteCode` are "", `note` is absent, and each
 * member is an anonymous seat (`name`/`profession` "", `budget` 0; role and status kept for counts).
 */
export interface FlatGroup {
  id: ID;
  ownerId: ID;
  name: string;
  bhk: BHK[];
  /** Locality slugs from `lib/constants/places`. */
  areas: string[];
  totalBudget: Rupees;
  moveIn: ISODateString;
  peopleNeeded: number;
  lifestyle: LifestyleTag[];
  note?: string;
  members: GroupMember[];
  inviteCode: string;
  createdAt: ISODateString;
}

export interface CreateGroupInput {
  name: string;
  bhk: BHK[];
  areas: string[];
  totalBudget: Rupees;
  moveIn: ISODateString;
  peopleNeeded: number;
  lifestyle: LifestyleTag[];
  note?: string;
  ownerBudget: Rupees;
}

export type UpdateGroupInput = Omit<CreateGroupInput, "ownerBudget">;

export interface AddMemberInput {
  name: string;
  profession: string;
  budget: Rupees;
}

export interface MatchCriterion {
  key: "BUDGET" | "LOCATION" | "BHK" | "MOVE_IN";
  label: string;
  matched: boolean;
}

export interface GroupMatch {
  listing: Listing;
  score: number;
  criteria: MatchCriterion[];
}
