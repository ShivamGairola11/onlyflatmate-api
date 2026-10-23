// Synced from the web app (src/features/listings/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type { ListingDraft } from "@/lib/validation/listing";
import type {
  BHK,
  Furnishing,
  GenderPreference,
  GeoBounds,
  GeoLocation,
  Gender,
  ID,
  ISODateString,
  LifestyleTag,
  Rupees,
} from "@/types/common";

export type ListingType =
  | "PRIVATE_ROOM"
  | "SHARED_ROOM"
  | "ENTIRE_FLAT"
  | "FLATMATE_VACANCY"
  | "PG";

export type ListingSource = "PLATFORM" | "FACEBOOK_IMPORT" | "PARTNER";

export type ListingStatus = "ACTIVE" | "STALE" | "EXPIRED" | "OCCUPIED";

export type Amenity =
  | "WIFI"
  | "AC"
  | "WASHING_MACHINE"
  | "FRIDGE"
  | "POWER_BACKUP"
  | "PARKING"
  | "LIFT"
  | "GYM"
  | "SECURITY"
  | "COOK"
  | "HOUSEKEEPING"
  | "BALCONY"
  | "ATTACHED_BATHROOM"
  | "RO_WATER"
  | "TV"
  | "MICROWAVE"
  | "SWIMMING_POOL";

/** A known amenity, or the lister's own words for one we don't list ("Basketball court"). */
export type AmenityTag = Amenity | (string & {});

/** What kind of building it is — one of the first things NCR renters filter on. */
export type BuildingType = "GATED_SOCIETY" | "BUILDER_FLOOR" | "DDA_FLAT" | "INDEPENDENT_HOUSE" | "STANDALONE_APARTMENT" | "OTHER";

export interface Property {
  bhk: BHK;
  buildingType: BuildingType;
  /** Lister's own description when buildingType is OTHER, e.g. "CGHS society". */
  buildingTypeOther?: string;
  bedrooms: number;
  bathrooms: number;
  furnishing: Furnishing;
  floor?: number;
  totalFloors?: number;
  areaSqft?: number;
  amenities: AmenityTag[];
}

export interface Room {
  /** Only meaningful for room / vacancy listings. */
  hasAttachedBathroom: boolean;
  hasBalcony: boolean;
  isAirConditioned: boolean;
  occupancy: 1 | 2 | 3;
}

/** A person already living at the property. Lightweight — not necessarily a platform user. */
/** A current resident. Signed-out viewers get age, gender and profession only: `name` is "" and `lifestyle` [] (and no `userId`). */
export interface Flatmate {
  id: ID;
  name: string;
  age: number;
  gender: Gender;
  profession: string;
  lifestyle: LifestyleTag[];
  userId?: ID;
}

export interface FlatmatePreference {
  gender: GenderPreference;
  ageMin?: number;
  ageMax?: number;
  occupation: "WORKING" | "STUDENT" | "ANY";
  lifestyle: LifestyleTag[];
  /** The lister's own words about who'd fit in. */
  note?: string;
}

export type ExtraChargeFrequency = "MONTHLY" | "ONE_TIME";

/** Anything charged on top of rent and maintenance: Wi-Fi, rented furniture, cook, a one-time cleaning fee… */
export interface ExtraCharge {
  label: string;
  amount: Rupees;
  frequency: ExtraChargeFrequency;
}

export interface ListingPricing {
  rent: Rupees;
  maintenance: Rupees;
  deposit: Rupees;
  /** Brokerage is always zero on-platform, but imported listings may carry one. */
  brokerage: Rupees;
  electricityIncluded: boolean;
  /** Up to 10. Older listings and clients may omit it. */
  extras?: ExtraCharge[];
}

/** Which part of the home a photo shows. The gallery and the room summary group photos by it. */
export type PhotoArea = "BEDROOM" | "BATHROOM" | "BALCONY" | "KITCHEN" | "LIVING" | "BUILDING";

export interface ListingPhoto {
  id: ID;
  url: string;
  caption?: string;
  /** Older listings and imports have none. */
  area?: PhotoArea;
}

/**
 * Public representation of a listing.
 *
 * `location` is ALWAYS the approximate (fuzzed) point. The exact point
 * is stored server-side only (`ListingPrivateLocation`) and never leaves the API.
 */
export interface Listing {
  id: ID;
  listerId: ID;
  type: ListingType;
  source: ListingSource;
  status: ListingStatus;
  title: string;
  description: string;
  location: GeoLocation;
  /** Radius (m) of the privacy circle around the approximate point. */
  locationPrecisionMeters: number;
  property: Property;
  room?: Room;
  pricing: ListingPricing;
  flatmates: Flatmate[];
  preference: FlatmatePreference;
  availableFrom: ISODateString;
  photos: ListingPhoto[];
  createdAt: ISODateString;
  updatedAt: ISODateString;
  lastConfirmedAt: ISODateString;
  /** When it's deleted automatically unless the lister confirms first (confirming pushes it back). Absent for occupied listings. Set by the API. */
  deletesAt?: ISODateString;
  viewCount: number;
}

export interface ListingPrivateLocation {
  listingId: ID;
  exact: GeoLocation;
  addressLine?: string;
}

/** One in-progress "Have a Place" draft per user, saved as they go. */
export interface ListingDraftRecord {
  userId: ID;
  values: Partial<ListingDraft>;
  updatedAt: ISODateString;
}

/** What the owner sees when editing: the public listing plus its private location. */
export interface EditableListing {
  listing: Listing;
  exactLocation: GeoLocation;
  addressLine?: string;
}

export type UpdateListingInput = Omit<CreateListingInput, "source">;

export interface SavedListing {
  id: ID;
  userId: ID;
  listingId: ID;
  savedAt: ISODateString;
}

export type MoveInWindow = "IMMEDIATE" | "15_DAYS" | "30_DAYS" | "CUSTOM";

export type SortOrder = "RECOMMENDED" | "PRICE_ASC" | "PRICE_DESC" | "NEWEST" | "COMMUTE";

/** Query contract for `GET /listings`. Mirrors the future NestJS DTO. */
export interface ListingSearchParams {
  area?: string;
  bounds?: GeoBounds;
  minRent?: number;
  maxRent?: number;
  types?: ListingType[];
  bhk?: BHK[];
  furnishing?: Furnishing[];
  buildingTypes?: BuildingType[];
  /** Listings must have every one of these. */
  amenities?: Amenity[];
  gender?: GenderPreference;
  moveIn?: MoveInWindow;
  moveInDate?: ISODateString;
  workplaceId?: string;
  maxCommuteMinutes?: number;
  sort?: SortOrder;
  includeInactive?: boolean;
}

export interface CreateListingInput {
  type: ListingType;
  exactLocation: GeoLocation;
  addressLine?: string;
  property: Property;
  room?: Room;
  pricing: ListingPricing;
  flatmates: Omit<Flatmate, "id">[];
  preference: FlatmatePreference;
  availableFrom: ISODateString;
  photos: string[];
  /** Same order as `photos`: the area each one shows (null when unknown). */
  photoAreas?: (PhotoArea | null)[];
  title?: string;
  description?: string;
  source?: ListingSource;
}
