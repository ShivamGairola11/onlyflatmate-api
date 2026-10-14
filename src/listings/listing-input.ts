import { z } from 'zod';
import { cityAt } from '@/lib/constants/places';

/** Server-side check of CreateListingInput / UpdateListingInput (the browser is never trusted). */
const lifestyle = z.array(z.string().max(30)).max(14);
/** Inside one of the metros we serve — the same list the web app validates against. */
const cityPoint = z
  .object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    locality: z.string().max(80).optional(),
    city: z.string().max(60).optional(),
    region: z.string().max(60).optional(),
    postalCode: z.string().max(12).optional(),
  })
  .refine((p) => !!cityAt(p), { message: 'This location is outside the cities we serve.' });

export const listingInput = z
  .object({
    type: z.enum(['PRIVATE_ROOM', 'SHARED_ROOM', 'ENTIRE_FLAT', 'FLATMATE_VACANCY', 'PG']),
    exactLocation: cityPoint,
    addressLine: z.string().trim().max(140).optional(),
    property: z.object({
      bhk: z.enum(['1RK', '1BHK', '2BHK', '3BHK', '4BHK_PLUS']),
      buildingType: z.enum(['GATED_SOCIETY', 'BUILDER_FLOOR', 'DDA_FLAT', 'INDEPENDENT_HOUSE', 'STANDALONE_APARTMENT', 'OTHER']),
      buildingTypeOther: z.string().trim().max(60).optional(),
      bedrooms: z.number().int().min(1).max(10),
      bathrooms: z.number().int().min(1).max(10),
      furnishing: z.enum(['FURNISHED', 'SEMI_FURNISHED', 'UNFURNISHED']),
      floor: z.number().int().min(-2).max(100).optional(),
      totalFloors: z.number().int().min(1).max(100).optional(),
      areaSqft: z.number().int().min(50).max(20000).optional(),
      amenities: z.array(z.string().max(30)).max(20),
    }),
    room: z.object({ hasAttachedBathroom: z.boolean(), hasBalcony: z.boolean(), isAirConditioned: z.boolean(), occupancy: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).optional(),
    pricing: z.object({
      rent: z.number().int().min(2000).max(300000),
      maintenance: z.number().int().min(0).max(50000),
      deposit: z.number().int().min(0).max(1000000),
      brokerage: z.number().int().min(0).max(1000000),
      electricityIncluded: z.boolean(),
      extras: z
        .array(z.object({ label: z.string().trim().min(2).max(40), amount: z.number().int().min(1).max(200000), frequency: z.enum(['MONTHLY', 'ONE_TIME']) }))
        .max(10)
        .default([]),
    }),
    flatmates: z.array(z.object({ name: z.string().trim().min(1).max(40), age: z.number().int().min(18).max(80), gender: z.enum(['MALE', 'FEMALE', 'OTHER']), profession: z.string().trim().max(60), lifestyle })).max(6),
    preference: z.object({
      gender: z.enum(['MALE', 'FEMALE', 'ANY']),
      ageMin: z.number().int().min(18).max(80).optional(),
      ageMax: z.number().int().min(18).max(80).optional(),
      occupation: z.enum(['WORKING', 'STUDENT', 'ANY']),
      lifestyle,
      note: z.string().trim().max(300).optional(),
    }),
    availableFrom: z.iso.datetime().or(z.iso.date()),
    photos: z.array(z.url()).max(15),
    /** Same order as `photos`. */
    photoAreas: z.array(z.enum(['BEDROOM', 'BATHROOM', 'BALCONY', 'KITCHEN', 'LIVING', 'BUILDING']).nullable()).max(15).optional(),
    title: z.string().trim().max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    source: z.enum(['PLATFORM', 'FACEBOOK_IMPORT']).optional(),
  })
  .refine((d) => d.property.buildingType !== 'OTHER' || (d.property.buildingTypeOther?.length ?? 0) >= 2, { path: ['property', 'buildingTypeOther'], message: 'Describe the building' })
  .refine((d) => d.property.floor == null || d.property.totalFloors == null || d.property.floor <= d.property.totalFloors, { path: ['property', 'floor'], message: 'The floor can’t be above the top floor' });

export type ListingInput = z.infer<typeof listingInput>;

/** Every free-text field a listing shows to others. */
export const listingTexts = (i: ListingInput) => [
  i.title,
  i.description,
  i.property.buildingTypeOther,
  i.preference.note,
  ...i.pricing.extras.map((x) => x.label),
  ...i.flatmates.flatMap((f) => [f.name, f.profession]),
];
