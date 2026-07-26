import {
  IsString,
  MaxLength,
  IsOptional,
  IsNumber,
  Max,
  IsPositive,
} from 'class-validator';

const MAX_FILE_SIZE = 10 * 1024 * 1024 * 1024; // 10GB

export class CreateVideoDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  mimeType?: string;

  @IsNumber()
  @IsPositive()
  @Max(MAX_FILE_SIZE, {
    message: 'File size exceeds the maximum allowed size of 10GB',
  })
  fileSize: number;
}
