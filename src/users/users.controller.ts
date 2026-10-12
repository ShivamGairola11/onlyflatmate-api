import { Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import { type AuthUser, CurrentUser } from '../common/auth.js';
import { assertNoContactInfo } from '../common/contact-info.js';
import { type ProfilePatch, UsersService } from './users.service.js';
import { RateLimit } from '../common/rate-limit.js';

const lifestyle = z.array(z.string().max(30)).max(14);

/** Whitelist: anything not listed (userId, verifications, isAdmin …) is dropped. */
const profilePatch = z
  .object({
    displayName: z.string().trim().min(1).max(40),
    age: z.number().int().min(18).max(99),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
    profession: z.string().trim().max(60),
    industry: z.string().trim().max(60),
    workArea: z.string().trim().max(80),
    workplaceId: z.string().max(200),
    bio: z.string().trim().max(500),
    lifestyle,
    languages: z.array(z.string().max(30)).max(8),
    hometown: z.string().trim().max(60),
    lookingFor: z.object({
      areas: z.array(z.string().max(80)).max(8),
      budgetMin: z.number().int().min(0).max(1_000_000),
      budgetMax: z.number().int().min(0).max(1_000_000),
      bhk: z.array(z.enum(['1RK', '1BHK', '2BHK', '3BHK', '4BHK_PLUS'])).max(5),
      moveIn: z.iso.date().or(z.iso.datetime()),
      genderPreference: z.enum(['MALE', 'FEMALE', 'ANY']),
    }),
  })
  .partial();

@Controller('users/me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthUser) {
    return this.users.me(user.id);
  }

  @RateLimit(60, 3600)
  @Patch('profile')
  update(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const patch = profilePatch.parse(body);
    assertNoContactInfo(patch.displayName, patch.profession, patch.industry, patch.workArea, patch.bio, patch.hometown, ...(patch.languages ?? []));
    return this.users.updateProfile(user.id, patch as ProfilePatch);
  }

  @Patch('mode')
  setMode(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const { mode } = z.object({ mode: z.enum(['SEEKING', 'OFFERING']) }).parse(body);
    return this.users.setMode(user.id, mode);
  }
}
