import { Injectable, Logger } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class B2StorageService {
  private readonly logger = new Logger(B2StorageService.name);
  private s3Client: S3Client | null = null;
  private bucketName: string | null = null;
  private isConfigured = false;

  constructor() {
    const endpoint = process.env.B2_ENDPOINT;
    const region = process.env.B2_REGION;
    const accessKeyId = process.env.B2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.B2_SECRET_ACCESS_KEY;
    const bucketName = process.env.B2_BUCKET_NAME;

    if (endpoint && region && accessKeyId && secretAccessKey && bucketName) {
      this.bucketName = bucketName;
      this.s3Client = new S3Client({
        endpoint,
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
        forcePathStyle: true,
      });
      this.isConfigured = true;
      this.logger.log('B2StorageService initialized with S3-compatible Backblaze B2 client.');
    } else {
      this.logger.warn(
        'B2StorageService: Missing Backblaze B2 environment variables (B2_ENDPOINT, B2_REGION, B2_ACCESS_KEY_ID, B2_SECRET_ACCESS_KEY, B2_BUCKET_NAME). Presigned URL generation will fail until configured.',
      );
    }
  }

  getIsConfigured(): boolean {
    return this.isConfigured;
  }

  /**
   * Generates a short-lived presigned PUT URL for direct browser-to-B2 encrypted upload.
   *
   * @param storageKey Server-generated unique key in format `media/<chatId>/<uuid>.bin`
   * @param mimeType Expected MIME type
   * @param expiresInSeconds Expiry duration (default: 300s = 5 minutes)
   */
  async getPresignedUploadUrl(
    storageKey: string,
    mimeType: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    if (!this.s3Client || !this.bucketName) {
      throw new Error(
        'Backblaze B2 storage is not configured on the server. Please check B2 environment variables.',
      );
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: storageKey,
      ContentType: mimeType,
    });

    return await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * Generates a short-lived presigned GET URL for an authorized recipient to download the encrypted ciphertext.
   *
   * @param storageKey Stored key in B2
   * @param expiresInSeconds Expiry duration (default: 300s = 5 minutes)
   */
  async getPresignedDownloadUrl(
    storageKey: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    if (!this.s3Client || !this.bucketName) {
      throw new Error(
        'Backblaze B2 storage is not configured on the server. Please check B2 environment variables.',
      );
    }

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: storageKey,
    });

    return await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });
  }

  /**
   * Deletes an object from the B2 bucket.
   */
  async deleteObject(storageKey: string): Promise<void> {
    if (!this.s3Client || !this.bucketName) return;

    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: storageKey,
      });
      await this.s3Client.send(command);
    } catch (err: any) {
      this.logger.warn(`Failed to delete object from B2: ${err.message}`);
    }
  }

  /**
   * Batch deletes objects from the B2 bucket using S3-compatible DeleteObjectsCommand.
   * Handles S3's 1000 objects per request limit, ignores non-existent keys, and returns real failures.
   */
  async deleteObjects(keys: string[]): Promise<void> {
    if (!keys || keys.length === 0) return;
    if (!this.s3Client || !this.bucketName) {
      this.logger.warn('deleteObjects called but Backblaze B2 is not configured.');
      return;
    }

    const uniqueKeys = Array.from(new Set(keys.filter((k) => typeof k === 'string' && k.trim().length > 0)));
    if (uniqueKeys.length === 0) return;

    // S3 DeleteObjects max batch size is 1000 keys
    const BATCH_SIZE = 1000;
    const errors: Array<{ key?: string; code?: string; message?: string }> = [];

    for (let i = 0; i < uniqueKeys.length; i += BATCH_SIZE) {
      const chunk = uniqueKeys.slice(i, i + BATCH_SIZE);
      try {
        const command = new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {
            Objects: chunk.map((key) => ({ Key: key })),
            Quiet: true, // Only report errors in response
          },
        });

        const response = await this.s3Client.send(command);
        if (response.Errors && response.Errors.length > 0) {
          for (const err of response.Errors) {
            errors.push({
              key: err.Key,
              code: err.Code,
              message: err.Message,
            });
          }
        }
      } catch (err: any) {
        this.logger.error(`Failed executing batch DeleteObjects on B2: ${err.message}`);
        throw err;
      }
    }

    if (errors.length > 0) {
      const msg = `B2 batch delete completed with ${errors.length} error(s)`;
      this.logger.warn(`${msg}: ${JSON.stringify(errors.map((e) => ({ code: e.code, message: e.message })))}`);
      const error = new Error(msg);
      (error as any).b2Errors = errors;
      throw error;
    }
  }
}
