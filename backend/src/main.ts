import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js'; // active redis connection
import { corsOptions } from './common/cors.config.js';

// Ensure backend/.env is loaded reliably regardless of working directory
const candidateEnvPaths = [
  resolve(process.cwd(), 'backend', '.env'),
  resolve(process.cwd(), '.env'),
];

for (const envPath of candidateEnvPaths) {
  if (existsSync(envPath)) {
    config({ path: envPath, override: true });
    break;
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableShutdownHooks();

  const httpAdapter = app.getHttpAdapter().getInstance();
  httpAdapter.disable('x-powered-by');

  // Configure Express reverse-proxy IP trust safely:
  // When TRUST_PROXY is provided (e.g. 'true', '1', 'loopback', or a CIDR), configure Express trust proxy.
  // Otherwise, leave disabled (default: false) to prevent client IP spoofing via X-Forwarded-For.
  const trustProxyEnv = process.env.TRUST_PROXY?.trim();
  if (trustProxyEnv) {
    const trustValue =
      trustProxyEnv === 'true'
        ? true
        : trustProxyEnv === 'false'
          ? false
          : !isNaN(Number(trustProxyEnv))
            ? Number(trustProxyEnv)
            : trustProxyEnv;
    httpAdapter.set('trust proxy', trustValue);
  }

  app.enableCors(corsOptions);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3001;
  await app.listen(port);

  console.log(`🚀 Backend running at: http://localhost:${port}`);
}

bootstrap();