import {
  Global,
  Inject,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { config } from '../config.js';
import type { DB } from './schema.js';

export const KYSELY = Symbol('KYSELY');

/** The generated public schema, plus the few Supabase auth columns the API reads. */
export type AppDB = DB & {
  'auth.users': {
    id: string;
    phone: string | null;
    email: string | null;
    banned_until: Date | null;
  };
};
export type Database = Kysely<AppDB>;

/** Inject the typed query builder: `constructor(@InjectDb() private db: Database)`. */
export const InjectDb = () => Inject(KYSELY);

// Return `date` columns as plain "YYYY-MM-DD" strings instead of local-midnight Dates.
pg.types.setTypeParser(1082, (v) => v);

@Global()
@Module({
  providers: [
    {
      provide: KYSELY,
      useFactory: () =>
        new Kysely<AppDB>({
          dialect: new PostgresDialect({
            pool: new pg.Pool({
              connectionString: config.DATABASE_URL,
              max: 10,
              // A slow or stuck query is cancelled by Postgres instead of holding a pooled connection
              // forever; callers waiting for a connection give up instead of queueing indefinitely.
              statement_timeout: 10_000,
              query_timeout: 12_000,
              connectionTimeoutMillis: 5_000,
              idleTimeoutMillis: 30_000,
            }),
          }),
        }),
    },
  ],
  exports: [KYSELY],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@InjectDb() private readonly db: Database) {}

  async onApplicationShutdown() {
    await this.db.destroy();
  }
}
