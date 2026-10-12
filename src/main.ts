import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { internalKeyMiddleware } from './common/internal-key.js';
import { config } from './config.js';

// rawBody: the Razorpay webhook signature covers the exact request bytes, not the parsed JSON.
// bodyParser off here so the limits below apply (Nest's own parser would run first with its defaults).
const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bodyParser: false });
// Only the Next.js BFF calls this API (server to server): no CORS, and nothing that names the stack.
app.disable('x-powered-by');
app.use(internalKeyMiddleware);
// The largest real body is a listing (~10 KB) or a pasted post (5,000 chars); 100 KB leaves room, not abuse.
app.useBodyParser('json', { limit: '100kb' });
app.useBodyParser('urlencoded', { limit: '20kb', extended: false });
if (!config.INTERNAL_API_KEY) new Logger('Security').warn('INTERNAL_API_KEY is not set: the API accepts calls from anyone. Set it outside local development.');
app.enableShutdownHooks();
await app.listen(config.PORT);
