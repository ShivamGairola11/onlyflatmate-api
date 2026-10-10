// Synced from the web app (src/lib/api/contract.ts) by scripts/sync-contract.mjs — do not edit here.
/**
 * The API contract.
 *
 * Every data access in the app goes through an `ApiClient`. There are two
 * implementations: `mock` (in-browser, used by the prototype) and `http`
 * (REST calls to the future NestJS backend). UI code never knows which one
 * is active. Method signatures here should map 1:1 to NestJS controller routes.
 */
import type { DemoPersona, OtpChallenge, Session } from "@/features/auth/types";
import type { Commute, CommuteRoute } from "@/features/commute/types";
import type { FlatmateProfile, FlatmateProfileInput, FlatmateSearchParams } from "@/features/flatmates/types";
import type { AddMemberInput, CreateGroupInput, FlatGroup, GroupMatch, UpdateGroupInput } from "@/features/groups/types";
import type {
  CreateListingInput,
  ListingType,
  EditableListing,
  Listing,
  ListingDraftRecord,
  ListingSearchParams,
  SavedListing,
  UpdateListingInput,
} from "@/features/listings/types";
import type { Conversation, CreateConversationInput, Message, MessagingEvent } from "@/features/messaging/types";
import type { ConfirmPaymentInput, ContactPass, PaymentMethod, PaymentOrder, PaymentProvider, PaymentStatus } from "@/features/payments/types";
import type { Profile, User, UserMode, VerificationStatus, VerificationType } from "@/features/profiles/types";
import type { ListingDraft } from "@/lib/validation/listing";
import type { GeoLocation, ID, Report, ReportReason, ReportTargetType } from "@/types/common";

/** The subset of a user's identity that other users may see. */
export interface PublicUser {
  id: ID;
  firstName: string;
  age?: number;
  profession?: string;
  memberSince: string;
  verified: { phone: boolean; identity: boolean };
  responseTimeLabel: string;
}

export type ListingSummary = Listing & { commute?: Commute };

export type SearchFocus = GeoLocation & { radiusKm: number; label: string };

export interface PageParams {
  /** Opaque; pass back `nextCursor` from the previous page. */
  cursor?: string;
  /** Default 24, max 60. */
  limit?: number;
}

/** One page of the result list. */
export interface ListingSearchResult {
  items: ListingSummary[];
  total: number;
  /** Absent on the last page. */
  nextCursor?: string;
  /** Centre of the searched area, when the search was area-based. */
  focus?: SearchFocus;
}

/** Just enough to draw a marker or a cluster — the map loads these, not full listings. */
export type ListingPin = Pick<Listing, "id" | "type" | "status" | "location"> & {
  pricing: Pick<Listing["pricing"], "rent">;
  commute?: Pick<Commute, "destinationId" | "bestMinutes" | "quality">;
};

export interface ListingPinsResult {
  pins: ListingPin[];
  total: number;
  /** More than the server's cap matched; the map asks people to zoom in. */
  truncated: boolean;
  focus?: SearchFocus;
}

export interface ListingDetail {
  listing: Listing;
  lister: PublicUser;
  isOwner: boolean;
}

/** `ADDRESS` comes from the geocoder: any street address, building or POI. */
export type LocationSuggestionKind = "LOCALITY" | "WORKPLACE" | "COLLEGE" | "ADDRESS";

export interface LocationSuggestion {
  kind: LocationSuggestionKind;
  id: string;
  name: string;
  secondary: string;
  location: GeoLocation;
}

export interface ImportedListing {
  draft: Partial<ListingDraft>;
  extracted: { label: string; value: string }[];
  warnings: string[];
}

/** A short-lived permission to upload one photo straight to object storage. */
export interface PhotoUploadTicket {
  photoId: ID;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresAt: string;
}

export interface UploadedPhoto {
  photoId: ID;
  /** CDN URL. Listings may only reference photos the same user uploaded. */
  url: string;
}

export interface ContactPassStatus {
  active: boolean;
  pass?: ContactPass;
  priceInr: number;
  validityDays: number;
}

export interface AdminStats {
  listings: number;
  activeListings: number;
  staleListings: number;
  users: number;
  openReports: number;
  payments: number;
  revenueInr: number;
  pendingVerifications: number;
  newUsers7d: number;
  activePasses: number;
  revenue30dInr: number;
  conversations: number;
  messages7d: number;
}

/* --- Admin panel (all routes require profiles.is_admin) ------------------------------------- */

/** One calendar day (India time) in the overview's range. Days with no activity are present as zeros. */
export interface AdminDay {
  date: string;
  revenueInr: number;
  paidPasses: number;
  signups: number;
  messages: number;
}

/** A figure for the selected range next to the same-length range before it. */
export interface AdminDelta {
  current: number;
  previous: number;
}

export interface AdminOverview {
  days: number;
  daily: AdminDay[];
  kpis: {
    revenueInr: AdminDelta;
    paidPasses: AdminDelta;
    signups: AdminDelta;
    messages: AdminDelta;
    /** Checkouts opened vs. paid, in range — conversion is paid / started. */
    checkoutsStarted: AdminDelta;
    activePasses: number;
    users: number;
  };
  /** How checkouts that began in the range ended. "Abandoned" = never paid and older than an hour. */
  checkoutOutcomes: { paid: number; refunded: number; failed: number; abandoned: number; inProgress: number };
  methods: { method: "UPI" | "CARD" | "NETBANKING" | "OTHER"; payments: number; revenueInr: number }[];
  listings: { active: number; stale: number; expired: number; occupied: number };
  topLocalities: { locality: string; listings: number }[];
  attention: {
    openReports: number;
    pendingVerifications: number;
    /** Razorpay checkouts unpaid for 15 min–7 days: worth a "Check with Razorpay". */
    stuckPayments: number;
    passesExpiring48h: number;
  };
  recentPayments: { id: ID; name: string; amount: number; status: PaymentStatus; createdAt: string }[];
  recentUsers: { id: ID; name: string; createdAt: string }[];
}

export interface AdminQuery {
  /** Free-text search: names, emails, phones, ids — whatever the list supports. */
  q?: string;
  status?: string;
  page?: number;
}

export interface AdminPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminUserRef {
  id: ID;
  name: string;
  email?: string;
  phone?: string;
}

export interface AdminUser extends AdminUserRef {
  createdAt: string;
  lastActiveAt: string;
  isAdmin: boolean;
  /** Set while the account is banned from signing in. */
  bannedUntil?: string;
  listings: number;
  totalPaidInr: number;
  passExpiresAt?: string;
}

export interface AdminPayment {
  id: ID;
  user: AdminUserRef;
  amount: number;
  provider: PaymentProvider;
  providerOrderId: string;
  providerPaymentId?: string;
  method?: PaymentMethod;
  status: PaymentStatus;
  createdAt: string;
  pass?: { id: ID; expiresAt: string };
}

export interface AdminPass {
  id: ID;
  user: AdminUserRef;
  startsAt: string;
  expiresAt: string;
  active: boolean;
  paymentId: ID;
  amount: number;
  /** Granted by an admin, not bought. */
  complimentary: boolean;
}

export type AdminListingStatus = "ACTIVE" | "EXPIRED" | "OCCUPIED";

export interface AdminListing {
  id: ID;
  title: string;
  type: ListingType;
  locality: string;
  city: string;
  rent: number;
  status: AdminListingStatus;
  lister: AdminUserRef;
  createdAt: string;
  lastConfirmedAt: string;
  views: number;
  openReports: number;
}

export type AdminReportStatus = "OPEN" | "REVIEWED" | "ACTIONED";

export interface AdminReport {
  id: ID;
  reporter: AdminUserRef;
  targetType: ReportTargetType;
  targetId: ID;
  /** Listing title, user name or group name; missing if the target was deleted. */
  targetLabel?: string;
  /** The person behind the target (lister, user, group owner) — who to ban if needed. */
  targetUserId?: ID;
  reason: ReportReason;
  details?: string;
  status: AdminReportStatus;
  createdAt: string;
}

export interface AdminVerification {
  id: ID;
  user: AdminUserRef;
  type: VerificationType;
  status: VerificationStatus;
  verifiedAt?: string;
}

export interface ApiClient {
  /**
   * Sessions live in an httpOnly cookie set by the Next.js BFF — the browser never sees a token.
   */
  auth: {
    getSession(): Promise<Session | null>;
    /** Sends a one-time code by SMS to an Indian mobile number (10 digits, no +91). */
    requestOtp(phone: string): Promise<OtpChallenge>;
    verifyOtp(challengeId: string, code: string): Promise<Session>;
    /** Where to send the browser to start Google sign-in. The BFF handles the callback, sets the cookie and redirects to `returnTo`. */
    googleSignInUrl(returnTo: string): Promise<{ url: string }>;
    /** Creates an account; a confirmation link is emailed, and the account can't sign in until it's opened. */
    signUpWithEmail(email: string, password: string, returnTo: string): Promise<void>;
    signInWithEmail(email: string, password: string): Promise<Session>;
    /** Development and demo builds only: sign in as a seeded persona. Production returns 404. */
    devSignIn(persona: DemoPersona): Promise<Session>;
    signOut(): Promise<void>;
    setMode(mode: UserMode): Promise<Session>;
  };
  locations: {
    search(query: string): Promise<LocationSuggestion[]>;
    /** Free-text address search within Delhi NCR (geocoder). */
    geocode(query: string): Promise<LocationSuggestion[]>;
    /** Best address for a point, e.g. a pin dropped on the map. */
    reverse(point: GeoLocation): Promise<LocationSuggestion | null>;
  };
  listings: {
    search(params: ListingSearchParams & PageParams): Promise<ListingSearchResult>;
    /** Every match as a lightweight pin (capped), for the map. Same filters as `search`. */
    pins(params: ListingSearchParams): Promise<ListingPinsResult>;
    get(id: ID): Promise<ListingDetail>;
    getMany(ids: ID[]): Promise<Listing[]>;
    mine(): Promise<Listing[]>;
    create(input: CreateListingInput): Promise<Listing>;
    /** Owner only: the listing with its exact location, to prefill the editor. */
    editable(id: ID): Promise<EditableListing>;
    /** Owner only: replaces the listing's details. Keeps id, status, views and freshness. */
    update(id: ID, input: UpdateListingInput): Promise<Listing>;
    /** Owner only: removes the listing; saved copies and open chats show it as removed. */
    remove(id: ID): Promise<void>;
    confirmAvailability(id: ID): Promise<Listing>;
    markOccupied(id: ID): Promise<Listing>;
    importFromText(text: string): Promise<ImportedListing>;
  };
  drafts: {
    /** The signed-in user's "Have a Place" draft, if any. */
    get(): Promise<ListingDraftRecord | null>;
    save(values: Partial<ListingDraft>): Promise<ListingDraftRecord>;
    discard(): Promise<void>;
  };
  uploads: {
    /** 1. Reserve a photo (JPEG/PNG/WebP, max 10 MB) and get a presigned upload URL. */
    createPhotoUpload(input: { contentType: string; sizeBytes: number }): Promise<PhotoUploadTicket>;
    /** 2. Send the bytes to `ticket.uploadUrl`. Talks to storage directly, not to the BFF. */
    putPhoto(ticket: PhotoUploadTicket, file: Blob): Promise<void>;
    /** 3. Confirm the object landed; returns the URL to put in `photos`. */
    completePhotoUpload(photoId: ID): Promise<UploadedPhoto>;
  };
  commute: {
    /** `destinationId` is a landmark id or a custom `geo:lat,lng:name` id (see `resolveDestination`). */
    estimate(listingIds: ID[], destinationId: string): Promise<Record<ID, Commute>>;
    /** Road route from the listing's public (approximate) location to the destination. */
    route(listingId: ID, destinationId: string): Promise<CommuteRoute>;
  };
  saved: {
    /** Just the ids and timestamps — cheap, used for heart icons everywhere. */
    list(): Promise<SavedListing[]>;
    /** The shortlist page: saved listings joined in one call, newest first. Removed listings are left out. */
    listings(): Promise<Listing[]>;
    save(listingId: ID): Promise<SavedListing>;
    remove(listingId: ID): Promise<void>;
  };
  flatmates: {
    search(params: FlatmateSearchParams): Promise<FlatmateProfile[]>;
    get(id: ID): Promise<FlatmateProfile>;
    /** The signed-in user's own listing in Find a Flatmate, if they have one. */
    mine(): Promise<FlatmateProfile | null>;
    /** Create or update it; it's visible in search straight away. */
    saveMine(input: FlatmateProfileInput): Promise<FlatmateProfile>;
    /** Take it out of search. Conversations already started stay open. */
    removeMine(): Promise<void>;
  };
  groups: {
    list(): Promise<FlatGroup[]>;
    get(id: ID): Promise<FlatGroup>;
    create(input: CreateGroupInput): Promise<FlatGroup>;
    /** Organiser only. `peopleNeeded` can't drop below the current member count. */
    update(id: ID, input: UpdateGroupInput): Promise<FlatGroup>;
    /** Any member: change your own share of the rent. */
    setMyBudget(id: ID, budget: number): Promise<FlatGroup>;
    /** Organiser only; the organiser can't remove themselves. */
    removeMember(groupId: ID, memberId: ID): Promise<FlatGroup>;
    /** Members other than the organiser. */
    leave(groupId: ID): Promise<void>;
    /** Organiser only: deletes the group for everyone. */
    remove(groupId: ID): Promise<void>;
    addMember(groupId: ID, input: AddMemberInput): Promise<FlatGroup>;
    join(inviteCode: string, budget: number): Promise<FlatGroup>;
    matches(groupId: ID): Promise<GroupMatch[]>;
  };
  messaging: {
    conversations(): Promise<Conversation[]>;
    conversation(id: ID): Promise<Conversation>;
    messages(conversationId: ID): Promise<Message[]>;
    create(input: CreateConversationInput): Promise<Conversation>;
    send(conversationId: ID, body: string): Promise<Message>;
    markRead(conversationId: ID): Promise<void>;
    /** Total unread messages across conversations, for the nav badge. */
    unreadCount(): Promise<number>;
    /**
     * Live events for the signed-in user; returns an unsubscribe function.
     * HTTP: a server-sent events stream at /events (reconnects on its own).
     */
    subscribe(onEvent: (event: MessagingEvent) => void): () => void;
  };
  payments: {
    contactPassStatus(): Promise<ContactPassStatus>;
    createContactPassOrder(): Promise<PaymentOrder>;
    confirmPayment(input: ConfirmPaymentInput): Promise<ContactPass>;
  };
  profiles: {
    me(): Promise<{ user: User; profile: Profile }>;
    update(patch: Partial<Profile>): Promise<Profile>;
  };
  safety: {
    report(targetType: ReportTargetType, targetId: ID, reason: ReportReason, details?: string): Promise<Report>;
    block(userId: ID): Promise<void>;
  };
  admin: {
    stats(): Promise<AdminStats>;
    overview(days: 7 | 30 | 90): Promise<AdminOverview>;
    users(q: AdminQuery): Promise<AdminPage<AdminUser>>;
    setBanned(userId: ID, banned: boolean): Promise<void>;
    setAdmin(userId: ID, isAdmin: boolean): Promise<void>;
    payments(q: AdminQuery): Promise<AdminPage<AdminPayment>>;
    /** Full refund through the provider; revokes the pass. */
    refundPayment(paymentId: ID): Promise<void>;
    /** Asks the provider whether an unconfirmed payment was actually captured, and grants the pass if so. */
    syncPayment(paymentId: ID): Promise<void>;
    passes(q: AdminQuery): Promise<AdminPage<AdminPass>>;
    extendPass(passId: ID, days: number): Promise<void>;
    revokePass(passId: ID): Promise<void>;
    grantPass(userId: ID, days: number): Promise<void>;
    listings(q: AdminQuery): Promise<AdminPage<AdminListing>>;
    setListingStatus(listingId: ID, status: AdminListingStatus): Promise<void>;
    reports(q: AdminQuery): Promise<AdminPage<AdminReport>>;
    setReportStatus(reportId: ID, status: AdminReportStatus): Promise<void>;
    verifications(q: AdminQuery): Promise<AdminPage<AdminVerification>>;
    setVerificationStatus(verificationId: ID, status: Exclude<VerificationStatus, "PENDING">): Promise<void>;
  };
}
