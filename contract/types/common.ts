// Synced from the web app (src/types/common.ts) by scripts/sync-contract.mjs — do not edit here.
/**
 * Shared primitives used across every feature.
 * Feature-specific models live in `src/features/<feature>/types`.
 */

export type ID = string;

/** ISO-8601 timestamp string, e.g. "2026-09-30T10:00:00.000Z". */
export type ISODateString = string;

/** Monetary amounts are always stored as whole rupees (INR). */
export type Rupees = number;

export interface GeoLocation {
  latitude: number;
  longitude: number;
  locality?: string;
  city?: string;
  region?: string;
  postalCode?: string;
}

/** A rectangular viewport. Maps 1:1 onto a PostGIS `ST_MakeEnvelope` query. */
export interface GeoBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export type Gender = "MALE" | "FEMALE" | "OTHER";
export type GenderPreference = "MALE" | "FEMALE" | "ANY";

export type Furnishing = "FURNISHED" | "SEMI_FURNISHED" | "UNFURNISHED";

export type BHK = "1RK" | "1BHK" | "2BHK" | "3BHK" | "4BHK_PLUS";

export type LifestyleTag =
  | "NON_SMOKER"
  | "SMOKER_OK"
  | "EARLY_RISER"
  | "NIGHT_OWL"
  | "VERY_CLEAN"
  | "VEGETARIAN"
  | "NON_VEG_OK"
  | "PETS_OK"
  | "WFH"
  | "FITNESS"
  | "QUIET"
  | "SOCIAL"
  | "GUESTS_OK"
  | "NO_ALCOHOL";

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type ReportReason =
  | "SCAM"
  | "WRONG_INFORMATION"
  | "ALREADY_RENTED"
  | "INAPPROPRIATE_CONTENT"
  | "SUSPICIOUS_BEHAVIOUR"
  | "OTHER";

export type ReportTargetType = "LISTING" | "USER" | "GROUP";

export interface Report {
  id: ID;
  reporterId: ID;
  targetType: ReportTargetType;
  targetId: ID;
  reason: ReportReason;
  details?: string;
  createdAt: ISODateString;
  status: "OPEN" | "REVIEWED" | "ACTIONED";
}

export interface Block {
  id: ID;
  blockerId: ID;
  blockedUserId: ID;
  createdAt: ISODateString;
}
