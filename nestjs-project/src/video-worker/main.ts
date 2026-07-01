import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { VideoWorkerModule } from './video-worker.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('VideoWorker');

  try {
    const app = await NestFactory.createApplicationContext(VideoWorkerModule, {
      logger: ['log', 'error', 'warn', 'debug', 'verbose'],
    });

    logger.log('Video worker started, waiting for jobs...');

    app.enableShutdownHooks();
  } catch (error) {
    logger.error('Failed to start video worker', error);
    process.exit(1);
  }
}

void bootstrap();
