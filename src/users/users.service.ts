import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { Profile, SearchPreference, User, UserMode } from '@/features/profiles/types';
import { notFound } from '../common/api-error.js';
import { type Database, InjectDb } from '../db/db.module.js';
import { toVerification } from '../verifications/verifications.js';

/** Fields a user may change about themselves. Identity and verification are never on this list. */
export type ProfilePatch = Partial<Pick<Profile, 'displayName' | 'age' | 'gender' | 'profession' | 'industry' | 'workArea' | 'workplaceId' | 'bio' | 'lifestyle' | 'languages' | 'hometown' | 'lookingFor'>>;

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : undefined);

@Injectable()
export class UsersService {
  constructor(@InjectDb() private readonly db: Database) {}

  async me(userId: string): Promise<{ user: User; profile: Profile }> {
    const p = await this.db
      .selectFrom('profiles as p')
      .innerJoin('auth.users as u', 'u.id', 'p.user_id')
      .selectAll('p')
      .select(['u.phone', 'u.email'])
      .select(sql<string | null>`public.provider_avatar(u.raw_user_meta_data)`.as('provider_avatar'))
      .where('p.user_id', '=', userId)
      .executeTakeFirst();
    if (!p) throw notFound('Profile not found');

    const verifications = await this.db.selectFrom('verifications').selectAll().where('user_id', '=', userId).execute();
    return {
      user: {
        id: p.user_id,
        name: p.display_name,
        phone: p.phone ? `+${p.phone}` : undefined,
        email: p.email ?? undefined,
        createdAt: iso(p.created_at)!,
        mode: p.mode as UserMode,
        isAdmin: p.is_admin || undefined,
        avatarUrl: p.avatar_url ?? undefined,
        providerAvatarUrl: p.provider_avatar ?? undefined,
      },
      profile: {
        userId: p.user_id,
        displayName: p.display_name,
        age: p.age ?? 0,
        gender: (p.gender ?? 'OTHER') as Profile['gender'],
        profession: p.profession,
        industry: p.industry,
        workArea: p.work_area ?? undefined,
        workplaceId: p.workplace_id ?? undefined,
        bio: p.bio ?? undefined,
        lifestyle: p.lifestyle as Profile['lifestyle'],
        languages: p.languages,
        hometown: p.hometown ?? undefined,
        lookingFor: (p.looking_for as SearchPreference | null) ?? undefined,
        verifications: verifications.map(toVerification),
      },
    };
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<Profile> {
    await this.db
      .updateTable('profiles')
      .set({
        display_name: patch.displayName,
        age: patch.age,
        gender: patch.gender,
        profession: patch.profession,
        industry: patch.industry,
        work_area: patch.workArea,
        workplace_id: patch.workplaceId,
        bio: patch.bio,
        lifestyle: patch.lifestyle,
        languages: patch.languages,
        hometown: patch.hometown,
        looking_for: patch.lookingFor === undefined ? undefined : JSON.stringify(patch.lookingFor),
      })
      .where('user_id', '=', userId)
      .execute();
    return (await this.me(userId)).profile;
  }

  async setMode(userId: string, mode: UserMode) {
    await this.db.updateTable('profiles').set({ mode }).where('user_id', '=', userId).execute();
    return this.me(userId);
  }
}
