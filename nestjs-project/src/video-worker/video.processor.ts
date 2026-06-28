import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { StorageService } from '../storage/storage.service';
import { VideosService } from '../videos/videos.service';

const execFileAsync = promisify(execFile);

interface ProcessVideoJobData {
  videoId: string;
}

interface FfprobeOutput {
  format: {
    duration: string;
    size: string;
    bit_rate: string;
    format_name: string;
  };
  streams: Array<{
    codec_type: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }>;
}

@Processor('video-processing')
export class VideoProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessor.name);

  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<ProcessVideoJobData>): Promise<void> {
    const { videoId } = job.data;
    this.logger.log(`Processing video ${videoId} (job ${job.id})`);

    const tempDir = await mkdtemp(join(tmpdir(), `video-${videoId}-`));
    const videoPath = join(tempDir, 'master.mp4');
    const thumbnailPath = join(tempDir, 'thumbnail.jpg');

    try {
      const video = await this.videosService.findById(videoId);
      const bucket = process.env.MINIO_BUCKET_VIDEOS || 'videos';

      this.logger.debug(`Downloading ${video.fileKey} from MinIO`);
      await this.storageService.downloadToFile(
        bucket,
        video.fileKey!,
        videoPath,
      );

      this.logger.debug('Extracting metadata via ffprobe');
      const metadata = await this.runFfprobe(videoPath);

      const duration = Math.round(Number(metadata.format.duration) || 0);
      this.logger.debug(`Video duration: ${duration}s`);

      this.logger.debug('Generating thumbnail via ffmpeg');
      const thumbnailTimestamp = Math.max(1, Math.floor(duration * 0.5));
      await this.runFfmpegThumbnail(
        videoPath,
        thumbnailPath,
        thumbnailTimestamp,
      );

      this.logger.debug('Uploading thumbnail to MinIO');
      const thumbnailBucket =
        process.env.MINIO_BUCKET_THUMBNAILS || 'thumbnails';
      const thumbnailKey = `thumbnails/${videoId}/thumbnail.jpg`;
      const thumbnailBuffer = await readFile(thumbnailPath);
      await this.storageService.uploadFile(
        thumbnailBucket,
        thumbnailKey,
        thumbnailBuffer,
      );

      const fileSize = Number(metadata.format.size) || 0;

      await this.videosService.updateAfterProcessing(
        videoId,
        duration,
        metadata as unknown as Record<string, unknown>,
        thumbnailKey,
        fileSize,
      );

      this.logger.log(`Video ${videoId} processed successfully`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to process video ${videoId}: ${message}`);

      try {
        await this.videosService.markAsError(videoId, message);
      } catch {
        this.logger.error(`Failed to mark video ${videoId} as error`);
      }

      throw error;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }

  private async runFfprobe(filePath: string): Promise<FfprobeOutput> {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    return JSON.parse(stdout) as FfprobeOutput;
  }

  private async runFfmpegThumbnail(
    inputPath: string,
    outputPath: string,
    timestamp: number,
  ): Promise<void> {
    await execFileAsync('ffmpeg', [
      '-y',
      '-ss',
      String(timestamp),
      '-i',
      inputPath,
      '-vframes',
      '1',
      '-vf',
      'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
      outputPath,
    ]);
  }
}
