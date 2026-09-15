import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

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

  app.enableCors({
    origin: 'http://localhost:3000',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(3001);

  console.log('🚀 Backend running at: http://localhost:3001');
}

bootstrap();