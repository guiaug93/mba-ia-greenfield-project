import { Inject, Injectable } from '@nestjs/common';
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  CompletedPart,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createWriteStream } from 'fs';
import { pipeline } from 'stream/promises';
import { S3_CLIENT } from './storage.constants';

@Injectable()
export class StorageService {
  constructor(@Inject(S3_CLIENT) private readonly s3Client: S3Client) {}

  async initMultipartUpload(
    bucket: string,
    key: string,
    mimeType: string,
  ): Promise<{ uploadId: string; fileKey: string }> {
    const command = new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: mimeType,
    });
    const result = await this.s3Client.send(command);
    return {
      uploadId: result.UploadId!,
      fileKey: key,
    };
  }

  async generatePresignedPartUrls(
    bucket: string,
    key: string,
    uploadId: string,
    partCount: number,
    expiresIn = 3600,
  ): Promise<{
    parts: { partNumber: number; url: string }[];
    partSize: number;
  }> {
    const partSize = 50 * 1024 * 1024; // 50MB per part
    const parts = await Promise.all(
      Array.from({ length: partCount }, async (_, i) => {
        const partNumber = i + 1;
        const command = new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
        });
        const url = await getSignedUrl(this.s3Client, command, {
          expiresIn,
        });
        return { partNumber, url };
      }),
    );
    return { parts, partSize };
  }

  async completeMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    const command = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        Parts: parts.map(
          (p): CompletedPart => ({
            PartNumber: p.partNumber,
            ETag: p.etag,
          }),
        ),
      },
    });
    await this.s3Client.send(command);
  }

  async abortMultipartUpload(
    bucket: string,
    key: string,
    uploadId: string,
  ): Promise<void> {
    const command = new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
    });
    await this.s3Client.send(command);
  }

  async generatePresignedGetUrl(
    bucket: string,
    key: string,
    expiresIn = 3600,
    filename?: string,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(filename
        ? { ResponseContentDisposition: `attachment; filename="${filename}"` }
        : {}),
    });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async getObjectMetadata(
    bucket: string,
    key: string,
  ): Promise<{ contentLength: number; contentType: string }> {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    const result = await this.s3Client.send(command);
    return {
      contentLength: result.ContentLength!,
      contentType: result.ContentType!,
    };
  }

  async uploadFile(bucket: string, key: string, body: Buffer): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
    });
    await this.s3Client.send(command);
  }

  async downloadToFile(
    bucket: string,
    key: string,
    destPath: string,
  ): Promise<void> {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const result = await this.s3Client.send(command);
    await pipeline(
      result.Body as NodeJS.ReadableStream,
      createWriteStream(destPath),
    );
  }
}
