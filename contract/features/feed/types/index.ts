// Synced from the web app (src/features/feed/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type { ListingSummary } from "@/lib/api/contract";
import type { CityId } from "@/lib/constants/places";
import type { ID, ISODateString } from "@/types/common";

/** Who posted or commented: first name and photo only, like everywhere else people are shown in public. */
export interface FeedPerson {
  id: ID;
  name: string;
  avatarUrl?: string;
}

/** One listing in the feed, as a post: who listed it, when, and what people made of it. */
export interface FeedPost {
  listing: ListingSummary;
  poster: FeedPerson;
  postedAt: ISODateString;
  likes: number;
  comments: number;
  likedByMe: boolean;
}

export interface FeedPage {
  items: FeedPost[];
  nextCursor?: string;
}

export interface FeedParams {
  city: CityId;
  cursor?: string;
  limit?: number;
}

export interface FeedLikeState {
  likes: number;
  likedByMe: boolean;
}

export interface FeedComment {
  id: ID;
  listingId: ID;
  author: FeedPerson;
  body: string;
  createdAt: ISODateString;
  /** The author, or the lister on their own listing. */
  canDelete: boolean;
}

/** Comments are short notes and questions; details go to chat. */
export const MAX_COMMENT_LENGTH = 500;
