import type { Listing } from '@/features/listings/types';
import type { FlatmateProfile } from '@/features/flatmates/types';
import type { FlatGroup } from '@/features/groups/types';
import { publicFlatmate, publicGroup, publicLister, publicListing } from './visibility.js';

describe('signed-out visibility', () => {
  it('keeps the listing but trims residents to age, gender and profession', () => {
    const l = { id: 'l1', title: 'Room', photos: [{ id: 'p', url: 'u' }], pricing: { rent: 9000 }, flatmates: [{ id: 'f', name: 'Rohan', age: 26, gender: 'MALE', profession: 'Engineer', lifestyle: ['NON_SMOKER'], userId: 'u1' }] } as unknown as Listing;
    const out = publicListing(l);
    expect(out.photos).toEqual(l.photos);
    expect(out.pricing).toEqual(l.pricing);
    expect(out.flatmates[0]).toEqual({ id: 'f', name: '', age: 26, gender: 'MALE', profession: 'Engineer', lifestyle: [] });
  });

  it('drops the lister’s age and profession', () => {
    const out = publicLister({ id: 'u', firstName: 'Aisha', age: 30, profession: 'Designer', memberSince: 'x', verified: { phone: true, identity: false }, responseTimeLabel: 'r' });
    expect(out).not.toHaveProperty('age');
    expect(out).not.toHaveProperty('profession');
    expect(out.firstName).toBe('Aisha');
  });

  it('hides a flatmate-seeker’s personal details', () => {
    const out = publicFlatmate({ userId: 'u', bio: 'Night owl', workArea: 'Cyber City', languages: ['Hindi'], lifestyle: ['NIGHT_OWL'], budgetMax: 15000 } as unknown as FlatmateProfile);
    expect(out).toMatchObject({ userId: '', bio: '', workArea: '', languages: [], lifestyle: [], budgetMax: 15000 });
  });

  it('turns group members into anonymous seats', () => {
    const g = { id: 'g', ownerId: 'o', note: 'n', inviteCode: 'ABC', totalBudget: 40000, members: [{ id: 'm', groupId: 'g', userId: 'o', name: 'Tanvi', profession: 'PM', budget: 20000, role: 'OWNER', status: 'JOINED', joinedAt: 't' }] } as unknown as FlatGroup;
    const out = publicGroup(g);
    expect(out).toMatchObject({ ownerId: '', note: undefined, inviteCode: '', totalBudget: 40000 });
    expect(out.members).toEqual([{ id: 'g_seat0', groupId: 'g', name: '', profession: '', budget: 0, role: 'OWNER', status: 'JOINED', joinedAt: 't' }]);
  });
});
