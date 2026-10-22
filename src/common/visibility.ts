import type { PublicUser } from '@/lib/api/contract';
import type { Listing } from '@/features/listings/types';
import type { FlatmateProfile } from '@/features/flatmates/types';
import type { FlatGroup } from '@/features/groups/types';

/**
 * What a signed-out caller may see. Listings are public (gate actions, not discovery); facts about
 * private people — residents, flatmate-seekers, group members — are trimmed to a non-identifying
 * summary. Withheld strings come back empty and withheld lists empty, so the contract shape holds.
 * Signed-in callers get the full record (the existing owner/member/block rules still apply).
 */

/** Residents: age, gender and profession only (no first name, lifestyle or account id). */
export function publicListing(l: Listing): Listing {
  return { ...l, flatmates: l.flatmates.map(({ userId: _u, ...f }) => ({ ...f, name: '', lifestyle: [] })) };
}

/** The lister: first name, tenure and verification badges; no age or profession. */
export function publicLister({ age: _a, profession: _p, ...u }: PublicUser): PublicUser {
  return u;
}

/** Flatmate-seekers: the "looking for" summary stays; bio, lifestyle, languages, work area and account id go. */
export function publicFlatmate(p: FlatmateProfile): FlatmateProfile {
  return { ...p, userId: '', bio: '', workArea: '', languages: [], lifestyle: [] };
}

/** Groups: the brief (size, BHK, areas, budget, move-in). Members become anonymous seats; no note, owner id or invite code. */
export function publicGroup(g: FlatGroup): FlatGroup {
  return {
    ...g,
    ownerId: '',
    note: undefined,
    inviteCode: '',
    members: g.members.map((m, i) => ({ id: `${g.id}_seat${i}`, groupId: g.id, name: '', profession: '', budget: 0, role: m.role, status: m.status, joinedAt: m.joinedAt })),
  };
}
