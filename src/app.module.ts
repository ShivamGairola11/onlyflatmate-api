import { Controller, Get, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { sql } from 'kysely';
import { AdminController, AdminGuard } from './admin/admin.js';
import { AuthGuard, Public } from './common/auth.js';
import { ApiExceptionFilter } from './common/exception.filter.js';
import { CommuteController } from './commute/commute.controller.js';
import { CommuteService } from './commute/commute.service.js';
import { type Database, DbModule, InjectDb } from './db/db.module.js';
import {
  FlatmatesController,
  FlatmatesService,
} from './flatmates/flatmates.js';
import { GroupsController, GroupsService } from './groups/groups.js';
import { ListingEditorService } from './listings/listing-editor.service.js';
import {
  ListingDraftController,
  ListingsController,
} from './listings/listings.controller.js';
import { ListingsService } from './listings/listings.service.js';
import { SavedController } from './listings/saved.controller.js';
import { EventsController, EventsService } from './messaging/events.js';
import {
  MessagingController,
  MessagingService,
} from './messaging/messaging.js';
import { PaymentsController } from './payments/payments.js';
import { LocationsController } from './places/locations.controller.js';
import { PlacesService } from './places/places.service.js';
import { SafetyController } from './safety/safety.js';
import { UploadsController, UploadsService } from './uploads/uploads.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';

@Controller('health')
class HealthController {
  constructor(@InjectDb() private readonly db: Database) {}

  /** For the host's health check: the process is up and the database answers. */
  @Public()
  @Get()
  async check() {
    await sql`select 1`.execute(this.db);
    return { ok: true };
  }
}

// One module for now: the API is small. Split into feature modules when a team owns each part.
@Module({
  imports: [DbModule],
  controllers: [
    HealthController,
    LocationsController,
    ListingsController,
    ListingDraftController,
    SavedController,
    CommuteController,
    UploadsController,
    UsersController,
    FlatmatesController,
    GroupsController,
    MessagingController,
    EventsController,
    PaymentsController,
    SafetyController,
    AdminController,
  ],
  providers: [
    PlacesService,
    CommuteService,
    ListingsService,
    ListingEditorService,
    UploadsService,
    UsersService,
    FlatmatesService,
    GroupsService,
    MessagingService,
    EventsService,
    AdminGuard,
    // Signed-in by default; routes opt out with @Public().
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
