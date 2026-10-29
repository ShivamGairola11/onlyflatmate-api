-- Reply guarantee: a paid pass whose seeker got no reply within 48 h of their first message earns extra days, once.
-- reply_guarantee_at = when it was settled (null = not yet); reply_guarantee_days = days credited (null when voided, e.g. a revoked pass).
alter table public.contact_passes
  add column reply_guarantee_at timestamptz,
  add column reply_guarantee_days int check (reply_guarantee_days > 0);

-- The job looks up each seeker's chats (messages per chat already use messages_conversation_idx).
create index if not exists conversations_initiator_idx on public.conversations (initiator_id, created_at);
