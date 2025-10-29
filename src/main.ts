import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 3000);
  console.log('🚀 Servidor corriendo en http://localhost:3000');

  // Manejo de señales para cierre graceful
  process.on('SIGINT', async () => {
    await app.close();
    process.exit();
  });
}
bootstrap();
