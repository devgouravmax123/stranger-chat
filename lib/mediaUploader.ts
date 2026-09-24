import { BACKEND_URL } from "./api-config";
import {
  encryptMediaBlobToBinary,
  decryptMediaRawBytes,
  E2EEMediaType,
  E2EEMediaV2Envelope,
} from "./crypto";

export interface UploadEncryptedMediaOptions {
  blob: Blob;
  chatId: string;
  senderId: string;
  peerPublicKey: string;
  type: E2EEMediaType;
  token: string;
}

export interface UploadEncryptedMediaResult {
  envelope: E2EEMediaV2Envelope;
  rawEncryptedBytes: ArrayBuffer;
}

/**
 * Encrypts a media Blob locally and uploads the raw encrypted binary
 * directly to Backblaze B2 using a short-lived presigned PUT URL.
 *
 * Security:
 * - Encryption happens entirely in browser (AES-256-GCM + Media AAD).
 * - Only encrypted binary is sent to B2.
 * - Backend never sees ciphertext or plaintext.
 * - Socket.IO payload receives only the lightweight v2 reference envelope.
 */
export async function uploadEncryptedMediaToB2(
  options: UploadEncryptedMediaOptions
): Promise<UploadEncryptedMediaResult> {
  const { blob, chatId, senderId, peerPublicKey, type, token } = options;

  if (!token) {
    throw new Error("[MediaUploader] Missing authentication token.");
  }

  // 1. Encrypt raw media blob directly to binary ArrayBuffer
  const { rawEncryptedBytes, iv, mime, fileSize } = await encryptMediaBlobToBinary(
    blob,
    chatId,
    senderId,
    peerPublicKey,
    type
  );

  // 2. Request presigned upload URL from backend
  const presignRes = await fetch(`${BACKEND_URL}/media/presigned-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      chatId,
      mediaType: type,
      mimeType: mime,
      fileSize,
      iv,
    }),
  });

  if (!presignRes.ok) {
    const errorBody = await presignRes.text().catch(() => "");
    throw new Error(
      `[MediaUploader] Failed to get presigned upload URL (${presignRes.status}): ${errorBody}`
    );
  }

  const { mediaId, storageKey, uploadUrl } = (await presignRes.json()) as {
    mediaId: string;
    storageKey: string;
    uploadUrl: string;
  };

  // 3. Upload raw encrypted bytes directly to Backblaze B2 via HTTP PUT
  // Note: Content-Type must match what was specified during presigning
  const uploadRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mime,
    },
    body: rawEncryptedBytes,
  });

  if (!uploadRes.ok) {
    throw new Error(
      `[MediaUploader] Direct B2 upload failed with HTTP status ${uploadRes.status}`
    );
  }

  // 4. Construct lightweight v2 envelope
  const envelope: E2EEMediaV2Envelope = {
    e2ee: true,
    v: 2,
    type,
    mediaId,
    storageKey,
    mime,
    iv,
    fileSize,
  };

  return {
    envelope,
    rawEncryptedBytes,
  };
}

/**
 * Downloads encrypted media binary from Backblaze B2 via presigned GET
 * and decrypts it locally using AES-256-GCM.
 */
export async function downloadAndDecryptMediaFromB2(
  envelope: E2EEMediaV2Envelope,
  chatId: string,
  senderId: string,
  peerPublicKey: string,
  token: string
): Promise<Blob> {
  if (!token) {
    throw new Error("[MediaUploader] Missing authentication token for download.");
  }

  // 1. Request presigned download URL from backend
  const presignRes = await fetch(
    `${BACKEND_URL}/media/presigned-download/${encodeURIComponent(envelope.mediaId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );

  if (!presignRes.ok) {
    const errorBody = await presignRes.text().catch(() => "");
    throw new Error(
      `[MediaUploader] Failed to get presigned download URL (${presignRes.status}): ${errorBody}`
    );
  }

  const { downloadUrl } = (await presignRes.json()) as { downloadUrl: string };

  // 2. Fetch encrypted binary from B2
  const downloadRes = await fetch(downloadUrl);
  if (!downloadRes.ok) {
    throw new Error(
      `[MediaUploader] Failed to download ciphertext from B2 (HTTP ${downloadRes.status})`
    );
  }

  const rawEncryptedBytes = await downloadRes.arrayBuffer();

  // 3. Decrypt raw bytes locally
  return await decryptMediaRawBytes(
    rawEncryptedBytes,
    envelope.iv,
    envelope.mime,
    envelope.type,
    chatId,
    senderId,
    peerPublicKey
  );
}
