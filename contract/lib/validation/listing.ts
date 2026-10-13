// Synced from the web app (src/lib/validation/listing.ts) by scripts/sync-contract.mjs — do not edit here.
import { z } from "zod";
import type { Amenity, BuildingType, ListingType, PhotoArea } from "@/features/listings/types";
import type { BHK, Furnishing, LifestyleTag } from "@/types/common";
import { CITIES, cityAt } from "@/lib/constants/places";
import { CONTACT_INFO_MESSAGE, findContactInfo } from "./contact-info";
import { AMENITY_OPTIONS, BHK_OPTIONS, PHOTO_AREAS, BUILDING_TYPE_OPTIONS, FURNISHING_OPTIONS, LIFESTYLE_OPTIONS, LISTING_TYPES } from "@/lib/constants/labels";

type Tuple<T extends string> = [T, ...T[]];

const listingType = z.enum(LISTING_TYPES as Tuple<ListingType>, { error: "Pick what you’re offering" });
const bhk = z.enum(BHK_OPTIONS as Tuple<BHK>, { error: "Pick the size of the home" });
const furnishing = z.enum(FURNISHING_OPTIONS as Tuple<Furnishing>, { error: "Say how furnished it is" });
const buildingType = z.enum(BUILDING_TYPE_OPTIONS as Tuple<BuildingType>, { error: "Choose the type of building" });
const amenity = z.enum(AMENITY_OPTIONS as Tuple<Amenity>);
const lifestyle = z.enum(LIFESTYLE_OPTIONS as Tuple<LifestyleTag>);
const photoArea = z.enum(PHOTO_AREAS as Tuple<PhotoArea>);

export const MAX_PHOTOS = 15;

/** Listings that rent out a room (not the whole flat): renters ask about its bathroom and balcony first. */
export const isRoomListing = (type?: ListingType) => !!type && type !== "ENTIRE_FLAT";
/** Free text people write: never a phone number or email (the API enforces the same). */
const noContact = <T extends z.ZodType<string | undefined>>(s: T) => s.refine((t) => !findContactInfo(t), CONTACT_INFO_MESSAGE);

/** A listing's pin must sit inside one of the metros we serve (the same check runs in the API). */
const geo = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    locality: z.string().optional(),
    city: z.string().optional(),
    region: z.string().optional(),
    postalCode: z.string().optional(),
  })
  .refine((p) => !!cityAt(p), { message: `We're live in ${CITIES.map((c) => c.name).join(", ")} — drop the pin inside one of these cities.` });

export const residentSchema = z.object({
  name: noContact(z.string().trim().min(1, "Name is required").max(40)),
  age: z.number({ error: "Age is required" }).int().min(18, "Must be 18+").max(80),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  profession: noContact(z.string().trim().min(2, "Add a profession").max(60)),
});

/** Single source of truth for the "Have a Place" wizard. Mirrors CreateListingDto on the backend. */
export const listingDraftSchema = z
  .object({
    type: listingType,
    localitySlug: z.string().optional(),
    exactLocation: geo.optional(),
    addressLine: z.string().max(140).optional(),
    bhk,
    buildingType,
    buildingTypeOther: noContact(z.string().trim().max(60, "Keep it under 60 characters").optional()),
    bathrooms: z.number({ error: "Pick the number of bathrooms" }).int().min(1, "Pick the number of bathrooms").max(6),
    furnishing,
    amenities: z.array(amenity),
    /** Room listings only: does the room have its own bathroom and balcony? */
    roomBathroom: z.enum(["ATTACHED", "SHARED"]).optional(),
    roomBalcony: z.boolean().optional(),
    rent: z.number({ error: "Enter the monthly rent" }).int().min(2000, "Rent looks too low").max(300000, "Rent looks too high"),
    deposit: z.number({ error: "Enter a deposit (0 if none)" }).int().min(0).max(1000000),
    maintenance: z.number({ error: "Enter maintenance (0 if none)" }).int().min(0).max(50000),
    /** Lister is a broker, or brokerage is charged on this place. Shown on every card when true. */
    hasBrokerage: z.boolean().optional(),
    extras: z
      .array(
        z.object({
          label: noContact(z.string().trim().min(2, "Name the charge, e.g. Wi-Fi").max(40, "Keep it under 40 characters")),
          amount: z.number({ error: "Enter the amount" }).int().min(1, "Enter the amount").max(200000, "That looks too high"),
          frequency: z.enum(["MONTHLY", "ONE_TIME"]),
        }),
      )
      .max(10),
    brokerage: z.number().int().min(0).max(1000000).optional(),
    residents: z.array(residentSchema).max(6),
    preferenceGender: z.enum(["MALE", "FEMALE", "ANY"]),
    ageMin: z.number().int().min(18).max(80).optional(),
    ageMax: z.number().int().min(18).max(80).optional(),
    occupation: z.enum(["WORKING", "STUDENT", "ANY"]),
    lifestyle: z.array(lifestyle),
    preferenceNote: noContact(z.string().trim().max(300, "Keep it under 300 characters").optional()),
    availableFrom: z.string().min(1, "Pick a date"),
    photos: z.array(z.string()).max(MAX_PHOTOS),
    /** Same order as `photos`; null for photos added before areas existed. */
    photoAreas: z.array(photoArea.nullable()).max(MAX_PHOTOS).optional(),
    description: noContact(z.string().max(1000).optional()),
  })
  .refine((d) => !!d.exactLocation, { path: ["exactLocation"], message: "Drop a pin or search for your location" })
  .refine((d) => d.buildingType !== "OTHER" || (d.buildingTypeOther?.trim().length ?? 0) >= 2, {
    path: ["buildingTypeOther"],
    message: "Describe the building, e.g. CGHS society",
  })
  .refine((d) => !isRoomListing(d.type) || !!d.roomBathroom, { path: ["roomBathroom"], message: "Say whether the room has its own bathroom" })
  .refine((d) => !isRoomListing(d.type) || d.roomBalcony !== undefined, { path: ["roomBalcony"], message: "Say whether the room has a balcony" })
  .refine((d) => !d.hasBrokerage || (Number.isFinite(d.brokerage) && (d.brokerage ?? 0) >= 1), {
    path: ["brokerage"],
    message: "Enter the brokerage amount",
  })
  .refine((d) => d.ageMin === undefined || d.ageMax === undefined || d.ageMin <= d.ageMax, {
    path: ["ageMax"],
    message: "Max age must be above min age",
  });

export type ListingDraft = z.infer<typeof listingDraftSchema>;

export const createGroupSchema = z.object({
  name: noContact(z.string().trim().min(3, "Give your group a name").max(60)),
  bhk: z.array(bhk).min(1, "Pick at least one"),
  areas: z.array(z.string()).min(1, "Pick at least one area"),
  totalBudget: z.number({ error: "Enter a budget" }).int().min(5000, "Budget looks too low").max(500000),
  moveIn: z.string().min(1, "Pick a month"),
  peopleNeeded: z.number().int().min(2).max(6),
  ownerBudget: z.number({ error: "Enter your share" }).int().min(2000).max(200000),
  lifestyle: z.array(lifestyle),
  note: noContact(z.string().max(280).optional()),
});

export type CreateGroupForm = z.infer<typeof createGroupSchema>;

export const addMemberSchema = z.object({
  name: noContact(z.string().trim().min(1, "Name is required").max(40)),
  profession: noContact(z.string().trim().min(2, "Add a profession").max(60)),
  budget: z.number({ error: "Enter their budget" }).int().min(2000).max(200000),
});

export type AddMemberForm = z.infer<typeof addMemberSchema>;

/** Mirrors the backend's FlatmateProfileDto (identity fields come from the account). */
export const flatmateProfileSchema = z
  .object({
    bio: noContact(z.string().trim().min(20, "Say a little about yourself (20+ characters)").max(500)),
    budgetMin: z.number({ error: "Enter a minimum" }).int().min(2000).max(200000),
    budgetMax: z.number({ error: "Enter a maximum" }).int().min(2000).max(200000),
    preferredAreas: z.array(z.string()).min(1, "Add at least one area").max(5),
    lookingFor: z.array(bhk).min(1, "Pick at least one"),
    moveIn: z.string().min(1, "Pick a month"),
    lifestyle: z.array(lifestyle).max(8),
    genderPreference: z.enum(["MALE", "FEMALE", "ANY"]),
    hasPlace: z.boolean(),
    languages: z.array(z.string()),
    workArea: noContact(z.string().max(80).optional()),
    workplaceId: z.string().optional(),
  })
  .refine((d) => d.budgetMin <= d.budgetMax, { path: ["budgetMax"], message: "Max must be above min" });

export type FlatmateProfileForm = z.infer<typeof flatmateProfileSchema>;

export const messageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
