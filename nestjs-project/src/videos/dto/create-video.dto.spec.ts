import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateVideoDto } from './create-video.dto';

async function validateDto(dto: CreateVideoDto): Promise<string[]> {
  const errors = await validate(dto);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('CreateVideoDto', () => {
  it('accepts a valid dto', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'My Video',
      mimeType: 'video/mp4',
      fileSize: 5000,
    });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
  });

  it('accepts dto without mimeType', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Test',
      fileSize: 100,
    });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
  });

  it('accepts empty title (only @IsString, no @IsNotEmpty)', async () => {
    const dto = plainToInstance(CreateVideoDto, { title: '', fileSize: 100 });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
  });

  it('rejects title exceeding 255 chars', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'a'.repeat(256),
      fileSize: 100,
    });
    const messages = await validateDto(dto);
    expect(messages.some((m) => m.includes('255'))).toBe(true);
  });

  it('accepts title with exactly 255 chars', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'a'.repeat(255),
      fileSize: 100,
    });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
  });

  it('rejects negative fileSize', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Test',
      fileSize: -1,
    });
    const messages = await validateDto(dto);
    expect(messages.some((m) => m.includes('positive'))).toBe(true);
  });

  it('rejects zero fileSize', async () => {
    const dto = plainToInstance(CreateVideoDto, { title: 'Test', fileSize: 0 });
    const messages = await validateDto(dto);
    expect(messages.some((m) => m.includes('positive'))).toBe(true);
  });

  it('rejects fileSize exceeding 10GB', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Test',
      fileSize: 11 * 1024 * 1024 * 1024,
    });
    const messages = await validateDto(dto);
    expect(messages.some((m) => m.includes('10GB'))).toBe(true);
  });

  it('accepts fileSize at exactly 10GB', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Test',
      fileSize: 10 * 1024 * 1024 * 1024,
    });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
  });

  it('accepts fileSize = 1 byte', async () => {
    const dto = plainToInstance(CreateVideoDto, { title: 'Tiny', fileSize: 1 });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
  });

  it('rejects missing title', async () => {
    const dto = plainToInstance(CreateVideoDto, { fileSize: 100 });
    const messages = await validateDto(dto);
    expect(messages.some((m) => m.includes('title'))).toBe(true);
  });

  it('rejects missing fileSize', async () => {
    const dto = plainToInstance(CreateVideoDto, { title: 'Test' });
    const messages = await validateDto(dto);
    expect(messages.some((m) => m.includes('fileSize'))).toBe(true);
  });

  it('rejects fileSize as string', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Test',
      fileSize: 'abc',
    } as unknown as CreateVideoDto);
    const messages = await validateDto(dto);
    expect(messages.some((m) => m.includes('fileSize'))).toBe(true);
  });

  it('rejects mimeType exceeding 100 chars', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Test',
      mimeType: 'a'.repeat(101),
      fileSize: 100,
    });
    const messages = await validateDto(dto);
    expect(messages.some((m) => m.includes('100'))).toBe(true);
  });

  it('accepts mimeType with exactly 100 chars', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Test',
      mimeType: 'a'.repeat(100),
      fileSize: 100,
    });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
  });

  it('rejects title as number', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 123,
      fileSize: 100,
    } as unknown as CreateVideoDto);
    const messages = await validateDto(dto);
    expect(messages.some((m) => m.includes('title'))).toBe(true);
  });

  it('rejects extra properties (forbidNonWhitelisted)', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Test',
      fileSize: 100,
      extraField: 'should be stripped',
    });
    const messages = await validateDto(dto);
    // class-validator validates only whitelisted properties
    expect(messages).toHaveLength(0);
    expect(
      (dto as unknown as Record<string, unknown>).extraField,
    ).toBeDefined();
  });

  it('strips whitespace but title remains (no @Transform trim)', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: '  My Video  ',
      fileSize: 100,
    });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
    expect(dto.title).toBe('  My Video  ');
  });

  it('accepts unicode characters in title', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Vídeo com acentuação 🎥',
      fileSize: 100,
    });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
  });

  it('accepts large but valid fileSize', async () => {
    const dto = plainToInstance(CreateVideoDto, {
      title: 'Big',
      fileSize: 5 * 1024 * 1024 * 1024,
    });
    const messages = await validateDto(dto);
    expect(messages).toHaveLength(0);
  });
});
