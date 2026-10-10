// Synced from the web app (src/lib/constants/places.ts) by scripts/sync-contract.mjs — do not edit here.
import { distanceKm } from "@/lib/utils/geo";
import type { GeoBounds, GeoLocation } from "@/types/common";

/**
 * Static gazetteer: the metros we serve, their localities and landmarks. The API's `localities` /
 * `landmarks` tables hold the same rows (Delhi NCR via seed, the other metros via migration 20261011).
 */

/** The Tier-1 metros FindFlatmates covers. */
export type CityId = "delhi-ncr" | "mumbai" | "bengaluru" | "hyderabad" | "chennai" | "kolkata" | "pune" | "ahmedabad";

/** Delhi NCR is split into sub-regions (commute estimates use them); every other metro is one region. */
export type Region =
  | "DELHI_WEST"
  | "DELHI_SOUTH"
  | "DELHI_NORTH"
  | "DELHI_EAST"
  | "DELHI_CENTRAL"
  | "GURUGRAM"
  | "NOIDA"
  | "GHAZIABAD"
  | "MUMBAI"
  | "BENGALURU"
  | "HYDERABAD"
  | "CHENNAI"
  | "KOLKATA"
  | "PUNE"
  | "AHMEDABAD";

export interface City {
  id: CityId;
  name: string;
  state: string;
  center: GeoLocation;
  zoom: number;
  /** The metro area, including its satellite cities. A listing must sit inside one of these. */
  bounds: GeoBounds;
}

export const CITIES: City[] = [
  { id: "delhi-ncr", name: "Delhi NCR", state: "Delhi", center: { latitude: 28.58, longitude: 77.2 }, zoom: 10, bounds: { south: 28.1, west: 76.55, north: 29.05, east: 77.85 } },
  { id: "mumbai", name: "Mumbai", state: "Maharashtra", center: { latitude: 19.076, longitude: 72.8777 }, zoom: 10.6, bounds: { south: 18.85, west: 72.75, north: 19.45, east: 73.2 } },
  { id: "bengaluru", name: "Bengaluru", state: "Karnataka", center: { latitude: 12.9716, longitude: 77.5946 }, zoom: 10.8, bounds: { south: 12.75, west: 77.4, north: 13.25, east: 77.85 } },
  { id: "hyderabad", name: "Hyderabad", state: "Telangana", center: { latitude: 17.43, longitude: 78.43 }, zoom: 10.8, bounds: { south: 17.2, west: 78.2, north: 17.65, east: 78.7 } },
  { id: "chennai", name: "Chennai", state: "Tamil Nadu", center: { latitude: 13.0475, longitude: 80.22 }, zoom: 10.8, bounds: { south: 12.75, west: 80.05, north: 13.25, east: 80.35 } },
  { id: "kolkata", name: "Kolkata", state: "West Bengal", center: { latitude: 22.5726, longitude: 88.3939 }, zoom: 11, bounds: { south: 22.4, west: 88.2, north: 22.75, east: 88.55 } },
  { id: "pune", name: "Pune", state: "Maharashtra", center: { latitude: 18.5404, longitude: 73.8567 }, zoom: 11, bounds: { south: 18.4, west: 73.7, north: 18.7, east: 74.0 } },
  { id: "ahmedabad", name: "Ahmedabad", state: "Gujarat", center: { latitude: 23.0425, longitude: 72.5714 }, zoom: 11, bounds: { south: 22.9, west: 72.45, north: 23.25, east: 72.7 } },
];
export const DEFAULT_CITY: CityId = "delhi-ncr";
/** The map camera may roam anywhere in India; listings are still limited to the metros above. */
export const INDIA_BOUNDS: GeoBounds = { south: 6, west: 68, north: 37.5, east: 97.5 };

export interface Locality {
  slug: string;
  name: string;
  /** Display city ("Gurugram", "Thane", "Mumbai" …) — the metro is `cityOfRegion(region)`. */
  city: string;
  region: Region;
  latitude: number;
  longitude: number;
  /** Approx. radius (km) considered "in" the locality for area search. */
  radiusKm: number;
  nearestMetro?: string;
}

export type LandmarkKind = "WORKPLACE" | "COLLEGE";

export interface Landmark {
  id: string;
  name: string;
  shortName: string;
  kind: LandmarkKind;
  city: string;
  region: Region;
  latitude: number;
  longitude: number;
}

export const LOCALITIES: Locality[] = [
  // West Delhi
  { slug: "dwarka-sector-6", name: "Dwarka Sector 6", city: "New Delhi", region: "DELHI_WEST", latitude: 28.5893, longitude: 77.0667, radiusKm: 1.6, nearestMetro: "Dwarka Sector 10" },
  { slug: "dwarka-sector-10", name: "Dwarka Sector 10", city: "New Delhi", region: "DELHI_WEST", latitude: 28.5812, longitude: 77.0573, radiusKm: 1.4, nearestMetro: "Dwarka Sector 10" },
  { slug: "dwarka-sector-12", name: "Dwarka Sector 12", city: "New Delhi", region: "DELHI_WEST", latitude: 28.5921, longitude: 77.0407, radiusKm: 1.4, nearestMetro: "Dwarka Sector 12" },
  { slug: "dwarka-sector-21", name: "Dwarka Sector 21", city: "New Delhi", region: "DELHI_WEST", latitude: 28.5523, longitude: 77.0584, radiusKm: 1.6, nearestMetro: "Dwarka Sector 21" },
  { slug: "janakpuri", name: "Janakpuri", city: "New Delhi", region: "DELHI_WEST", latitude: 28.6219, longitude: 77.0878, radiusKm: 2, nearestMetro: "Janakpuri West" },
  { slug: "rajouri-garden", name: "Rajouri Garden", city: "New Delhi", region: "DELHI_WEST", latitude: 28.6492, longitude: 77.1226, radiusKm: 1.6, nearestMetro: "Rajouri Garden" },
  // North Delhi
  { slug: "mukherjee-nagar", name: "Mukherjee Nagar", city: "New Delhi", region: "DELHI_NORTH", latitude: 28.7061, longitude: 77.2106, radiusKm: 1.4, nearestMetro: "GTB Nagar" },
  { slug: "kamla-nagar", name: "Kamla Nagar", city: "New Delhi", region: "DELHI_NORTH", latitude: 28.6814, longitude: 77.2046, radiusKm: 1.2, nearestMetro: "Vishwavidyalaya" },
  { slug: "pitampura", name: "Pitampura", city: "New Delhi", region: "DELHI_NORTH", latitude: 28.7033, longitude: 77.1321, radiusKm: 1.8, nearestMetro: "Pitampura" },
  // Central / South Delhi
  { slug: "karol-bagh", name: "Karol Bagh", city: "New Delhi", region: "DELHI_CENTRAL", latitude: 28.6519, longitude: 77.1909, radiusKm: 1.4, nearestMetro: "Karol Bagh" },
  { slug: "lajpat-nagar", name: "Lajpat Nagar", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5677, longitude: 77.2433, radiusKm: 1.4, nearestMetro: "Lajpat Nagar" },
  { slug: "greater-kailash", name: "Greater Kailash", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5482, longitude: 77.2380, radiusKm: 1.5, nearestMetro: "Kailash Colony" },
  { slug: "saket", name: "Saket", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5245, longitude: 77.2066, radiusKm: 1.5, nearestMetro: "Saket" },
  { slug: "malviya-nagar", name: "Malviya Nagar", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5355, longitude: 77.2100, radiusKm: 1.2, nearestMetro: "Malviya Nagar" },
  { slug: "hauz-khas", name: "Hauz Khas", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5494, longitude: 77.2001, radiusKm: 1.3, nearestMetro: "Hauz Khas" },
  { slug: "kalkaji", name: "Kalkaji", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5397, longitude: 77.2590, radiusKm: 1.3, nearestMetro: "Kalkaji Mandir" },
  { slug: "munirka", name: "Munirka", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5580, longitude: 77.1720, radiusKm: 1.1, nearestMetro: "Munirka" },
  { slug: "vasant-kunj", name: "Vasant Kunj", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5200, longitude: 77.1580, radiusKm: 1.8 },
  // East Delhi
  { slug: "laxmi-nagar", name: "Laxmi Nagar", city: "New Delhi", region: "DELHI_EAST", latitude: 28.6304, longitude: 77.2773, radiusKm: 1.3, nearestMetro: "Laxmi Nagar" },
  { slug: "mayur-vihar", name: "Mayur Vihar Phase 1", city: "New Delhi", region: "DELHI_EAST", latitude: 28.6080, longitude: 77.2940, radiusKm: 1.4, nearestMetro: "Mayur Vihar-I" },
  // Gurugram
  { slug: "dlf-phase-1", name: "DLF Phase 1", city: "Gurugram", region: "GURUGRAM", latitude: 28.4720, longitude: 77.0980, radiusKm: 1.4, nearestMetro: "Sikanderpur" },
  { slug: "dlf-phase-3", name: "DLF Phase 3", city: "Gurugram", region: "GURUGRAM", latitude: 28.4930, longitude: 77.0960, radiusKm: 1.2, nearestMetro: "Moulsari Avenue" },
  { slug: "sushant-lok", name: "Sushant Lok 1", city: "Gurugram", region: "GURUGRAM", latitude: 28.4637, longitude: 77.0748, radiusKm: 1.2, nearestMetro: "IFFCO Chowk" },
  { slug: "gurgaon-sector-14", name: "Sector 14, Gurugram", city: "Gurugram", region: "GURUGRAM", latitude: 28.4690, longitude: 77.0450, radiusKm: 1.2 },
  { slug: "gurgaon-sector-43", name: "Sector 43, Gurugram", city: "Gurugram", region: "GURUGRAM", latitude: 28.4568, longitude: 77.0968, radiusKm: 1.2, nearestMetro: "Sector 42-43" },
  { slug: "gurgaon-sector-52", name: "Sector 52, Gurugram", city: "Gurugram", region: "GURUGRAM", latitude: 28.4400, longitude: 77.0740, radiusKm: 1.3, nearestMetro: "Sector 53-54" },
  { slug: "gurgaon-sector-57", name: "Sector 57, Gurugram", city: "Gurugram", region: "GURUGRAM", latitude: 28.4230, longitude: 77.0760, radiusKm: 1.3 },
  { slug: "sohna-road", name: "Sohna Road, Sector 49", city: "Gurugram", region: "GURUGRAM", latitude: 28.4125, longitude: 77.0490, radiusKm: 1.6 },
  // Noida
  { slug: "noida-sector-18", name: "Sector 18, Noida", city: "Noida", region: "NOIDA", latitude: 28.5700, longitude: 77.3218, radiusKm: 1.2, nearestMetro: "Noida Sector 18" },
  { slug: "noida-sector-50", name: "Sector 50, Noida", city: "Noida", region: "NOIDA", latitude: 28.5710, longitude: 77.3640, radiusKm: 1.2, nearestMetro: "Noida Sector 51" },
  { slug: "noida-sector-62", name: "Sector 62, Noida", city: "Noida", region: "NOIDA", latitude: 28.6270, longitude: 77.3650, radiusKm: 1.5, nearestMetro: "Noida Sector 62" },
  { slug: "noida-sector-75", name: "Sector 75, Noida", city: "Noida", region: "NOIDA", latitude: 28.5760, longitude: 77.3830, radiusKm: 1.2 },
  { slug: "noida-sector-137", name: "Sector 137, Noida", city: "Noida", region: "NOIDA", latitude: 28.5100, longitude: 77.4030, radiusKm: 1.4, nearestMetro: "Noida Sector 137" },
  // Ghaziabad
  { slug: "indirapuram", name: "Indirapuram", city: "Ghaziabad", region: "GHAZIABAD", latitude: 28.6400, longitude: 77.3700, radiusKm: 1.8 },
  { slug: "vaishali", name: "Vaishali", city: "Ghaziabad", region: "GHAZIABAD", latitude: 28.6450, longitude: 77.3400, radiusKm: 1.4, nearestMetro: "Vaishali" },
  // ── Tier-1 metros (geocoded from OpenStreetMap; see scripts note in docs) ──
  // Mumbai
  { slug: "andheri-west", name: "Andheri West", city: "Mumbai", region: "MUMBAI", latitude: 19.1172, longitude: 72.834, radiusKm: 1.5 },
  { slug: "andheri-east", name: "Andheri East", city: "Mumbai", region: "MUMBAI", latitude: 19.1159, longitude: 72.8542, radiusKm: 1.5 },
  { slug: "powai", name: "Powai", city: "Mumbai", region: "MUMBAI", latitude: 19.1187, longitude: 72.9073, radiusKm: 1.5 },
  { slug: "bandra-west", name: "Bandra West", city: "Mumbai", region: "MUMBAI", latitude: 19.0583, longitude: 72.8303, radiusKm: 1.5 },
  { slug: "goregaon-east", name: "Goregaon East", city: "Mumbai", region: "MUMBAI", latitude: 19.1693, longitude: 72.8553, radiusKm: 1.5 },
  { slug: "malad-west", name: "Malad West", city: "Mumbai", region: "MUMBAI", latitude: 19.184, longitude: 72.8412, radiusKm: 1.5 },
  { slug: "lower-parel", name: "Lower Parel", city: "Mumbai", region: "MUMBAI", latitude: 19.003, longitude: 72.8303, radiusKm: 1.5 },
  { slug: "chembur", name: "Chembur", city: "Mumbai", region: "MUMBAI", latitude: 19.0548, longitude: 72.898, radiusKm: 1.5 },
  { slug: "ghatkopar", name: "Ghatkopar", city: "Mumbai", region: "MUMBAI", latitude: 19.0842, longitude: 72.9186, radiusKm: 1.5 },
  { slug: "kandivali-east", name: "Kandivali East", city: "Mumbai", region: "MUMBAI", latitude: 19.2052, longitude: 72.8626, radiusKm: 1.5 },
  { slug: "borivali-west", name: "Borivali West", city: "Mumbai", region: "MUMBAI", latitude: 19.2298, longitude: 72.8471, radiusKm: 1.5 },
  { slug: "thane-west", name: "Thane West", city: "Thane", region: "MUMBAI", latitude: 19.1865, longitude: 72.9749, radiusKm: 2.5 },
  { slug: "vashi", name: "Vashi", city: "Navi Mumbai", region: "MUMBAI", latitude: 19.0758, longitude: 72.9952, radiusKm: 1.5 },
  { slug: "kharghar", name: "Kharghar", city: "Navi Mumbai", region: "MUMBAI", latitude: 19.0258, longitude: 73.0592, radiusKm: 2.5 },
  { slug: "dadar", name: "Dadar", city: "Mumbai", region: "MUMBAI", latitude: 19.0239, longitude: 72.8382, radiusKm: 1.5 },
  // Bengaluru
  { slug: "koramangala", name: "Koramangala", city: "Bengaluru", region: "BENGALURU", latitude: 12.9357, longitude: 77.6241, radiusKm: 1.5 },
  { slug: "hsr-layout", name: "HSR Layout", city: "Bengaluru", region: "BENGALURU", latitude: 12.9116, longitude: 77.6389, radiusKm: 1.5 },
  { slug: "indiranagar", name: "Indiranagar", city: "Bengaluru", region: "BENGALURU", latitude: 12.9783, longitude: 77.6387, radiusKm: 1.5 },
  { slug: "whitefield", name: "Whitefield", city: "Bengaluru", region: "BENGALURU", latitude: 12.9696, longitude: 77.7497, radiusKm: 2.5 },
  { slug: "marathahalli", name: "Marathahalli", city: "Bengaluru", region: "BENGALURU", latitude: 12.9553, longitude: 77.6984, radiusKm: 1.5 },
  { slug: "bellandur", name: "Bellandur", city: "Bengaluru", region: "BENGALURU", latitude: 12.9292, longitude: 77.677, radiusKm: 1.5 },
  { slug: "btm-layout", name: "BTM Layout", city: "Bengaluru", region: "BENGALURU", latitude: 12.914, longitude: 77.6103, radiusKm: 1.5 },
  { slug: "electronic-city", name: "Electronic City", city: "Bengaluru", region: "BENGALURU", latitude: 12.8436, longitude: 77.6687, radiusKm: 2.5 },
  { slug: "jp-nagar", name: "JP Nagar", city: "Bengaluru", region: "BENGALURU", latitude: 12.9097, longitude: 77.5866, radiusKm: 1.5 },
  { slug: "jayanagar", name: "Jayanagar", city: "Bengaluru", region: "BENGALURU", latitude: 12.9418, longitude: 77.5869, radiusKm: 1.5 },
  { slug: "hebbal", name: "Hebbal", city: "Bengaluru", region: "BENGALURU", latitude: 13.0382, longitude: 77.5919, radiusKm: 1.5 },
  { slug: "malleshwaram", name: "Malleshwaram", city: "Bengaluru", region: "BENGALURU", latitude: 13.0027, longitude: 77.5703, radiusKm: 1.5 },
  { slug: "banashankari", name: "Banashankari", city: "Bengaluru", region: "BENGALURU", latitude: 12.9393, longitude: 77.554, radiusKm: 1.5 },
  { slug: "domlur", name: "Domlur", city: "Bengaluru", region: "BENGALURU", latitude: 12.9625, longitude: 77.6382, radiusKm: 1.5 },
  { slug: "kalyan-nagar", name: "Kalyan Nagar", city: "Bengaluru", region: "BENGALURU", latitude: 13.0221, longitude: 77.6403, radiusKm: 1.5 },
  // Hyderabad
  { slug: "gachibowli", name: "Gachibowli", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4436, longitude: 78.352, radiusKm: 2.5 },
  { slug: "madhapur", name: "Madhapur", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4409, longitude: 78.3916, radiusKm: 1.5 },
  { slug: "kondapur", name: "Kondapur", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4588, longitude: 78.3731, radiusKm: 1.5 },
  { slug: "kukatpally", name: "Kukatpally", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4931, longitude: 78.4054, radiusKm: 1.5 },
  { slug: "banjara-hills", name: "Banjara Hills", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4177, longitude: 78.4399, radiusKm: 1.5 },
  { slug: "jubilee-hills", name: "Jubilee Hills", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4308, longitude: 78.4103, radiusKm: 1.5 },
  { slug: "begumpet", name: "Begumpet", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4462, longitude: 78.463, radiusKm: 1.5 },
  { slug: "ameerpet", name: "Ameerpet", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4375, longitude: 78.4483, radiusKm: 1.5 },
  { slug: "manikonda", name: "Manikonda", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4, longitude: 78.3862, radiusKm: 1.5 },
  { slug: "miyapur", name: "Miyapur", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4982, longitude: 78.3568, radiusKm: 1.5 },
  { slug: "secunderabad", name: "Secunderabad", city: "Secunderabad", region: "HYDERABAD", latitude: 17.4337, longitude: 78.5007, radiusKm: 2.5 },
  { slug: "kokapet", name: "Kokapet", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4008, longitude: 78.3385, radiusKm: 1.5 },
  { slug: "tolichowki", name: "Tolichowki", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4003, longitude: 78.4118, radiusKm: 1.5 },
  { slug: "nallagandla", name: "Nallagandla", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4775, longitude: 78.306, radiusKm: 1.5 },
  { slug: "hitech-city", name: "Hitech City", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4508, longitude: 78.3835, radiusKm: 2.5 },
  // Chennai
  { slug: "thoraipakkam", name: "Thoraipakkam", city: "Chennai", region: "CHENNAI", latitude: 12.9492, longitude: 80.2407, radiusKm: 1.5 },
  { slug: "sholinganallur", name: "Sholinganallur", city: "Chennai", region: "CHENNAI", latitude: 12.8935, longitude: 80.2321, radiusKm: 2.5 },
  { slug: "velachery", name: "Velachery", city: "Chennai", region: "CHENNAI", latitude: 12.9802, longitude: 80.2229, radiusKm: 1.5 },
  { slug: "adyar", name: "Adyar", city: "Chennai", region: "CHENNAI", latitude: 13.0064, longitude: 80.2578, radiusKm: 1.5 },
  { slug: "t-nagar", name: "T. Nagar", city: "Chennai", region: "CHENNAI", latitude: 13.0378, longitude: 80.2318, radiusKm: 1.5 },
  { slug: "anna-nagar", name: "Anna Nagar", city: "Chennai", region: "CHENNAI", latitude: 13.0882, longitude: 80.2073, radiusKm: 1.5 },
  { slug: "porur", name: "Porur", city: "Chennai", region: "CHENNAI", latitude: 13.0325, longitude: 80.1583, radiusKm: 1.5 },
  { slug: "guindy", name: "Guindy", city: "Chennai", region: "CHENNAI", latitude: 13.0087, longitude: 80.2204, radiusKm: 1.5 },
  { slug: "tambaram", name: "Tambaram", city: "Chennai", region: "CHENNAI", latitude: 12.9214, longitude: 80.1009, radiusKm: 2.5 },
  { slug: "perungudi", name: "Perungudi", city: "Chennai", region: "CHENNAI", latitude: 12.971, longitude: 80.2418, radiusKm: 1.5 },
  { slug: "nungambakkam", name: "Nungambakkam", city: "Chennai", region: "CHENNAI", latitude: 13.0621, longitude: 80.2405, radiusKm: 1.5 },
  { slug: "mylapore", name: "Mylapore", city: "Chennai", region: "CHENNAI", latitude: 13.0316, longitude: 80.27, radiusKm: 1.5 },
  { slug: "pallavaram", name: "Pallavaram", city: "Chennai", region: "CHENNAI", latitude: 12.9655, longitude: 80.1451, radiusKm: 1.5 },
  { slug: "kodambakkam", name: "Kodambakkam", city: "Chennai", region: "CHENNAI", latitude: 13.0492, longitude: 80.2243, radiusKm: 1.5 },
  { slug: "medavakkam", name: "Medavakkam", city: "Chennai", region: "CHENNAI", latitude: 12.9195, longitude: 80.1964, radiusKm: 1.5 },
  // Kolkata
  { slug: "salt-lake", name: "Salt Lake", city: "Bidhannagar", region: "KOLKATA", latitude: 22.5904, longitude: 88.4169, radiusKm: 2.5 },
  { slug: "new-town", name: "New Town", city: "Kolkata", region: "KOLKATA", latitude: 22.5883, longitude: 88.4734, radiusKm: 2.5 },
  { slug: "rajarhat", name: "Rajarhat", city: "Kolkata", region: "KOLKATA", latitude: 22.602, longitude: 88.478, radiusKm: 2.5 },
  { slug: "ballygunge", name: "Ballygunge", city: "Kolkata", region: "KOLKATA", latitude: 22.528, longitude: 88.3659, radiusKm: 1.5 },
  { slug: "park-street", name: "Park Street", city: "Kolkata", region: "KOLKATA", latitude: 22.5552, longitude: 88.3501, radiusKm: 1.5 },
  { slug: "behala", name: "Behala", city: "Kolkata", region: "KOLKATA", latitude: 22.5016, longitude: 88.3209, radiusKm: 1.5 },
  { slug: "tollygunge", name: "Tollygunge", city: "Kolkata", region: "KOLKATA", latitude: 22.4986, longitude: 88.3454, radiusKm: 1.5 },
  { slug: "jadavpur", name: "Jadavpur", city: "Kolkata", region: "KOLKATA", latitude: 22.4955, longitude: 88.3709, radiusKm: 1.5 },
  { slug: "garia", name: "Garia", city: "Kolkata", region: "KOLKATA", latitude: 22.4727, longitude: 88.3978, radiusKm: 1.5 },
  { slug: "dum-dum", name: "Dum Dum", city: "Kolkata", region: "KOLKATA", latitude: 22.6521, longitude: 88.436, radiusKm: 2.5 },
  { slug: "kasba", name: "Kasba", city: "Kolkata", region: "KOLKATA", latitude: 22.5138, longitude: 88.3813, radiusKm: 1.5 },
  { slug: "gariahat", name: "Gariahat", city: "Kolkata", region: "KOLKATA", latitude: 22.5195, longitude: 88.3651, radiusKm: 1.5 },
  { slug: "howrah", name: "Howrah", city: "Howrah", region: "KOLKATA", latitude: 22.5736, longitude: 88.3251, radiusKm: 2.5 },
  { slug: "lake-town", name: "Lake Town", city: "Kolkata", region: "KOLKATA", latitude: 22.6057, longitude: 88.403, radiusKm: 1.5 },
  { slug: "bhowanipore", name: "Bhowanipore", city: "Kolkata", region: "KOLKATA", latitude: 22.5326, longitude: 88.3454, radiusKm: 1.5 },
  // Pune
  { slug: "hinjewadi", name: "Hinjewadi", city: "Pune", region: "PUNE", latitude: 18.5928, longitude: 73.7382, radiusKm: 1.5 },
  { slug: "wakad", name: "Wakad", city: "Pimpri-Chinchwad", region: "PUNE", latitude: 18.6022, longitude: 73.7644, radiusKm: 1.5 },
  { slug: "baner", name: "Baner", city: "Pune", region: "PUNE", latitude: 18.559, longitude: 73.7845, radiusKm: 1.5 },
  { slug: "aundh", name: "Aundh", city: "Pune", region: "PUNE", latitude: 18.5619, longitude: 73.8102, radiusKm: 1.5 },
  { slug: "kothrud", name: "Kothrud", city: "Pune", region: "PUNE", latitude: 18.5073, longitude: 73.8057, radiusKm: 1.5 },
  { slug: "viman-nagar", name: "Viman Nagar", city: "Pune", region: "PUNE", latitude: 18.5704, longitude: 73.9133, radiusKm: 1.5 },
  { slug: "kharadi", name: "Kharadi", city: "Pune", region: "PUNE", latitude: 18.5513, longitude: 73.9417, radiusKm: 1.5 },
  { slug: "koregaon-park", name: "Koregaon Park", city: "Pune", region: "PUNE", latitude: 18.5377, longitude: 73.893, radiusKm: 1.5 },
  { slug: "hadapsar", name: "Hadapsar", city: "Pune", region: "PUNE", latitude: 18.5008, longitude: 73.9379, radiusKm: 1.5 },
  { slug: "pimple-saudagar", name: "Pimple Saudagar", city: "Pimpri-Chinchwad", region: "PUNE", latitude: 18.5982, longitude: 73.7978, radiusKm: 1.5 },
  { slug: "shivajinagar", name: "Shivajinagar", city: "Pune", region: "PUNE", latitude: 18.5295, longitude: 73.8478, radiusKm: 1.5 },
  { slug: "kalyani-nagar", name: "Kalyani Nagar", city: "Pune", region: "PUNE", latitude: 18.5481, longitude: 73.9026, radiusKm: 1.5 },
  { slug: "balewadi", name: "Balewadi", city: "Pune", region: "PUNE", latitude: 18.582, longitude: 73.769, radiusKm: 1.5 },
  { slug: "wagholi", name: "Wagholi", city: "Pune", region: "PUNE", latitude: 18.5806, longitude: 73.9833, radiusKm: 2.5 },
  // Ahmedabad
  { slug: "prahlad-nagar", name: "Prahlad Nagar", city: "Ahmedabad", region: "AHMEDABAD", latitude: 22.9999, longitude: 72.505, radiusKm: 1.5 },
  { slug: "satellite", name: "Satellite", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.028, longitude: 72.519, radiusKm: 1.5 },
  { slug: "bodakdev", name: "Bodakdev", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0446, longitude: 72.5173, radiusKm: 1.5 },
  { slug: "vastrapur", name: "Vastrapur", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0401, longitude: 72.529, radiusKm: 1.5 },
  { slug: "navrangpura", name: "Navrangpura", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.036, longitude: 72.5643, radiusKm: 1.5 },
  { slug: "thaltej", name: "Thaltej", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0485, longitude: 72.5117, radiusKm: 1.5 },
  { slug: "gota", name: "Gota", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.101, longitude: 72.5408, radiusKm: 1.5 },
  { slug: "bopal", name: "Bopal", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0235, longitude: 72.4705, radiusKm: 1.5 },
  { slug: "chandkheda", name: "Chandkheda", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.1101, longitude: 72.5811, radiusKm: 1.5 },
  { slug: "maninagar", name: "Maninagar", city: "Ahmedabad", region: "AHMEDABAD", latitude: 22.9977, longitude: 72.6067, radiusKm: 1.5 },
  { slug: "paldi", name: "Paldi", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0146, longitude: 72.5635, radiusKm: 1.5 },
  { slug: "naranpura", name: "Naranpura", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0567, longitude: 72.5509, radiusKm: 1.5 },
  { slug: "ellisbridge", name: "Ellisbridge", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0232, longitude: 72.5603, radiusKm: 1.5 },
  { slug: "sola", name: "Sola", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0692, longitude: 72.5111, radiusKm: 1.5 },
  { slug: "motera", name: "Motera", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0918, longitude: 72.5973, radiusKm: 1.5 },
];

export const LANDMARKS: Landmark[] = [
  { id: "cyber-city", name: "DLF Cyber City, Gurugram", shortName: "Cyber City", kind: "WORKPLACE", city: "Gurugram", region: "GURUGRAM", latitude: 28.4950, longitude: 77.0890 },
  { id: "udyog-vihar", name: "Udyog Vihar Phase 4, Gurugram", shortName: "Udyog Vihar", kind: "WORKPLACE", city: "Gurugram", region: "GURUGRAM", latitude: 28.5020, longitude: 77.0830 },
  { id: "golf-course-road", name: "Golf Course Road, Gurugram", shortName: "Golf Course Rd", kind: "WORKPLACE", city: "Gurugram", region: "GURUGRAM", latitude: 28.4420, longitude: 77.0990 },
  { id: "aerocity", name: "Aerocity, New Delhi", shortName: "Aerocity", kind: "WORKPLACE", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5500, longitude: 77.1210 },
  { id: "connaught-place", name: "Connaught Place, New Delhi", shortName: "Connaught Place", kind: "WORKPLACE", city: "New Delhi", region: "DELHI_CENTRAL", latitude: 28.6315, longitude: 77.2167 },
  { id: "nehru-place", name: "Nehru Place, New Delhi", shortName: "Nehru Place", kind: "WORKPLACE", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5494, longitude: 77.2519 },
  { id: "okhla", name: "Okhla Phase 3, New Delhi", shortName: "Okhla", kind: "WORKPLACE", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5470, longitude: 77.2710 },
  { id: "noida-62-it", name: "Sector 62 IT Hub, Noida", shortName: "Noida Sec 62", kind: "WORKPLACE", city: "Noida", region: "NOIDA", latitude: 28.6260, longitude: 77.3700 },
  { id: "noida-125", name: "Sector 125, Noida", shortName: "Noida Sec 125", kind: "WORKPLACE", city: "Noida", region: "NOIDA", latitude: 28.5440, longitude: 77.3310 },
  { id: "iit-delhi", name: "IIT Delhi, Hauz Khas", shortName: "IIT Delhi", kind: "COLLEGE", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5450, longitude: 77.1926 },
  { id: "du-north-campus", name: "Delhi University North Campus", shortName: "DU North Campus", kind: "COLLEGE", city: "New Delhi", region: "DELHI_NORTH", latitude: 28.6880, longitude: 77.2090 },
  { id: "jnu", name: "Jawaharlal Nehru University", shortName: "JNU", kind: "COLLEGE", city: "New Delhi", region: "DELHI_SOUTH", latitude: 28.5402, longitude: 77.1662 },
  { id: "nsut", name: "NSUT, Dwarka", shortName: "NSUT", kind: "COLLEGE", city: "New Delhi", region: "DELHI_WEST", latitude: 28.6090, longitude: 77.0370 },
  { id: "amity-noida", name: "Amity University, Noida", shortName: "Amity Noida", kind: "COLLEGE", city: "Noida", region: "NOIDA", latitude: 28.5440, longitude: 77.3330 },
  // Mumbai
  { id: "bkc", name: "Bandra Kurla Complex, Mumbai", shortName: "BKC", kind: "WORKPLACE", city: "Mumbai", region: "MUMBAI", latitude: 19.0593, longitude: 72.8613 },
  { id: "lower-parel-offices", name: "Peninsula Business Park, Lower Parel", shortName: "Lower Parel", kind: "WORKPLACE", city: "Mumbai", region: "MUMBAI", latitude: 18.9987, longitude: 72.8292 },
  { id: "powai-hiranandani", name: "Hiranandani Business Park, Powai", shortName: "Powai", kind: "WORKPLACE", city: "Mumbai", region: "MUMBAI", latitude: 19.1171, longitude: 72.9098 },
  { id: "mindspace-malad", name: "Mindspace, Malad West", shortName: "Mindspace Malad", kind: "WORKPLACE", city: "Mumbai", region: "MUMBAI", latitude: 19.1848, longitude: 72.8341 },
  { id: "iit-bombay", name: "IIT Bombay, Powai", shortName: "IIT Bombay", kind: "COLLEGE", city: "Mumbai", region: "MUMBAI", latitude: 19.1326, longitude: 72.915 },
  { id: "seepz-andheri", name: "SEEPZ, Andheri East", shortName: "SEEPZ", kind: "WORKPLACE", city: "Mumbai", region: "MUMBAI", latitude: 19.1254, longitude: 72.8752 },
  // Bengaluru
  { id: "manyata-tech-park", name: "Manyata Tech Park, Hebbal", shortName: "Manyata Tech Park", kind: "WORKPLACE", city: "Bengaluru", region: "BENGALURU", latitude: 13.0483, longitude: 77.6211 },
  { id: "embassy-tech-village", name: "Embassy Tech Village, Outer Ring Road", shortName: "Embassy Tech Village", kind: "WORKPLACE", city: "Bengaluru", region: "BENGALURU", latitude: 12.9307, longitude: 77.6914 },
  { id: "electronic-city-phase-1", name: "Electronic City Phase 1", shortName: "Electronic City", kind: "WORKPLACE", city: "Bengaluru", region: "BENGALURU", latitude: 12.8497, longitude: 77.665 },
  { id: "bagmane-tech-park", name: "Bagmane Tech Park, CV Raman Nagar", shortName: "Bagmane Tech Park", kind: "WORKPLACE", city: "Bengaluru", region: "BENGALURU", latitude: 12.9788, longitude: 77.6589 },
  { id: "iisc-bangalore", name: "Indian Institute of Science, Bengaluru", shortName: "IISc", kind: "COLLEGE", city: "Bengaluru", region: "BENGALURU", latitude: 13.0222, longitude: 77.5672 },
  // Hyderabad
  { id: "hitec-city", name: "HITEC City (Cyber Towers), Madhapur", shortName: "HITEC City", kind: "WORKPLACE", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4507, longitude: 78.3801 },
  { id: "financial-district", name: "Financial District, Nanakramguda", shortName: "Financial District", kind: "WORKPLACE", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4127, longitude: 78.339 },
  { id: "mindspace-hyderabad", name: "Mindspace IT Park, Madhapur", shortName: "Mindspace", kind: "WORKPLACE", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4403, longitude: 78.38 },
  { id: "iiit-hyderabad", name: "IIIT Hyderabad, Gachibowli", shortName: "IIIT Hyderabad", kind: "COLLEGE", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4454, longitude: 78.3485 },
  { id: "osmania-university", name: "Osmania University", shortName: "Osmania University", kind: "COLLEGE", city: "Hyderabad", region: "HYDERABAD", latitude: 17.4113, longitude: 78.5274 },
  // Chennai
  { id: "tidel-park", name: "TIDEL Park, Taramani", shortName: "TIDEL Park", kind: "WORKPLACE", city: "Chennai", region: "CHENNAI", latitude: 12.9894, longitude: 80.2509 },
  { id: "olympia-tech-park", name: "Olympia Tech Park, Guindy", shortName: "Olympia Tech Park", kind: "WORKPLACE", city: "Chennai", region: "CHENNAI", latitude: 13.0149, longitude: 80.2035 },
  { id: "dlf-cybercity-chennai", name: "DLF Cybercity, Manapakkam", shortName: "DLF Cybercity", kind: "WORKPLACE", city: "Chennai", region: "CHENNAI", latitude: 13.0226, longitude: 80.1769 },
  { id: "iit-madras", name: "IIT Madras, Guindy", shortName: "IIT Madras", kind: "COLLEGE", city: "Chennai", region: "CHENNAI", latitude: 12.9942, longitude: 80.2367 },
  { id: "anna-university", name: "Anna University, Guindy", shortName: "Anna University", kind: "COLLEGE", city: "Chennai", region: "CHENNAI", latitude: 13.0106, longitude: 80.2354 },
  { id: "sipcot-siruseri", name: "SIPCOT IT Park, Siruseri", shortName: "SIPCOT Siruseri", kind: "WORKPLACE", city: "Chennai", region: "CHENNAI", latitude: 12.8315, longitude: 80.2094 },
  // Kolkata
  { id: "salt-lake-sector-v", name: "Salt Lake Sector V", shortName: "Sector V", kind: "WORKPLACE", city: "Kolkata", region: "KOLKATA", latitude: 22.5755, longitude: 88.4323 },
  { id: "park-street-offices", name: "Park Street, Kolkata", shortName: "Park Street", kind: "WORKPLACE", city: "Kolkata", region: "KOLKATA", latitude: 22.5552, longitude: 88.3501 },
  { id: "jadavpur-university", name: "Jadavpur University", shortName: "Jadavpur University", kind: "COLLEGE", city: "Kolkata", region: "KOLKATA", latitude: 22.5008, longitude: 88.3679 },
  { id: "ecospace-new-town", name: "Ecospace Business Park, New Town", shortName: "Ecospace", kind: "WORKPLACE", city: "Kolkata", region: "KOLKATA", latitude: 22.5859, longitude: 88.4891 },
  { id: "iim-calcutta", name: "IIM Calcutta, Joka", shortName: "IIM Calcutta", kind: "COLLEGE", city: "Kolkata", region: "KOLKATA", latitude: 22.4441, longitude: 88.3017 },
  // Pune
  { id: "eon-it-park", name: "EON IT Park, Kharadi", shortName: "EON Kharadi", kind: "WORKPLACE", city: "Pune", region: "PUNE", latitude: 18.5518, longitude: 73.9512 },
  { id: "commerzone-yerawada", name: "Commerzone, Yerawada", shortName: "Commerzone", kind: "WORKPLACE", city: "Pune", region: "PUNE", latitude: 18.5623, longitude: 73.8841 },
  { id: "sppu", name: "Savitribai Phule Pune University", shortName: "Pune University", kind: "COLLEGE", city: "Pune", region: "PUNE", latitude: 18.5528, longitude: 73.8266 },
  { id: "hinjewadi-phase-1", name: "Rajiv Gandhi Infotech Park, Hinjewadi", shortName: "Hinjewadi IT Park", kind: "WORKPLACE", city: "Pune", region: "PUNE", latitude: 18.5811, longitude: 73.7406 },
  { id: "magarpatta-city", name: "Magarpatta City, Hadapsar", shortName: "Magarpatta", kind: "WORKPLACE", city: "Pune", region: "PUNE", latitude: 18.5112, longitude: 73.9274 },
  // Ahmedabad
  { id: "gift-city", name: "GIFT City, Gandhinagar", shortName: "GIFT City", kind: "WORKPLACE", city: "Gandhinagar", region: "AHMEDABAD", latitude: 23.1629, longitude: 72.6887 },
  { id: "infocity-gandhinagar", name: "Infocity, Gandhinagar", shortName: "Infocity", kind: "WORKPLACE", city: "Gandhinagar", region: "AHMEDABAD", latitude: 23.1933, longitude: 72.6349 },
  { id: "iim-ahmedabad", name: "IIM Ahmedabad, Vastrapur", shortName: "IIM Ahmedabad", kind: "COLLEGE", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0309, longitude: 72.5363 },
  { id: "nirma-university", name: "Nirma University, SG Highway", shortName: "Nirma University", kind: "COLLEGE", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.1284, longitude: 72.5445 },
  { id: "sg-highway-corporate", name: "Corporate Road, Prahlad Nagar", shortName: "SG Highway", kind: "WORKPLACE", city: "Ahmedabad", region: "AHMEDABAD", latitude: 23.0062, longitude: 72.5057 },
];

const cityIndex = new Map(CITIES.map((c) => [c.id, c]));
const inBounds = (p: GeoLocation, b: GeoBounds) => p.latitude >= b.south && p.latitude <= b.north && p.longitude >= b.west && p.longitude <= b.east;

export function getCity(id: string | undefined | null): City | undefined {
  return id ? cityIndex.get(id as CityId) : undefined;
}

/** The metro a point falls in, if any. */
export function cityAt(point: GeoLocation): City | undefined {
  return CITIES.find((c) => inBounds(point, c.bounds));
}

export function cityOfRegion(region: Region): CityId {
  return region.startsWith("DELHI_") || region === "GURUGRAM" || region === "NOIDA" || region === "GHAZIABAD" ? "delhi-ncr" : (region.toLowerCase() as CityId);
}

export const localitiesIn = (city: CityId) => LOCALITIES.filter((l) => cityOfRegion(l.region) === city);
export const landmarksIn = (city: CityId) => LANDMARKS.filter((l) => cityOfRegion(l.region) === city);

const localityIndex = new Map(LOCALITIES.map((l) => [l.slug, l]));
const landmarkIndex = new Map(LANDMARKS.map((l) => [l.id, l]));

export function getLocality(slug: string | undefined | null): Locality | undefined {
  return slug ? localityIndex.get(slug) : undefined;
}

export function getLandmark(id: string | undefined | null): Landmark | undefined {
  return id ? landmarkIndex.get(id) : undefined;
}

/**
 * Whether a flatmate profile or group belongs to a metro: any of its areas (locality slugs) is there, or its
 * workplace is. Shared by the API and the mock so both scope Find a Flatmate / Find Together the same way.
 */
export function belongsToCity(city: CityId, areas: readonly string[], workplaceId?: string | null): boolean {
  if (areas.some((slug) => { const l = getLocality(slug); return !!l && cityOfRegion(l.region) === city; })) return true;
  const w = getLandmark(workplaceId);
  return !!w && cityOfRegion(w.region) === city;
}

/** Default commute destination for a metro: its first listed workplace. */
export function defaultWorkplace(city: CityId): string {
  return (landmarksIn(city).find((l) => l.kind === "WORKPLACE") ?? LANDMARKS[0]).id;
}

/** Workplace / college choices for a metro, plus the current choice if it's in another city. */
export function landmarksFor(city: CityId, currentId?: string | null): Landmark[] {
  const list = landmarksIn(city);
  const current = getLandmark(currentId);
  return current && !list.includes(current) ? [current, ...list] : list;
}

/** Nearest known locality — within the point's own metro when it's in one. */
export function nearestLocality(point: GeoLocation): Locality {
  const city = cityAt(point);
  const pool = city ? localitiesIn(city.id) : LOCALITIES;
  let best = pool[0];
  let bestD = Infinity;
  for (const l of pool) {
    const d = distanceKm(point, l);
    if (d < bestD) {
      bestD = d;
      best = l;
    }
  }
  return best;
}

/**
 * A commute destination: a known landmark, or any address / dropped pin.
 * Custom places travel as a self-describing id so they survive in the URL
 * (`?work=geo:28.49510,77.08851:DLF Cyber Hub`) without a server round-trip.
 */
export interface Destination extends Omit<Landmark, "kind"> {
  kind: LandmarkKind | "CUSTOM";
}

const CUSTOM_ID = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?::(.*))?$/;

export function customDestinationId(point: GeoLocation, name: string): string {
  return `geo:${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}:${name.trim()}`;
}

export function resolveDestination(id: string | undefined | null): Destination | undefined {
  if (!id) return undefined;
  const landmark = landmarkIndex.get(id);
  if (landmark) return landmark;
  const m = CUSTOM_ID.exec(id);
  if (!m) return undefined;
  const point = { latitude: Number(m[1]), longitude: Number(m[2]) };
  const locality = nearestLocality(point);
  const name = m[3]?.trim() || `Pin near ${locality.name}`;
  return {
    id,
    name,
    shortName: name.length > 22 ? `${name.slice(0, 21)}…` : name,
    kind: "CUSTOM",
    city: locality.city,
    region: locality.region,
    ...point,
  };
}
