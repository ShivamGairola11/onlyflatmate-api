import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { config } from './config.js';

// rawBody: the Razorpay webhook signature covers the exact request bytes, not the parsed JSON.
const app = await NestFactory.create(AppModule, { rawBody: true });
// Only the Next.js BFF calls this API (server to server), so there's no CORS to open.
app.enableShutdownHooks();
await app.listen(config.PORT);
