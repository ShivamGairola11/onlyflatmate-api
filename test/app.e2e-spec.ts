import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';

// Runs against the local Supabase database (`npm run db:start` + `npm run db:reset` from the repo root).
describe('API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports healthy when the database answers', () => request(app.getHttpServer()).get('/health').expect(200, { ok: true }));

  it('pages area search results', async () => {
    const res = await request(app.getHttpServer()).get('/listings?area=dlf-phase-3&limit=2').expect(200);
    expect(res.body.items.length).toBeLessThanOrEqual(2);
    expect(res.body.focus.label).toBe('DLF Phase 3');
    // The public record never carries the exact location.
    expect(res.body.items[0]).not.toHaveProperty('exactLocation');
  });

  it('rejects signed-in routes without a token, in the contract error shape', () =>
    request(app.getHttpServer()).get('/listings/mine').expect(401, { code: 'UNAUTHENTICATED', message: 'Please sign in to continue.' }));

  it('rejects malformed search input', () => request(app.getHttpServer()).get('/listings?bhk=7BHK').expect(422));
});
