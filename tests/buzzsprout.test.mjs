import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({ entryPoints: ["src/index.ts"], bundle: true, format: "esm", platform: "neutral", write: false });
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const env = { BUZZSPROUT_API_TOKEN: "test-token", BUZZSPROUT_PODCAST_ID: "123" };
const origin = "https://sermon-publisher.pbctulsa.org";
const id = "uZGwiTyVMUU";
function request(path, method, body, extra = {}) {
  return new Request(origin + "/api/buzzsprout/" + path, {
    method, body, duplex: "half", headers: { origin, "cf-access-authenticated-user-email": "volunteer@example.com", ...extra }
  });
}
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test("configuration exposes readiness but never the Buzzsprout token", async () => {
  const result = await worker.fetch(new Request(origin + "/api/config"), env);
  const data = await result.json();
  assert.equal(data.buzzsproutConfigured, true);
  assert.equal(JSON.stringify(data).includes("test-token"), false);
});

test("write routes fail closed for missing Access identity, wrong origin, or preview hosts", async () => {
  for (const changes of [{ "cf-access-authenticated-user-email": "" }, { origin: "https://evil.example" }]) {
    assert.equal((await worker.fetch(request("episodes", "POST", "{}", changes), env)).status, 403);
  }
  const preview = new Request("https://preview.workers.dev/api/buzzsprout/episodes", {
    method: "POST", headers: { origin, "cf-access-authenticated-user-email": "forged" }
  });
  assert.equal((await worker.fetch(preview, env)).status, 403);
});

test("missing configuration and invalid metadata never call Buzzsprout", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("must not call"); });
  assert.equal((await worker.fetch(request("episodes", "POST", "{}"), {})).status, 503);
  assert.equal((await worker.fetch(request("episodes", "POST", "{}", { "content-type": "application/json" }), env)).status, 400);
});

test("creates only an unpublished draft with the video's GUID", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url, "https://www.buzzsprout.com/api/123/episodes.json");
    assert.equal(init.headers.get("authorization"), "Token token=test-token");
    assert.equal(init.redirect, "error");
    if (!init.method) return response([]);
    const body = JSON.parse(init.body);
    assert.equal(body.guid, `pbc-youtube-${id}`);
    assert.equal(body.private, true);
    assert.equal(body.published_at, null);
    return response({ id: 42 }, 201);
  });
  const result = await worker.fetch(request("episodes", "POST", JSON.stringify({ title: "Hope | Pastor | August 29, 2026", speaker: "Pastor", description: "Sermon", videoId: id }), { "content-type": "application/json" }), env);
  assert.equal(result.status, 201);
  assert.deepEqual(await result.json(), { id: "42" });
});

const createRequest = () => request("episodes", "POST", JSON.stringify({ title: "Hope", speaker: "Pastor", description: "Sermon", videoId: id }), { "content-type": "application/json" });
const lookupRequest = () => request("episodes/lookup", "POST", JSON.stringify({ videoId: id }), { "content-type": "application/json" });

test("unexpected failures identify the step without leaking exception contents", async (t) => {
  const logs = t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed test-token https://private.example/secret volunteer@example.com");
  });
  const result = await worker.fetch(createRequest(), env);
  const data = await result.json();
  assert.equal(result.status, 502);
  assert.equal(data.creationUncertain, false);
  assert.match(data.error, /Network connection failed while checking for an existing episode/);
  assert.ok(data.error.includes(data.diagnosticId));
  const log = JSON.parse(logs.mock.calls[0].arguments[0]);
  assert.equal(log.diagnosticId, data.diagnosticId);
  const output = JSON.stringify([data, log]);
  for (const secret of ["test-token", "private.example", "volunteer@example.com"]) assert.ok(!output.includes(secret));
});

test("draft creation timeout is identified and remains uncertain", async (t) => {
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (_, init) => {
    if (!init.method) return response([]);
    throw new DOMException("private details", "TimeoutError");
  });
  const data = await (await worker.fetch(createRequest(), env)).json();
  assert.equal(data.creationUncertain, true);
  assert.match(data.error, /timed out while creating the podcast draft/);
  assert.ok(!data.error.includes("private details"));
});

test("lookup and create recover a matching episode without writing", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(init.method, undefined);
    return response([{ id: 42, guid: `pbc-youtube-${id}`, audio_url: "https://audio.example/sermon.mp3", private: false, published_at: "2026-08-30" }]);
  });
  const state = { id: "42", audioUploaded: true, published: true };
  assert.deepEqual(await (await worker.fetch(lookupRequest(), env)).json(), { episode: state });
  assert.deepEqual(await (await worker.fetch(createRequest(), env)).json(), state);
});

test("empty lookup returns no episode and never creates one", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async (_, init) => {
    assert.equal(init.method, undefined);
    return response([]);
  });
  assert.deepEqual(await (await worker.fetch(lookupRequest(), env)).json(), { episode: null });
  assert.equal(mock.mock.callCount(), 1);
});

test("failed, incomplete, malformed or ambiguous lookup blocks creation", async (t) => {
  for (const result of [
    () => response({ error: "unavailable" }, 503),
    () => response({ episodes: [] }),
    () => response([{ id: 42 }]),
    () => response([{ id: 42, guid: `pbc-youtube-${id}` }, { id: 43, guid: `pbc-youtube-${id}` }]),
    () => new Response("[]", { headers: { link: '<https://example.com>; rel="next"' } }),
    () => new Response("x".repeat(4_000_001))
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async (_, init) => {
      assert.equal(init.method, undefined);
      return result();
    });
    const res = await worker.fetch(createRequest(), env);
    assert.ok(res.status >= 400);
    assert.equal((await res.json()).creationUncertain, false);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test("creation distinguishes definite rejection from an uncertain outcome", async (t) => {
  for (const status of [401, 422, 429, 408, 409, 500]) {
    const mock = t.mock.method(globalThis, "fetch", async (_, init) => !init.method ? response([]) : response({ errors: { title: ["is invalid"] } }, status));
    const data = await (await worker.fetch(createRequest(), env)).json();
    assert.equal(data.creationUncertain, [408, 409, 500].includes(status));
    assert.match(data.error, new RegExp(`HTTP ${status}`));
    assert.match(data.error, /title: is invalid/);
    mock.mock.restore();
  }
});

test("lost or malformed successful create responses remain uncertain", async (t) => {
  for (const outcome of [() => { throw new Error("network lost"); }, () => response({}), () => new Response("not JSON", { status: 201 })]) {
    const mock = t.mock.method(globalThis, "fetch", async (_, init) => !init.method ? response([]) : outcome());
    assert.equal((await (await worker.fetch(createRequest(), env)).json()).creationUncertain, true);
    mock.mock.restore();
  }
});

test("structured upstream details redact the credential", async (t) => {
  t.mock.method(globalThis, "fetch", async () => response({ message: "invalid test-token", authorization: "test-token", errors: { base: ["Try https://secret.example/token"] } }, 422));
  const text = await (await worker.fetch(lookupRequest(), env)).text();
  assert.ok(text.includes("[redacted]"));
  assert.ok(!text.includes("test-token"));
  assert.ok(!text.includes("secret.example"));
});

test("streams the audio as a multipart attachment to the existing draft", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    count++;
    if (count === 1) return response({ id: 42, guid: `pbc-youtube-${id}`, private: true });
    assert.equal(init.method, "PUT");
    assert.equal(url.endsWith("/episodes/42.json"), true);
    const form = await new Response(init.body, { headers: init.headers }).formData();
    assert.equal(await form.get("audio_file").text(), "audio-bytes");
    assert.equal(form.get("audio_file").name, "sermon.mp3");
    return response({ id: 42 });
  });
  const result = await worker.fetch(request("episodes/42/audio", "PUT", "audio-bytes", { "content-type": "audio/mpeg", "x-audio-size": "11", "x-youtube-video-id": id }), env);
  assert.equal(result.status, 200);
  assert.equal(count, 2);
});

test("rejects wrong episode ownership and oversized audio", async (t) => {
  const mock = t.mock.method(globalThis, "fetch", async () => response({ guid: "another-episode" }));
  const headers = { "content-type": "audio/mpeg", "x-audio-size": "1", "x-youtube-video-id": id };
  assert.equal((await worker.fetch(request("episodes/42/audio", "PUT", "x", headers), env)).status, 403);
  assert.equal((await worker.fetch(request("episodes/42/audio", "PUT", "x", { ...headers, "x-audio-size": "100000000" }), env)).status, 413);
  assert.equal(mock.mock.callCount(), 1);
});

test("publish waits for audio, then updates the same episode", async (t) => {
  let available = false;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (!init.method) return response({ guid: `pbc-youtube-${id}`, audio_url: available ? "https://example.com/sermon.mp3" : null });
    const body = JSON.parse(init.body);
    assert.equal(body.private, false);
    assert.ok(body.published_at);
    return response({ id: 42 });
  });
  assert.equal((await worker.fetch(request("episodes/42/publish", "POST", null, { "x-youtube-video-id": id }), env)).status, 409);
  available = true;
  assert.equal((await worker.fetch(request("episodes/42/publish", "POST", null, { "x-youtube-video-id": id }), env)).status, 200);
});

test("upstream failures do not leak secret or response body", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("test-token upstream diagnostics", { status: 401 }));
  const result = await worker.fetch(request("episodes/42/publish", "POST", null, { "x-youtube-video-id": id }), env);
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes("test-token"), false);
});
