// Synced from the web app (src/lib/constants/labels.ts) by scripts/sync-contract.mjs — do not edit here.
import type { Amenity, BuildingType, ListingStatus, ListingType, MoveInWindow, PhotoArea } from "@/features/listings/types";
import type {
  BHK,
  Furnishing,
  GenderPreference,
  LifestyleTag,
  ReportReason,
} from "@/types/common";

export const LISTING_TYPE_LABEL: Record<ListingType, string> = {
  PRIVATE_ROOM: "Private room",
  SHARED_ROOM: "Shared room",
  ENTIRE_FLAT: "Entire flat",
  FLATMATE_VACANCY: "Flatmate vacancy",
  PG: "PG",
};

export const LISTING_TYPES = Object.keys(LISTING_TYPE_LABEL) as ListingType[];

export const BHK_LABEL: Record<BHK, string> = {
  "1RK": "1 RK",
  "1BHK": "1 BHK",
  "2BHK": "2 BHK",
  "3BHK": "3 BHK",
  "4BHK_PLUS": "4+ BHK",
};

export const BHK_OPTIONS = Object.keys(BHK_LABEL) as BHK[];

export const FURNISHING_LABEL: Record<Furnishing, string> = {
  FURNISHED: "Fully furnished",
  SEMI_FURNISHED: "Semi furnished",
  UNFURNISHED: "Unfurnished",
};

export const FURNISHING_OPTIONS = Object.keys(FURNISHING_LABEL) as Furnishing[];

export const BUILDING_TYPE_LABEL: Record<BuildingType, string> = {
  GATED_SOCIETY: "Gated society",
  BUILDER_FLOOR: "Builder floor",
  DDA_FLAT: "DDA flat",
  INDEPENDENT_HOUSE: "Independent house",
  STANDALONE_APARTMENT: "Standalone apartment",
  OTHER: "Other",
};

export const BUILDING_TYPE_OPTIONS = Object.keys(BUILDING_TYPE_LABEL) as BuildingType[];

/** Display label, using the lister's own words for OTHER. */
export function buildingTypeLabel(p: { buildingType?: BuildingType; buildingTypeOther?: string }): string | undefined {
  if (!p.buildingType) return undefined;
  return p.buildingType === "OTHER" ? p.buildingTypeOther?.trim() || BUILDING_TYPE_LABEL.OTHER : BUILDING_TYPE_LABEL[p.buildingType];
}

export const GENDER_PREF_LABEL: Record<GenderPreference, string> = {
  MALE: "Male",
  FEMALE: "Female",
  ANY: "Any",
};

export const MOVE_IN_LABEL: Record<MoveInWindow, string> = {
  IMMEDIATE: "Immediately",
  "15_DAYS": "Within 15 days",
  "30_DAYS": "Within 30 days",
  CUSTOM: "Custom date",
};

export const COMMUTE_OPTIONS = [20, 30, 45] as const;

export const STATUS_LABEL: Record<ListingStatus, string> = {
  ACTIVE: "Available",
  STALE: "Needs confirmation",
  EXPIRED: "Expired",
  OCCUPIED: "Occupied",
};

export const AMENITY_LABEL: Record<Amenity, string> = {
  WIFI: "Wi-Fi",
  AC: "Air conditioning",
  WASHING_MACHINE: "Washing machine",
  FRIDGE: "Fridge",
  POWER_BACKUP: "Power backup",
  PARKING: "Car parking",
  LIFT: "Lift",
  GYM: "Gym",
  SECURITY: "24×7 security",
  COOK: "Cook",
  HOUSEKEEPING: "Housekeeping",
  BALCONY: "Balcony",
  ATTACHED_BATHROOM: "Attached bathroom",
  RO_WATER: "RO water",
  TV: "TV",
  MICROWAVE: "Microwave",
  SWIMMING_POOL: "Swimming pool",
};

export const PHOTO_AREA_LABEL: Record<PhotoArea, string> = {
  BEDROOM: "Bedroom",
  BATHROOM: "Bathroom",
  BALCONY: "Balcony",
  KITCHEN: "Kitchen",
  LIVING: "Living room",
  BUILDING: "Building & outside",
};

export const PHOTO_AREAS = Object.keys(PHOTO_AREA_LABEL) as PhotoArea[];

export const AMENITY_OPTIONS = Object.keys(AMENITY_LABEL) as Amenity[];
/** Known amenities by label; a lister's own amenity is already in words. */
export const amenityLabel = (a: string) => AMENITY_LABEL[a as Amenity] ?? a;

export const LIFESTYLE_LABEL: Record<LifestyleTag, string> = {
  NON_SMOKER: "Non-smoker",
  SMOKER_OK: "Smoking OK",
  EARLY_RISER: "Early riser",
  NIGHT_OWL: "Night owl",
  VERY_CLEAN: "Clean & tidy",
  VEGETARIAN: "Vegetarian",
  NON_VEG_OK: "Non-veg OK",
  PETS_OK: "Pet friendly",
  WFH: "Works from home",
  FITNESS: "Into fitness",
  QUIET: "Quiet",
  SOCIAL: "Social",
  GUESTS_OK: "Guests OK",
  NO_ALCOHOL: "No alcohol",
};

export const LIFESTYLE_OPTIONS = Object.keys(LIFESTYLE_LABEL) as LifestyleTag[];

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  SCAM: "Scam or fraud",
  WRONG_INFORMATION: "Wrong information",
  ALREADY_RENTED: "Already rented",
  INAPPROPRIATE_CONTENT: "Inappropriate content",
  SUSPICIOUS_BEHAVIOUR: "Suspicious behaviour",
  OTHER: "Other",
};
