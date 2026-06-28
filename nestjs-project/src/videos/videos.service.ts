import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Video, VideoStatus } from './entities/video.entity';

@Injectable()
export class VideosService {
  constructor(
    @InjectRepository(Video)
    private readonly videoRepository: Repository<Video>,
  ) {}

  async create(
    channelId: string,
    title: string,
    mimeType?: string,
    fileSize?: number,
  ): Promise<Video> {
    const video = this.videoRepository.create({
      channelId,
      title,
      mimeType: mimeType || null,
      fileSize: fileSize || null,
      status: VideoStatus.PENDING,
    });
    return this.videoRepository.save(video);
  }

  async findById(id: string): Promise<Video> {
    const video = await this.videoRepository.findOne({
      where: { id },
      relations: ['channel'],
    });
    if (!video) {
      throw new NotFoundException('Video not found');
    }
    return video;
  }

  async findByChannel(channelId: string): Promise<Video[]> {
    return this.videoRepository.find({
      where: { channelId },
      order: { createdAt: 'DESC' },
    });
  }

  async updateStatus(
    id: string,
    status: VideoStatus,
    statusMessage?: string,
  ): Promise<Video> {
    const video = await this.findById(id);
    video.status = status;
    if (statusMessage !== undefined) {
      video.statusMessage = statusMessage;
    }
    return this.videoRepository.save(video);
  }

  async updateAfterProcessing(
    id: string,
    duration: number,
    metadata: Record<string, unknown>,
    thumbnailKey: string,
    fileSize: number,
  ): Promise<Video> {
    const video = await this.findById(id);
    video.status = VideoStatus.READY;
    video.duration = duration;
    video.metadata = metadata;
    video.thumbnailKey = thumbnailKey;
    video.fileSize = fileSize;
    return this.videoRepository.save(video);
  }

  async markAsError(id: string, message: string): Promise<Video> {
    const video = await this.findById(id);
    video.status = VideoStatus.ERROR;
    video.statusMessage = message;
    return this.videoRepository.save(video);
  }

  async setUploadId(
    id: string,
    uploadId: string,
    fileKey: string,
  ): Promise<Video> {
    const video = await this.findById(id);
    video.uploadId = uploadId;
    video.fileKey = fileKey;
    return this.videoRepository.save(video);
  }

  async ensureOwnership(videoId: string, channelId: string): Promise<Video> {
    const video = await this.findById(videoId);
    if (video.channelId !== channelId) {
      throw new NotFoundException('Video not found');
    }
    return video;
  }

  assertStatus(video: Video, allowedStatuses: VideoStatus[]): void {
    if (!allowedStatuses.includes(video.status)) {
      throw new ConflictException(
        `Video status '${video.status}' does not allow this operation`,
      );
    }
  }
}
