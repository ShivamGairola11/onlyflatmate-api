/**
 * Rule-based listing extractor for pasted social-media posts (ported from the
 * web prototype). Swap for an LLM with structured output later; keep the
 * `ImportedListing` shape.
 */
import type { BuildingType, ListingType } from '@/features/listings/types';
import type { ImportedListing } from '@/lib/api/contract';
import type { ListingDraft } from '@/lib/validation/listing';
import type { BHK, Furnishing, GenderPreference, LifestyleTag } from '@/types/common';
import type { Locality } from '../places/places.service.js';

// Display strings for the "we found…" summary (same wording as the web app's labels).
const TYPE: Record<ListingType, string> = { PRIVATE_ROOM: 'Private room', SHARED_ROOM: 'Shared room', ENTIRE_FLAT: 'Entire flat', FLATMATE_VACANCY: 'Flatmate vacancy', PG: 'PG' };
const BHK_TEXT: Record<BHK, string> = { '1RK': '1 RK', '1BHK': '1 BHK', '2BHK': '2 BHK', '3BHK': '3 BHK', '4BHK_PLUS': '4+ BHK' };
const FURNISHING: Record<Furnishing, string> = { FURNISHED: 'Fully furnished', SEMI_FURNISHED: 'Semi furnished', UNFURNISHED: 'Unfurnished' };
const BUILDING: Record<BuildingType, string> = { GATED_SOCIETY: 'Gated society', BUILDER_FLOOR: 'Builder floor', DDA_FLAT: 'DDA flat', INDEPENDENT_HOUSE: 'Independent house', STANDALONE_APARTMENT: 'Standalone apartment', OTHER: 'Other' };
const GENDER: Record<GenderPreference, string> = { MALE: 'Male', FEMALE: 'Female', ANY: 'Any' };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
const dayMonth = (iso: string) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)}`;
};

function normalise(text: string) {
  // Collapse whitespace first: the sector pattern's `\s*-?\s*` is quadratic on long runs of spaces.
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\bsec(tor)?\.?\s*-?\s*(\d+)/g, 'sector $2')
    .replace(/\bgurugram\b|\bggn\b/g, 'gurgaon');
}

function matchesLocality(t: string, l: Locality): boolean {
  const sector = l.name.match(/Sector (\d+)/);
  if (sector) {
    if (!new RegExp(`sector ${sector[1]}\\b`).test(t)) return false;
    if (l.slug.startsWith('dwarka')) return t.includes('dwarka');
    if (l.city === 'Gurugram') return t.includes('gurgaon') || (l.slug === 'sohna-road' && t.includes('sohna'));
    if (l.city === 'Noida') return t.includes('noida');
    return true;
  }
  return t.includes(l.name.toLowerCase().replace(/ phase 1$/, '').replace(/ 1$/, ''));
}

const parseRupees = (raw: string, k?: string) => Math.round(parseFloat(raw.replace(/,/g, '')) * (k ? 1000 : 1));

function parseRent(t: string): number | undefined {
  const patterns = [/(?:rent|₹|rs\.?|inr)\s*:?\s*([\d,]+(?:\.\d+)?)\s*(k)?\b/, /\b(\d{1,3}(?:\.\d)?)\s*(k)\b(?!\s*deposit)/, /\b(\d{4,6})\s*(?:\/-|per month|pm|\/month)/];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) {
      const v = parseRupees(m[1], m[2]);
      if (v >= 2000 && v <= 300000) return v;
    }
  }
  return undefined;
}

function parseDeposit(t: string, rent?: number): number | undefined {
  const months = t.match(/(\d)\s*months?'?\s*deposit/);
  if (months && rent) return rent * Number(months[1]);
  const m = t.match(/deposit\s*:?\s*(?:₹|rs\.?)?\s*([\d,]+(?:\.\d+)?)\s*(k)?/);
  return m ? parseRupees(m[1], m[2]) : undefined;
}

function parseDate(t: string): string | undefined {
  if (/\b(immediate(ly)?|asap|right away|available now)\b/.test(t)) return new Date().toISOString().slice(0, 10);
  const m1 = t.match(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  const m2 = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(${MONTHS.join('|')})[a-z]*\\b`));
  const [month, day] = m1 ? [MONTHS.indexOf(m1[1]), Number(m1[2])] : m2 ? [MONTHS.indexOf(m2[2]), Number(m2[1])] : [undefined, undefined];
  if (month === undefined || day === undefined || day < 1 || day > 31) return undefined;
  const now = new Date();
  const year = month < now.getMonth() - 1 ? now.getFullYear() + 1 : now.getFullYear();
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseListingText(text: string, localities: Locality[]): ImportedListing {
  const t = normalise(text);
  const draft: Partial<ListingDraft> = {};
  const warnings: string[] = [];

  const bhkMatch = t.match(/\b(\d)\s*bhk\b/);
  if (/\b1\s*rk\b/.test(t)) draft.bhk = '1RK';
  else if (bhkMatch) draft.bhk = (Number(bhkMatch[1]) >= 4 ? '4BHK_PLUS' : `${bhkMatch[1]}BHK`) as BHK;

  if (/\bpg\b|paying guest/.test(t)) draft.type = 'PG';
  else if (/\bflatmate\b|\broommate\b/.test(t) && !/room available/.test(t)) draft.type = 'FLATMATE_VACANCY';
  else if (/\bsharing\b|\bshared room\b|twin/.test(t)) draft.type = 'SHARED_ROOM';
  else if (/\bentire\b|\bfull flat\b|\bwhole flat\b|\bfamily\b|\bfor rent\b(?!.*room)/.test(t)) draft.type = 'ENTIRE_FLAT';
  else if (/\broom\b/.test(t)) draft.type = 'PRIVATE_ROOM';

  const locality = localities.find((l) => matchesLocality(t, l));
  if (locality) {
    draft.localitySlug = locality.slug;
    draft.exactLocation = { latitude: locality.latitude, longitude: locality.longitude, locality: locality.name, city: locality.city };
  } else warnings.push('We couldn’t find the locality — please drop a pin on the map.');

  const rent = parseRent(t);
  if (rent) draft.rent = rent;
  else warnings.push('Rent wasn’t mentioned.');
  const deposit = parseDeposit(t, rent);
  if (deposit !== undefined) draft.deposit = deposit;
  const maint = t.match(/maintenance\s*:?\s*(?:₹|rs\.?)?\s*([\d,]+)\s*(k)?/);
  if (maint) draft.maintenance = parseRupees(maint[1], maint[2]);

  const date = parseDate(t);
  if (date) draft.availableFrom = date;

  // "CGHS" is a society in Delhi parlance — kept in the lister's words.
  if (/\bcghs\b/.test(t)) Object.assign(draft, { buildingType: 'OTHER', buildingTypeOther: 'CGHS society' });
  else if (/builder floor|independent floor/.test(t)) draft.buildingType = 'BUILDER_FLOOR';
  else if (/\bdda\b/.test(t)) draft.buildingType = 'DDA_FLAT';
  else if (/gated|society|apartment complex/.test(t)) draft.buildingType = 'GATED_SOCIETY';
  else if (/independent house|kothi|bungalow/.test(t)) draft.buildingType = 'INDEPENDENT_HOUSE';

  if (/semi[\s-]?furnished/.test(t)) draft.furnishing = 'SEMI_FURNISHED';
  else if (/unfurnished/.test(t)) draft.furnishing = 'UNFURNISHED';
  else if (/furnished/.test(t)) draft.furnishing = 'FURNISHED';

  if (/\b(female|girls?|women|ladies)\b/.test(t)) draft.preferenceGender = 'FEMALE';
  else if (/\b(male|boys?|guys|men)\b/.test(t)) draft.preferenceGender = 'MALE';

  if (/\bstudents?\b/.test(t)) draft.occupation = 'STUDENT';
  else if (/\bworking\b|professional/.test(t)) draft.occupation = 'WORKING';

  const lifestyle: LifestyleTag[] = [];
  if (/non[\s-]?smok/.test(t)) lifestyle.push('NON_SMOKER');
  if (/\bveg(etarian)?\b(?!.*non)/.test(t) && !/non[\s-]?veg/.test(t)) lifestyle.push('VEGETARIAN');
  if (/pet/.test(t)) lifestyle.push('PETS_OK');
  if (lifestyle.length) draft.lifestyle = lifestyle;

  draft.description = text.trim().slice(0, 1000);

  const extracted: ImportedListing['extracted'] = [];
  if (draft.type) extracted.push({ label: 'Type', value: TYPE[draft.type] });
  if (draft.bhk) extracted.push({ label: 'Property', value: BHK_TEXT[draft.bhk] });
  if (locality) extracted.push({ label: 'Location', value: locality.name });
  if (draft.rent) extracted.push({ label: 'Rent', value: rupees(draft.rent) });
  if (draft.deposit !== undefined) extracted.push({ label: 'Deposit', value: rupees(draft.deposit) });
  if (draft.availableFrom) extracted.push({ label: 'Available', value: dayMonth(draft.availableFrom) });
  if (draft.buildingType) extracted.push({ label: 'Building', value: draft.buildingType === 'OTHER' ? (draft.buildingTypeOther ?? 'Other') : BUILDING[draft.buildingType] });
  if (draft.furnishing) extracted.push({ label: 'Furnished', value: draft.furnishing === 'UNFURNISHED' ? 'No' : FURNISHING[draft.furnishing] });
  if (draft.preferenceGender) extracted.push({ label: 'Preference', value: GENDER[draft.preferenceGender] });
  if (draft.occupation && draft.occupation !== 'ANY') extracted.push({ label: 'Occupation', value: draft.occupation === 'WORKING' ? 'Working professional' : 'Student' });

  return { draft, extracted, warnings };
}
