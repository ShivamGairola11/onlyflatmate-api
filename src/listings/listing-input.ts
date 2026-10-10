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
    }),
    flatmates: z.array(z.object({ name: z.string().trim().min(1).max(40), age: z.number().int().min(18).max(80), gender: z.enum(['MALE', 'FEMALE', 'OTHER']), profession: z.string().trim().max(60), lifestyle })).max(6),
    preference: z.object({
      gender: z.enum(['MALE', 'FEMALE', 'ANY']),
      ageMin: z.number().int().min(18).max(80).optional(),
      ageMax: z.number().int().min(18).max(80).optional(),
      occupation: z.enum(['WORKING', 'STUDENT', 'ANY']),
      lifestyle,
    }),
    availableFrom: z.iso.datetime().or(z.iso.date()),
    photos: z.array(z.url()).max(8),
    title: z.string().trim().max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    source: z.enum(['PLATFORM', 'FACEBOOK_IMPORT', 'PARTNER']).optional(),
  })
  .refine((d) => d.property.buildingType !== 'OTHER' || (d.property.buildingTypeOther?.length ?? 0) >= 2, { path: ['property', 'buildingTypeOther'], message: 'Describe the building' });

export type ListingInput = z.infer<typeof listingInput>;
