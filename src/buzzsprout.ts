const PORTAL_ORIGIN = "https://sermon-publisher.pbctulsa.org";
export const MAX_AUDIO_BYTES = 95_000_000;

export function binding(env: Env, name: string): string {
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" ? value.trim() : "";
}

export function buzzsproutConfigured(env: Env): boolean {
  return Boolean(binding(env, "BUZZSPROUT_API_TOKEN") && /^\d+$/.test(binding(env, "BUZZSPROUT_PODCAST_ID")));
}

class UploadError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(body: ReadableStream<Uint8Array> | null, limit: number): Promise<unknown> {
  if (!body) throw new UploadError("Empty response or request.");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new UploadError("Request or response is too large.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new UploadError("Unreadable response or request.", 502); }
}

function textField(data: Record<string, unknown>, key: string, max: number, required = false): string {
  const value = data[key];
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new UploadError(`Please check the ${key} field.`);
  }
  return value.trim();
}

function videoId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(value)) throw new UploadError("A completed YouTube upload is required first.");
  return value;
}

async function api(env: Env, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Token token=${binding(env, "BUZZSPROUT_API_TOKEN")}`);
  headers.set("user-agent", "PBC Media Publisher (jtouthang@pbctulsa.org)");
  headers.set("accept", "application/json");
  // Never follow a redirect with the podcast credential or audio body.
  const response = await fetch(`https://www.buzzsprout.com/api/${binding(env, "BUZZSPROUT_PODCAST_ID")}/${path}`, { ...init, headers, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel();
    const reason = response.status === 401 || response.status === 403
      ? "Buzzsprout rejected the connection. Ask the administrator to check the token and podcast ID."
      : `Buzzsprout could not complete this step (HTTP ${response.status}). Check the episode in Buzzsprout before retrying.`;
    throw new UploadError(reason, 502);
  }
  const data = await readJson(response.body, 1_000_000);
  if (!object(data)) throw new UploadError("Unexpected Buzzsprout response. Check the episode before retrying.", 502);
  return data;
}

// The file is streamed through the Worker, not held in memory or stored in Cloudflare.
function audioMultipart(body: ReadableStream<Uint8Array>, size: number, type: string) {
  const boundary = `pbc-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const extension = type === "audio/mpeg" ? "mp3" : "m4a";
  const prefix = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="audio_file"; filename="sermon.${extension}"\r\nContent-Type: ${type}\r\n\r\n`);
  const suffix = encoder.encode(`\r\n--${boundary}--\r\n`);
  const reader = body.getReader();
  let started = false;
  let received = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) { started = true; controller.enqueue(prefix); return; }
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (received !== size) throw new Error("Incomplete audio upload.");
          controller.enqueue(suffix); controller.close(); reader.releaseLock();
        } else {
          received += value.byteLength;
          if (received > size || received > MAX_AUDIO_BYTES) throw new Error("Audio upload is too large.");
          controller.enqueue(value);
        }
      } catch (error) { await reader.cancel(); controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); }
  });
  return { stream, boundary };
}

export async function buzzsprout(request: Request, env: Env): Promise<Response> {
  const headers = { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" };
  try {
    const url = new URL(request.url);
    // Cloudflare Access enforces the allow policy on this exact custom domain.
    // Deny preview/workers.dev hosts and cross-site requests, including forged
    // Access headers on hosts which do not have the Access application attached.
    if (url.origin !== PORTAL_ORIGIN || request.headers.get("origin") !== PORTAL_ORIGIN || !request.headers.get("cf-access-authenticated-user-email")) {
      throw new UploadError("Sign in through the church's secure sermon portal.", 403);
    }
    if (!buzzsproutConfigured(env)) throw new UploadError("Buzzsprout is not connected yet. Ask the administrator to add the podcast ID and API token.", 503);
    const path = url.pathname;
    if (path === "/api/buzzsprout/episodes" && request.method === "POST") {
      if (!request.headers.get("content-type")?.startsWith("application/json")) throw new UploadError("Expected sermon details.");
      const data = await readJson(request.body, 16_000);
      if (!object(data)) throw new UploadError("Invalid sermon details.");
      const id = videoId(data.videoId);
      const title = textField(data, "title", 100, true);
      const artist = textField(data, "speaker", 80, true);
      const description = textField(data, "description", 6000);
      // Always start unpublished, even when the final user choice is Publish.
      const result = await api(env, "episodes.json", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, artist, description, guid: `pbc-youtube-${id}`, private: true, published_at: null, email_user_after_audio_processed: true })
      });
      if (!/^\d+$/.test(String(result.id))) throw new UploadError("Buzzsprout did not confirm an episode ID. Check Buzzsprout before trying again.", 502);
      return new Response(JSON.stringify({ id: String(result.id) }), { status: 201, headers });
    }

    const match = path.match(/^\/api\/buzzsprout\/episodes\/(\d+)\/(audio|publish)$/);
    if (!match || (match[2] === "audio" ? request.method !== "PUT" : request.method !== "POST")) throw new UploadError("Not found", 404);
    const id = videoId(request.headers.get("x-youtube-video-id"));
    let size = 0;
    let type = "";
    if (match[2] === "audio") {
      size = Number(request.headers.get("x-audio-size"));
      type = request.headers.get("content-type") || "";
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_AUDIO_BYTES) throw new UploadError("Choose an MP3 or M4A smaller than 95 MB.", 413);
      if (!["audio/mpeg", "audio/mp4"].includes(type) || !request.body) throw new UploadError("Choose an MP3 or M4A audio file.");
    }
    const episode = await api(env, `episodes/${match[1]}.json`);
    if (episode.guid !== `pbc-youtube-${id}`) throw new UploadError("This episode does not match the selected sermon.", 403);

    if (match[2] === "audio" && request.body) {
      // Do not let a retry replace an already-published episode's audio.
      if (episode.private === false && episode.published_at) throw new UploadError("This podcast episode is already published. Manage any changes in Buzzsprout.", 409);
      const { stream, boundary } = audioMultipart(request.body, size, type);
      await api(env, `episodes/${match[1]}.json`, { method: "PUT", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: stream });
    } else {
      if (!episode.audio_url) throw new UploadError("Buzzsprout is still processing the audio. Wait a little, then retry the podcast step.", 409);
      // Publishing is idempotent: preserve a previously confirmed publication date.
      await api(env, `episodes/${match[1]}.json`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ private: false, published_at: episode.published_at || new Date().toISOString() })
      });
    }
    return new Response(JSON.stringify({ id: match[1], accepted: true }), { headers });
  } catch (error) {
    const known = error instanceof UploadError;
    return new Response(JSON.stringify({ error: known ? error.message : "The Buzzsprout connection was interrupted. Check Buzzsprout before retrying the podcast step." }), { status: known ? error.status : 502, headers });
  }
}
