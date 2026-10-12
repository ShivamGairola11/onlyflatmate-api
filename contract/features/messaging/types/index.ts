// Synced from the web app (src/features/messaging/types/index.ts) by scripts/sync-contract.mjs — do not edit here.
import type { ID, ISODateString, Rupees } from "@/types/common";

export type ConversationContextType = "LISTING" | "FLATMATE" | "GROUP";

/** Snapshot of what the conversation is about — always visible in the thread. */
export interface ConversationContext {
  type: ConversationContextType;
  id: ID;
  title: string;
  subtitle: string;
  rent?: Rupees;
  photoUrl?: string;
}

export interface ConversationParticipant {
  userId: ID;
  name: string;
  role: "SEEKER" | "LISTER" | "MEMBER";
}

export interface Conversation {
  id: ID;
  context: ConversationContext;
  participants: ConversationParticipant[];
  /** The user who opened the conversation (and holds the Contact Pass). */
  initiatorId: ID;
  lastMessage?: Message;
  unreadCount: number;
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface Message {
  id: ID;
  conversationId: ID;
  senderId: ID;
  body: string;
  sentAt: ISODateString;
  readAt?: ISODateString;
  /** Sent after the viewer's Contact Pass lapsed: the server withholds `body` (empty) until they renew. */
  locked?: boolean;
}

/** Pushed to the signed-in user as things happen (SSE over HTTP). */
export type MessagingEvent =
  | { type: "message"; conversationId: ID; message: Message }
  | { type: "read"; conversationId: ID; readerId: ID; readAt: string };

export interface CreateConversationInput {
  contextType: ConversationContextType;
  contextId: ID;
  initialMessage?: string;
}
