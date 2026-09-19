/**
 * Client-side audio conversion utilities for ChatBuddy.
 * Converts between recorded audio Blobs and standard RFC 2397 Data URLs / Base64.
 */

/**
 * Normalizes a raw MIME type into a clean container format (e.g. audio/webm or audio/mp4).
 * Strips semicolon-separated codec parameters that break RFC 2397 Data URL parsers in standard browsers.
 */
export function normalizeAudioMimeType(rawMime: string): string {
  if (!rawMime) return "audio/webm";
  const clean = rawMime.split(";")[0].trim().toLowerCase();
  return clean || "audio/webm";
}

/**
 * Asynchronously converts an audio Blob into a validated, normalized Base64 Data URL.
 * Uses FileReader with Promise resolution, falling back to ArrayBuffer + btoa if FileReader fails.
 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  if (!blob || blob.size === 0) {
    throw new Error("Cannot convert empty audio Blob (0 bytes)");
  }

  const cleanMime = normalizeAudioMimeType(blob.type);

  // Method 1: FileReader with explicit Promise resolution
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;
        if (typeof result === "string" && result.length > 0) {
          // Normalize prefix to eliminate any messy codecs= parameters in the data scheme
          const commaIdx = result.indexOf(",");
          if (commaIdx !== -1) {
            const base64Payload = result.slice(commaIdx + 1);
            resolve(`data:${cleanMime};base64,${base64Payload}`);
          } else {
            resolve(result);
          }
        } else {
          reject(new Error("FileReader completed with empty result"));
        }
      };

      reader.onerror = () => {
        reject(reader.error || new Error("FileReader failed to read audio Blob"));
      };

      reader.readAsDataURL(blob);
    });

    if (dataUrl && dataUrl.length > 20) {
      return dataUrl;
    }
  } catch (readerErr) {
    console.warn("[audioConverter] FileReader failed, attempting ArrayBuffer fallback:", readerErr);
  }

  // Method 2: High-reliability ArrayBuffer + window.btoa fallback
  try {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength === 0) {
      throw new Error("ArrayBuffer has 0 bytes");
    }

    let binary = "";
    const len = bytes.byteLength;
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, Math.min(i + chunkSize, len)) as any
      );
    }
    const base64 = btoa(binary);
    return `data:${cleanMime};base64,${base64}`;
  } catch (bufferErr) {
    console.error("[audioConverter] ArrayBuffer conversion also failed:", bufferErr);
    throw new Error("Failed to encode audio Blob into Data URL");
  }
}

/**
 * Decodes a Base64 Data URL back into a native Blob with correct container MIME type.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  if (!dataUrl || typeof dataUrl !== "string") return null;

  try {
    const commaIdx = dataUrl.indexOf(",");
    if (commaIdx === -1) return null;

    const header = dataUrl.slice(0, commaIdx);
    const base64Data = dataUrl.slice(commaIdx + 1);

    // Extract base MIME without codec parameters (e.g., audio/webm instead of audio/webm;codecs=opus)
    const mimeMatch = header.match(/data:([^;]+)/);
    const cleanMime = mimeMatch ? normalizeAudioMimeType(mimeMatch[1]) : "audio/webm";

    const binaryStr = atob(base64Data);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    return new Blob([bytes], { type: cleanMime });
  } catch (err) {
    console.warn("[audioConverter] Error decoding Data URL into Blob:", err);
    return null;
  }
}

/**
 * Validates full round-trip: Blob -> Data URL -> Decoded Blob.
 * Confirms both non-zero length and byte consistency.
 */
export async function verifyAudioBlobRoundTrip(blob: Blob): Promise<{
  dataUrl: string;
  decodedBlob: Blob;
  ok: boolean;
  error?: string;
}> {
  try {
    const dataUrl = await blobToDataUrl(blob);
    if (!dataUrl || dataUrl.length === 0) {
      return { dataUrl: "", decodedBlob: new Blob(), ok: false, error: "Data URL length is 0" };
    }

    const decodedBlob = dataUrlToBlob(dataUrl);
    if (!decodedBlob || decodedBlob.size === 0) {
      return { dataUrl, decodedBlob: new Blob(), ok: false, error: "Decoded Blob size is 0" };
    }

    return {
      dataUrl,
      decodedBlob,
      ok: true,
    };
  } catch (err: any) {
    return {
      dataUrl: "",
      decodedBlob: new Blob(),
      ok: false,
      error: err?.message || String(err),
    };
  }
}
