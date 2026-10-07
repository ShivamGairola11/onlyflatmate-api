// Synced from the web app (src/features/commute/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type { GeoLocation } from "@/types/common";

export type CommuteMode = "METRO" | "CAR" | "BIKE";

export interface CommuteLeg {
  mode: CommuteMode;
  minutes: number;
}

/** Commute estimate between a listing and a destination (workplace / college). */
export interface Commute {
  destinationId: string;
  destinationName: string;
  distanceKm: number;
  legs: CommuteLeg[];
  /** The fastest of `legs`. Used for sorting and filtering. */
  bestMinutes: number;
  /** `ESTIMATED` for the prototype heuristic; `ROUTED` once a routing API is wired in. */
  quality: "ESTIMATED" | "ROUTED";
}

export interface CommuteRequest {
  origin: GeoLocation;
  destinationId: string;
}

/** Road route between a listing and a destination, for drawing on the map. */
export interface CommuteRoute {
  listingId: string;
  destinationId: string;
  distanceKm: number;
  /** Route line as [longitude, latitude] pairs (GeoJSON order). */
  geometry: [number, number][];
  /** Driving time with free-flowing traffic, straight from the router. */
  offPeakMinutes: number;
  /** Peak-hour door-to-door estimates per mode. CAR/BIKE derive from the road route; METRO is modelled. */
  legs: CommuteLeg[];
  bestMinutes: number;
}
