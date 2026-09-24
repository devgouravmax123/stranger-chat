# Backblaze B2 Object Storage Setup for Chirp

This document provides step-by-step instructions for provisioning and configuring a **Backblaze B2** bucket for Chirp's end-to-end encrypted (E2EE) photo and voice-note storage.

---

## 1. Security Architecture & Invariants

* **Ciphertext Only**: Objects stored in B2 are client-side encrypted binary payloads (`AES-256-GCM`). Neither Backblaze nor the Chirp backend can inspect or decrypt the media files without the users' ECDH keys.
* **Strictly Private Bucket**: The B2 bucket must NEVER be made public. All uploads and downloads occur through short-lived presigned URLs (default: 300 seconds).
* **Zero Secret Exposure**:
  * **NEVER** expose B2 credentials with `NEXT_PUBLIC_`.
  * **NEVER** commit B2 credentials to Git (`.env` and `.env.*` are in `.gitignore`).
  * **NEVER** print secrets or raw credentials in application logs.
* **Server-Controlled Storage Keys**: Keys follow the structure `media/<chatId>/<uuid>.bin`. Clients cannot supply arbitrary storage paths.

---

## 2. Creating the Backblaze B2 Bucket

1. Sign in to your [Backblaze Account](https://secure.backblaze.com/).
2. Navigate to **B2 Cloud Storage** -> **Buckets** in the sidebar.
3. Click **Create a Bucket**.
4. Set the following configuration:
   * **Bucket Unique Name**: e.g., `chirp-media-prod` (must be globally unique across Backblaze).
   * **Files in Bucket are**: **Private** (CRITICAL: Do NOT select Public).
   * **Default Encryption**: Disabled (or SSE-B2 enabled; Chirp already performs client-side AES-256-GCM encryption).
   * **Object Lock**: Disabled.
   * **Lifecycle Rules**: You can optionally configure rules to purge unreferenced or temporary files after 30 days.
5. Click **Create a Bucket**.
6. On the bucket details page, locate and copy the **S3 Endpoint** (e.g. `s3.us-west-004.backblazeb2.com`) and your **Region** (e.g. `us-west-004`).

---

## 3. Configuring Bucket CORS Rules

Because clients will eventually perform direct HTTP `PUT` requests to presigned upload URLs from their browsers, configure CORS on the bucket:

1. In the Backblaze B2 console, find your bucket and click **Bucket Settings** (or use the B2 CLI).
2. Set CORS rules to allow direct browser uploads:
   ```json
   [
     {
       "corsRuleName": "chirpDirectBrowserUploads",
       "allowedOrigins": [
         "http://localhost:3000",
         "https://stranger-chat-gamma-five.vercel.app"
       ],
       "allowedOperations": [
         "s3_put",
         "s3_get",
         "s3_head"
       ],
       "allowedHeaders": [
         "content-type",
         "authorization",
         "x-amz-*"
       ],
       "exposeHeaders": [
         "ETag"
       ],
       "maxAgeSeconds": 3600
     }
   ]
   ```

---

## 4. Creating a Scoped Application Key

1. Navigate to **Account** -> **Application Keys**.
2. Click **Add a New Application Key**.
3. Configure the key:
   * **Name of Key**: `chirp-backend-media-worker`
   * **Allow access to Bucket(s)**: Select **only** your media bucket (`chirp-media-prod`).
   * **Type of Access**: `Read and Write`.
   * **File name prefix**: Leave empty (or `media/`).
   * **Duration**: Leave blank (no expiration).
4. Click **Create New Key**.
5. **Immediately save the displayed values**:
   * `keyID` -> Maps to `B2_ACCESS_KEY_ID`
   * `applicationKey` -> Maps to `B2_SECRET_ACCESS_KEY`
   *(Note: The `applicationKey` will NEVER be shown again after leaving this page).*

---

## 5. Environment Variables Configuration

Add the following variables to your backend environment (`backend/.env` locally, or your hosting provider dashboard such as Render):

```env
# ------------------------------------------
# Backblaze B2 Object Storage (E2EE Media)
# ------------------------------------------
B2_ENDPOINT="https://s3.<region>.backblazeb2.com"
B2_REGION="<region>"
B2_ACCESS_KEY_ID="<your-keyID>"
B2_SECRET_ACCESS_KEY="<your-applicationKey>"
B2_BUCKET_NAME="<your-bucket-name>"
```

### Example:
```env
B2_ENDPOINT="https://s3.us-west-004.backblazeb2.com"
B2_REGION="us-west-004"
B2_ACCESS_KEY_ID="004a1b2c3d4e5f60000000001"
B2_SECRET_ACCESS_KEY="K004abc123def456ghi789jkl012mno"
B2_BUCKET_NAME="chirp-media-prod"
```

---

## 6. Deployment on Render / Cloud Platforms

1. Open your backend service on **Render**.
2. Go to **Environment** tab.
3. Add the five environment variables:
   * `B2_ENDPOINT`
   * `B2_REGION`
   * `B2_ACCESS_KEY_ID`
   * `B2_SECRET_ACCESS_KEY`
   * `B2_BUCKET_NAME`
4. Trigger a deployment.
5. Check backend logs on startup:
   `B2StorageService initialized with S3-compatible Backblaze B2 client.`

---

## 7. Security Best Practices Checklist

- [x] Bucket permissions set to **Private**.
- [x] Application key is restricted to the specific media bucket only.
- [x] Presigned URLs expire in **300 seconds** (5 minutes).
- [x] No `NEXT_PUBLIC_` prefixes on B2 credentials.
- [x] `backend/.env` is listed in `.gitignore`.
- [x] Backend authorization requires user to be an active participant of the chat (`userAId` or `userBId`) before issuing upload/download presigned URLs.
- [x] Client cannot supply arbitrary storage keys.
