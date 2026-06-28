import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateVideosTable1782662824 implements MigrationInterface {
  name = 'CreateVideosTable1782662824';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "videos" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "channel_id" uuid NOT NULL,
        "title" character varying(255) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'pending',
        "status_message" text,
        "file_key" character varying(512),
        "file_size" bigint,
        "thumbnail_key" character varying(512),
        "duration" integer,
        "mime_type" character varying(100),
        "metadata" jsonb,
        "upload_id" character varying(255),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_videos" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "videos" ADD CONSTRAINT "FK_videos_channel" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_channel_id" ON "videos" ("channel_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_status" ON "videos" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_videos_created_at" ON "videos" ("created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_videos_created_at"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_status"`);
    await queryRunner.query(`DROP INDEX "IDX_videos_channel_id"`);
    await queryRunner.query(
      `ALTER TABLE "videos" DROP CONSTRAINT "FK_videos_channel"`,
    );
    await queryRunner.query(`DROP TABLE "videos"`);
  }
}
