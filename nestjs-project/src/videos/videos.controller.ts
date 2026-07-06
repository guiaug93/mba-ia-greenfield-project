import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Redirect,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/auth.types';
import { VideosService } from './videos.service';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from './entities/video.entity';

@Controller('videos')
export class VideosController {
  constructor(
    private readonly videosService: VideosService,
    private readonly channelsService: ChannelsService,
    private readonly storageService: StorageService,
    @InjectQueue('video-processing') private readonly videoQueue: Queue,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: { title: string; mimeType: string; fileSize: number },
    @CurrentUser() user: JwtPayload,
  ) {
    const channel = await this.channelsService.findByUserId(user.sub);
    const video = await this.videosService.create(
      channel.id,
      body.title,
      body.mimeType,
      body.fileSize,
    );
    return {
      id: video.id,
      status: video.status,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/init-upload')
  async initUpload(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const channel = await this.channelsService.findByUserId(user.sub);
    const video = await this.videosService.ensureOwnership(id, channel.id);
    this.videosService.assertStatus(video, [VideoStatus.PENDING]);

    const fileKey = `videos/${video.id}/master.mp4`;
    const { uploadId } = await this.storageService.initMultipartUpload(
      process.env.MINIO_BUCKET_VIDEOS || 'videos',
      fileKey,
      video.mimeType || 'video/mp4',
    );
    await this.videosService.setUploadId(id, uploadId, fileKey);
    return { uploadId, fileKey };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/upload-urls')
  async getUploadUrls(
    @Param('id') id: string,
    @Query('partCount') partCount: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const channel = await this.channelsService.findByUserId(user.sub);
    const video = await this.videosService.ensureOwnership(id, channel.id);
    this.videosService.assertStatus(video, [VideoStatus.PENDING]);
    if (!video.uploadId || !video.fileKey) {
      return { parts: [], partSize: 0 };
    }
    return this.storageService.generatePresignedPartUrls(
      process.env.MINIO_BUCKET_VIDEOS || 'videos',
      video.fileKey,
      video.uploadId,
      parseInt(partCount, 10) || 1,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  async completeUpload(
    @Param('id') id: string,
    @Body() body: { parts: { partNumber: number; etag: string }[] },
    @CurrentUser() user: JwtPayload,
  ) {
    const channel = await this.channelsService.findByUserId(user.sub);
    const video = await this.videosService.ensureOwnership(id, channel.id);
    this.videosService.assertStatus(video, [VideoStatus.PENDING]);

    await this.storageService.completeMultipartUpload(
      process.env.MINIO_BUCKET_VIDEOS || 'videos',
      video.fileKey!,
      video.uploadId!,
      body.parts,
    );
    const updated = await this.videosService.updateStatus(
      id,
      VideoStatus.PROCESSING,
    );
    await this.videoQueue.add('process-video', { videoId: id });
    return { id: updated.id, status: updated.status };
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/abort')
  @HttpCode(HttpStatus.NO_CONTENT)
  async abortUpload(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    const channel = await this.channelsService.findByUserId(user.sub);
    const video = await this.videosService.ensureOwnership(id, channel.id);
    if (video.uploadId && video.fileKey) {
      await this.storageService.abortMultipartUpload(
        process.env.MINIO_BUCKET_VIDEOS || 'videos',
        video.fileKey,
        video.uploadId,
      );
    }
    await this.videosService.markAsError(id, 'Upload aborted');
  }

  @Public()
  @Get(':id')
  async getMetadata(@Param('id') id: string) {
    const video = await this.videosService.findById(id);
    return {
      id: video.id,
      title: video.title,
      status: video.status,
      duration: video.duration,
      thumbnailUrl: video.thumbnailKey ? `/videos/${video.id}/thumbnail` : null,
      channel: {
        id: video.channel?.id,
        name: video.channel?.name,
        nickname: video.channel?.nickname,
      },
      createdAt: video.createdAt,
    };
  }

  @Public()
  @Get(':id/stream')
  @Redirect()
  @HttpCode(HttpStatus.FOUND)
  async stream(@Param('id') id: string) {
    const video = await this.videosService.findById(id);
    this.videosService.assertStatus(video, [VideoStatus.READY]);
    const url = await this.storageService.generatePresignedGetUrl(
      process.env.MINIO_BUCKET_VIDEOS || 'videos',
      video.fileKey!,
      3600,
    );
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Public()
  @Get(':id/download')
  @Redirect()
  @HttpCode(HttpStatus.FOUND)
  async download(@Param('id') id: string) {
    const video = await this.videosService.findById(id);
    this.videosService.assertStatus(video, [VideoStatus.READY]);
    const url = await this.storageService.generatePresignedGetUrl(
      process.env.MINIO_BUCKET_VIDEOS || 'videos',
      video.fileKey!,
      3600,
      `${video.title}.mp4`,
    );
    return { url, statusCode: HttpStatus.FOUND };
  }

  @Public()
  @Get(':id/thumbnail')
  async thumbnail(@Param('id') id: string) {
    const video = await this.videosService.findById(id);
    if (!video.thumbnailKey) {
      return { thumbnailUrl: null };
    }
    const url = await this.storageService.generatePresignedGetUrl(
      process.env.MINIO_BUCKET_THUMBNAILS || 'thumbnails',
      video.thumbnailKey,
      3600,
    );
    return { url };
  }
}
