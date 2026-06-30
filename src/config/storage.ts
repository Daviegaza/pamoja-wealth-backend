import { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "./index.js";
import { logger } from "./logger.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const s3Client = config.s3.endpoint
  ? new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretKey,
      },
      forcePathStyle: true,
    })
  : null;

const UPLOAD_DIR = path.resolve("uploads");

export async function uploadFile(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  if (s3Client) {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return key;
  }

  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const filePath = path.join(UPLOAD_DIR, key);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, buffer);
  logger.info({ key }, "File saved to local storage");
  return key;
}

export async function getDownloadUrl(key: string, expiresIn = 900): Promise<string> {
  if (s3Client) {
    return getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }),
      { expiresIn }
    );
  }
  return `/api/v1/files/${key}`;
}

export async function deleteFile(key: string): Promise<void> {
  if (s3Client) {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: key })
    );
  } else {
    const filePath = path.join(UPLOAD_DIR, key);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

export function generateStorageKey(prefix: string, filename: string): string {
  const ext = path.extname(filename);
  const hash = crypto.randomBytes(8).toString("hex");
  return `${prefix}/${hash}${ext}`;
}
