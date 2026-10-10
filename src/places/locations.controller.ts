import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { getCity } from '@/lib/constants/places';
import { ApiError } from '../common/api-error.js';
import { Public } from '../common/auth.js';
import { geocode, reverseGeocode } from './photon.js';
import { PlacesService } from './places.service.js';

const q = z.string().trim().max(120);
/** Optional metro to rank results towards; unknown values are ignored. */
const cityParam = (v: unknown) => getCity(typeof v === 'string' ? v : undefined)?.id;

@Controller('locations')
export class LocationsController {
  constructor(private readonly places: PlacesService) {}

  @Public()
  @Get('search')
  search(@Query('q') query: unknown, @Query('city') city: unknown) {
    return this.places.search(q.parse(query ?? ''), cityParam(city));
  }

  @Public()
  @Get('geocode')
  async geocode(@Query('q') query: unknown, @Query('city') city: unknown) {
    try {
      return await geocode(q.parse(query ?? ''), cityParam(city));
    } catch {
      throw new ApiError('UNKNOWN', 'Address search is unavailable right now. Try again, or drop a pin on the map.', 503);
    }
  }

  @Public()
  @Get('reverse')
  async reverse(@Query() query: unknown) {
    const { lat, lng } = z.object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180) }).parse(query);
    // A pin without an address is still a valid pin.
    return reverseGeocode({ latitude: lat, longitude: lng }).catch(() => null);
  }
}
