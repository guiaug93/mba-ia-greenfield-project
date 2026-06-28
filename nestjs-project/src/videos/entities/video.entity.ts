import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';

export enum VideoStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  ERROR = 'error',
}

@Entity('videos')
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'channel_id' })
  channelId: string;

  @ManyToOne(() => Channel)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;

  @Column({ length: 255 })
  title: string;

  @Column({
    type: 'varchar',
    length: 20,
    default: VideoStatus.PENDING,
  })
  status: VideoStatus;

  @Column({ name: 'status_message', type: 'text', nullable: true })
  statusMessage: string | null;

  @Column({ name: 'file_key', type: 'varchar', length: 512, nullable: true })
  fileKey: string | null;

  @Column({ name: 'file_size', type: 'bigint', nullable: true })
  fileSize: number | null;

  @Column({
    name: 'thumbnail_key',
    type: 'varchar',
    length: 512,
    nullable: true,
  })
  thumbnailKey: string | null;

  @Column({ type: 'int', nullable: true })
  duration: number | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 100, nullable: true })
  mimeType: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ name: 'upload_id', type: 'varchar', length: 255, nullable: true })
  uploadId: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
