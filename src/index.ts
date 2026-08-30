import { buzzsprout, buzzsproutConfigured, MAX_AUDIO_BYTES } from "./buzzsprout";

const SERMONS_PLAYLIST_ID = "PL55zozglajy_Nw-rQ-ydZeRjn1kyKnj8z";

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { ...init, headers });
}

function getBinding(env: Env, name: string): string | undefined {
  const value: unknown = Reflect.get(env, name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ status: "ok", service: "pbc-media-publisher", uploadDestination: "youtube" });
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      const youtubeClientId = getBinding(env, "YOUTUBE_CLIENT_ID");
      return json({
        youtubeConfigured: Boolean(youtubeClientId),
        youtubeClientId: youtubeClientId || null,
        sermonsPlaylistId: SERMONS_PLAYLIST_ID,
        buzzsproutConfigured: buzzsproutConfigured(env),
        maxAudioBytes: MAX_AUDIO_BYTES
      });
    }

    if (url.pathname.startsWith("/api/buzzsprout/")) return buzzsprout(request, env);

    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
