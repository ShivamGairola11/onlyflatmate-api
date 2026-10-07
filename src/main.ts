import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { config } from './config.js';

const app = await NestFactory.create(AppModule);
// Only the Next.js BFF calls this API (server to server), so there's no CORS to open.
app.enableShutdownHooks();
await app.listen(config.PORT);
