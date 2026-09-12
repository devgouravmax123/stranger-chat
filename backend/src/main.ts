import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: "http://localhost:3000",
  });

  await app.listen(3001);

  console.log("Backend running at http://localhost:3001");
}

bootstrap();