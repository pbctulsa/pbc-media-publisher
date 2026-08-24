function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024 * 1024;
const MAX_DURATION_SECONDS = 3 * 60 * 60;

function getBinding(env: Env, name: string): string | undefined {
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function decodeMetadataValue(value: string): string | undefined {
  try {
    const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}

function encodeMetadataValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function safeFilename(metadataHeader: string | null): string {
  if (!metadataHeader) return "PBC sermon upload";

  for (const entry of metadataHeader.split(",")) {
    const [key, encodedValue] = entry.trim().split(" ", 2);
    if (key !== "filename" || !encodedValue) continue;

    const decoded = decodeMetadataValue(encodedValue);
    if (!decoded) break;
    const cleaned = decoded.replace(/[\u0000-\u001f\u007f]/g, "").trim();
    return cleaned.slice(0, 180) || "PBC sermon upload";
  }

  return "PBC sermon upload";
}

function metadataValue(metadataHeader: string | null, expectedKey: string): string | undefined {
  if (!metadataHeader) return undefined;

  for (const entry of metadataHeader.split(",")) {
    const [key, encodedValue] = entry.trim().split(" ", 2);
    if (key !== expectedKey || !encodedValue) continue;
    return decodeMetadataValue(encodedValue);
  }

  return undefined;
}

function reservedDurationSeconds(metadataHeader: string | null): number {
  const requestedDuration = Number(metadataValue(metadataHeader, "durationseconds"));
  if (!Number.isFinite(requestedDuration) || requestedDuration <= 0) {
    return 90 * 60;
  }

  return Math.min(MAX_DURATION_SECONDS, Math.max(60, Math.ceil(requestedDuration) + 60));
}

async function createStreamUpload(request: Request, env: Env): Promise<Response> {
  const uploadLength = Number(request.headers.get("Upload-Length"));
  if (!Number.isSafeInteger(uploadLength) || uploadLength <= 0) {
    return json({ error: "The video size is missing or invalid." }, { status: 400 });
  }
  if (uploadLength > MAX_UPLOAD_BYTES) {
    return json({ error: "This video is larger than Cloudflare Stream's 30 GB limit." }, { status: 413 });
  }
  if (request.headers.get("Tus-Resumable") !== "1.0.0") {
    return json({ error: "A resumable upload is required." }, { status: 412 });
  }

  const accountId = env.CLOUDFLARE_ACCOUNT_ID;
  const streamToken = getBinding(env, "CLOUDFLARE_STREAM_TOKEN");
  if (!streamToken) {
    return json({ error: "Video storage is not connected yet." }, { status: 503 });
  }

  const clientMetadata = request.headers.get("Upload-Metadata");
  const filename = safeFilename(clientMetadata);
  const maxDurationSeconds = reservedDurationSeconds(clientMetadata);
  const expiry = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
  const uploadMetadata = [
    `name ${encodeMetadataValue(filename)}`,
    `maxDurationSeconds ${encodeMetadataValue(String(maxDurationSeconds))}`,
    "requiresignedurls",
    `expiry ${encodeMetadataValue(expiry)}`
  ].join(",");

  const streamResponse = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream?direct_user=true`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${streamToken}`,
        "Tus-Resumable": "1.0.0",
        "Upload-Length": String(uploadLength),
        "Upload-Metadata": uploadMetadata
      }
    }
  );

  const location = streamResponse.headers.get("Location");
  if (!streamResponse.ok || !location) {
    const responseBody = (await streamResponse.text()).slice(0, 1200);
    console.error(JSON.stringify({
      event: "stream_upload_url_failed",
      status: streamResponse.status,
      hasLocation: Boolean(location),
      responseBody
    }));
    return json({ error: "Cloudflare could not prepare the video upload. Please try again." }, { status: 502 });
  }

  const headers = new Headers({
    "cache-control": "no-store",
    "Tus-Resumable": "1.0.0",
    Location: location,
    "Access-Control-Expose-Headers": "Location, Stream-Media-ID"
  });
  const streamMediaId = streamResponse.headers.get("stream-media-id");
  if (streamMediaId) headers.set("Stream-Media-ID", streamMediaId);

  return new Response(null, { status: 201, headers });
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ status: "ok", service: "pbc-media-publisher" });
    }

    if (url.pathname === "/api/uploads" && request.method === "POST") {
      return createStreamUpload(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
