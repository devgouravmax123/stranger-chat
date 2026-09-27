const rawBackendUrl: string =
  process.env.NEXT_PUBLIC_API_URL ||
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "http://localhost:3001";

const BACKEND_URL: string = rawBackendUrl.trim().replace(/\/+$/, "");

import type {
  E2EEMediaType,
  E2EEMediaV2Envelope,
} from "./crypto";
import {
  encryptMediaBlobToBinary,
  decryptMediaRawBytes,
} from "./crypto";

export interface PresignedUploadResponse {
  mediaId: string;
  storageKey: string;
  uploadUrl: string;
  expiresIn: number;
}

export interface PresignedDownloadResponse {
  downloadUrl: string;
  expiresIn: number;
}

/**
 * Reads the current session token and userId from browser storage.
 */
function getActiveAuth(overrideToken?: string): { token: string | null; userId: string | null } {
  if (overrideToken) {
    return { token: overrideToken, userId: null };
  }
  if (typeof window === "undefined") {
    return { token: null, userId: null };
  }
  const token =
    localStorage.getItem("sc_auth_token") ||
    sessionStorage.getItem("sc_session_token") ||
    localStorage.getItem("sc_session_token");
  const userId =
    localStorage.getItem("sc_auth_user_id") ||
    localStorage.getItem("sc_last_user_id") ||
    sessionStorage.getItem("sc_user_id") ||
    sessionStorage.getItem("sc_session_user_id");
  return { token, userId };
}

/**
 * Uploads an encrypted media blob (images) directly to Backblaze B2:
 * 1. Encrypts blob locally with AES-256-GCM + Media AAD to binary ArrayBuffer.
 * 2. Authenticates with NestJS backend via session token and requests presigned PUT URL.
 * 3. Uploads raw encrypted binary directly to B2 via HTTP PUT.
 * 4. Verifies PUT 200 OK.
 * 5. Returns the complete E2EEMediaV2Envelope.
 */
export async function uploadEncryptedMediaToB2(
  blob: Blob,
  chatId: string,
  senderId: string,
  peerPublicKey: string,
  type: E2EEMediaType,
  authToken?: string
): Promise<{ envelope: E2EEMediaV2Envelope }> {
  // 1. Resolve session token
  const auth = getActiveAuth(authToken);
  if (!auth.token) {
    throw new Error("[MediaUploader] Missing authentication session token.");
  }

  // 2. Encrypt locally - server and B2 never see plaintext
  const encrypted = await encryptMediaBlobToBinary(
    blob,
    chatId,
    senderId,
    peerPublicKey,
    type
  );

  // 3. Request presigned upload URL from backend
  const presignRes = await fetch(`${BACKEND_URL}/media/presigned-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
    },
    body: JSON.stringify({
      chatId,
      mediaType: type,
      mimeType: encrypted.mime,
      fileSize: encrypted.fileSize,
      iv: encrypted.iv,
    }),
  });

  if (!presignRes.ok) {
    const errorBody = await presignRes.text().catch(() => "");
    throw new Error(
      `[MediaUploader] Presigned upload request failed (${presignRes.status}): ${errorBody}`
    );
  }

  const presignData: PresignedUploadResponse = await presignRes.json();
  if (!presignData?.uploadUrl || !presignData?.mediaId || !presignData?.storageKey) {
    throw new Error("[MediaUploader] Invalid presigned upload response from server.");
  }

  // 4. PUT raw encrypted binary directly to B2
  const putRes = await fetch(presignData.uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": encrypted.mime,
    },
    body: encrypted.rawEncryptedBytes,
  });

  if (!putRes.ok) {
    throw new Error(
      `[MediaUploader] Direct B2 upload failed with HTTP status ${putRes.status}.`
    );
  }

  // 5. Construct and return verified v2 envelope
  const envelope: E2EEMediaV2Envelope = {
    e2ee: true,
    v: 2,
    type,
    mediaId: presignData.mediaId,
    storageKey: presignData.storageKey,
    mime: encrypted.mime,
    iv: encrypted.iv,
    fileSize: encrypted.fileSize,
  };

  return { envelope };
}

/**
 * Downloads and decrypts an encrypted media object from Backblaze B2:
 * 1. Requests presigned GET download URL from NestJS backend using session token.
 * 2. Fetches raw encrypted binary from B2 presigned URL.
 * 3. Decrypts locally using AES-256-GCM + Media AAD with derived conversation shared key.
 * 4. Returns reconstituted plaintext Blob.
 */
export async function downloadAndDecryptMediaFromB2(
  envelope: E2EEMediaV2Envelope,
  chatId: string,
  senderId: string,
  peerPublicKey: string,
  authToken?: string
): Promise<Blob> {
  // 1. Resolve session token
  const auth = getActiveAuth(authToken);
  if (!auth.token) {
    throw new Error("[MediaUploader] Missing authentication session token.");
  }

  // 2. Request presigned download URL
  const presignRes = await fetch(
    `${BACKEND_URL}/media/presigned-download/${encodeURIComponent(envelope.mediaId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    }
  );

  if (!presignRes.ok) {
    const errorBody = await presignRes.text().catch(() => "");
    throw new Error(
      `[MediaUploader] Presigned download request failed (${presignRes.status}): ${errorBody}`
    );
  }

  const presignData: PresignedDownloadResponse = await presignRes.json();
  if (!presignData?.downloadUrl) {
    throw new Error("[MediaUploader] Invalid presigned download response from server.");
  }

  // 3. Download encrypted binary from B2
  const getRes = await fetch(presignData.downloadUrl);
  if (!getRes.ok) {
    throw new Error(
      `[MediaUploader] Direct B2 download failed with HTTP status ${getRes.status}.`
    );
  }

  const rawEncryptedBytes = await getRes.arrayBuffer();

  // 4. Decrypt raw bytes locally
  const decryptedBlob = await decryptMediaRawBytes(
    rawEncryptedBytes,
    envelope.iv,
    envelope.mime,
    envelope.type,
    chatId,
    senderId,
    peerPublicKey
  );

  return decryptedBlob;
}
