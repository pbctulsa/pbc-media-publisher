import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile("web/app.js", "utf8");
function browser({ audioFails = false, createFails = false, rejectCreate = false, lookupEpisode = null, lookupFails = false, confirmRetry = false, storage = new Map() } = {}) {
  const elements = new Map();
  const calls = [];
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      value: "", style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
      addEventListener() {}, reportValidity: () => true, load() {}, removeAttribute() {},
      querySelector: (selector) => element(id + selector)
    });
    return elements.get(id);
  };
  let audioAttempts = 0;
  class XHR {
    listeners = {};
    upload = { addEventListener() {} };
    headers = {};
    open(method, url) { this.url = url; calls.push(url); }
    setRequestHeader(key, value) { this.headers[key] = value; }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    send() {
      if (this.url.includes("/audio")) {
        audioAttempts++;
        if (audioFails && audioAttempts === 1) { this.listeners.error(); return; }
        this.responseText = JSON.stringify({ accepted: true, id: "42" });
      } else this.responseText = JSON.stringify({ id: "uZGwiTyVMUU" });
      this.status = 200;
      this.listeners.load();
    }
  }
  const sandbox = vm.createContext({
    document: { querySelector: element, querySelectorAll: () => [] },
    window: { scrollTo() {}, alert(message) { calls.push("alert:" + message); }, confirm(message) { calls.push("confirm:" + message); return confirmRetry; }, addEventListener() {} },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    URL: { createObjectURL: () => "blob:video", revokeObjectURL() {} },
    console, setTimeout, XMLHttpRequest: XHR,
    google: { accounts: { oauth2: { initTokenClient: ({ callback }) => ({ requestAccessToken() { callback({ access_token: "secret-google-token" }); } }) } } },
    fetch: async (url, init) => {
      calls.push(url);
      if (url === "/api/config") return { ok: true, json: async () => ({ youtubeClientId: "id", sermonsPlaylistId: "playlist", buzzsproutConfigured: true }) };
      if (url.includes("uploadType=resumable")) return { ok: true, headers: { get: () => "https://youtube.test/upload" } };
      if (url.includes("playlistItems")) return { ok: true };
      if (url.endsWith("/episodes/lookup")) return lookupFails
        ? { ok: false, json: async () => ({ error: "Lookup unavailable (HTTP 503)" }) }
        : { ok: true, json: async () => ({ episode: lookupEpisode }) };
      if (url.endsWith("/episodes")) {
        if (rejectCreate) return { ok: false, json: async () => ({ error: "Buzzsprout rejected the connection (HTTP 401)", creationUncertain: false }) };
        if (createFails) throw new Error("network lost");
        return { ok: true, json: async () => ({ id: "42" }) };
      }
      if (url.endsWith("/publish")) return { ok: true, json: async () => ({ accepted: true }) };
      throw new Error("unexpected call: " + url);
    }
  });
  vm.runInContext(source, sandbox);
  const run = (script) => vm.runInContext(script, sandbox);
  const selectVideo = () => run('chooseFile({name:"sermon.mp4", type:"video/mp4", size:100, lastModified:1, slice() {return "video";}})');
  const selectAudio = () => run('chooseAudio({name:"sermon.mp3", type:"audio/mpeg", size:10})');
  return { run, calls, elements, element, selectVideo, selectAudio, storage };
}

async function setup(options) {
  const app = browser(options);
  await app.run("loadConfig()");
  app.selectVideo();
  app.element("#sermon-title").value = "Hope";
  app.element("#sermon-speaker").value = "Pastor";
  app.element("#sermon-date").value = "2026-08-29";
  app.element("#sermon-visibility").value = "private";
  app.element("#podcast-visibility").value = "draft";
  return app;
}

test("video-only publishing makes no Buzzsprout requests", async () => {
  const app = await setup();
  await app.run("publishSermon()");
  assert.equal(app.calls.some((url) => url.includes("buzzsprout")), false);
  assert.equal(app.run("workflow.playlistAdded"), true);
  assert.equal(app.run("activeUpload"), false);
});

test("audio failure retries the same episode without another YouTube upload", async () => {
  const app = await setup({ audioFails: true });
  app.selectAudio();
  await app.run("publishSermon()");
  assert.equal(app.run("workflow.videoId"), "uZGwiTyVMUU");
  assert.equal(app.run("workflow.podcastId"), "42");
  assert.equal(app.run("workflow.podcastAudioUploaded"), undefined);
  await app.run("publishSermon()");
  assert.equal(app.run("workflow.podcastAudioUploaded"), true);
  assert.equal(app.calls.filter((url) => url === "https://youtube.test/upload").length, 1);
  assert.equal(app.calls.filter((url) => url === "/api/buzzsprout/episodes").length, 1);
  assert.equal(app.calls.filter((url) => url.endsWith("/42/audio")).length, 2);
  assert.equal(app.calls.some((url) => url.endsWith("/publish")), false);
  assert.equal([...app.storage.values()].some((value) => value.includes("secret-google-token")), false);
});

test("uncertain draft creation is not repeated", async () => {
  const app = await setup({ createFails: true });
  app.selectAudio();
  await app.run("publishSermon()");
  await app.run("publishSermon()");
  assert.equal(app.calls.filter((url) => url === "/api/buzzsprout/episodes").length, 1);
  assert.match(app.element("#status-message").textContent, /Wait one minute/);
  assert.match(app.element("#status-message").textContent, /network lost/);
  assert.equal(app.calls.filter((url) => url.endsWith("/lookup")).length, 1);
});

test("a lost creation response recovers the same draft after reload", async () => {
  const first = await setup({ createFails: true });
  first.selectAudio();
  await first.run("publishSermon()");
  const second = await setup({ storage: first.storage, lookupEpisode: { id: "42", audioUploaded: false, published: false } });
  second.selectAudio();
  await second.run("publishSermon()");
  assert.equal(second.run("workflow.podcastId"), "42");
  assert.equal(second.run("workflow.podcastAudioUploaded"), true);
  assert.equal(second.calls.some(url => url.includes("youtube.test") || url.endsWith("/episodes")), false);
});

test("legacy lock asks before creating when no draft exists; cancel preserves it", async () => {
  const app = await setup();
  app.selectAudio();
  app.run('workflow.videoId="uZGwiTyVMUU"; workflow.playlistAdded=true; workflow.podcastCreating=true;');
  await app.run("publishSermon()");
  assert.equal(app.calls.filter(url => url.startsWith("confirm:")).length, 1);
  assert.equal(app.calls.some(url => url.endsWith("/episodes")), false);
  assert.equal(app.run("workflow.podcastCreating"), true);
});

test("explicit recovery confirmation retries only the podcast", async () => {
  const app = await setup({ confirmRetry: true });
  app.selectAudio();
  app.run('workflow.videoId="uZGwiTyVMUU"; workflow.playlistAdded=true; workflow.podcastCreating=true;');
  await app.run("publishSermon()");
  assert.equal(app.calls.filter(url => url.endsWith("/episodes")).length, 1);
  assert.equal(app.calls.some(url => url.includes("youtube.test")), false);
  assert.equal(app.run("workflow.podcastAudioUploaded"), true);
});

test("failed recovery shows the original error and does not ask to create", async () => {
  const app = await setup({ lookupFails: true });
  app.selectAudio();
  app.run('workflow.videoId="uZGwiTyVMUU"; workflow.playlistAdded=true; workflow.podcastCreating=true; workflow.podcastError="Original failure";');
  await app.run("publishSermon()");
  assert.match(app.element("#status-message").textContent, /Lookup unavailable.*Original failure/);
  assert.equal(app.calls.some(url => url.startsWith("confirm:") || url.endsWith("/episodes")), false);
});

test("a definite create rejection stays visible and allows another checked attempt", async () => {
  const app = await setup({ rejectCreate: true });
  app.selectAudio();
  await app.run("publishSermon()");
  assert.equal(app.run("workflow.podcastCreating"), false);
  assert.match(app.run("workflow.podcastError"), /HTTP 401/);
  await app.run("publishSermon()");
  assert.match(app.element("#status-message").textContent, /HTTP 401/);
  assert.equal(app.calls.filter(url => url.endsWith("/episodes")).length, 2);
  assert.equal(app.calls.filter(url => url.includes("youtube.test")).length, 1);
});

test("recovery does not replace uploaded audio or republish an existing episode", async () => {
  const app = await setup({ lookupEpisode: { id: "42", audioUploaded: true, published: true } });
  app.selectAudio();
  app.run('workflow.videoId="uZGwiTyVMUU"; workflow.playlistAdded=true; workflow.podcastCreating=true; workflow.podcastMode="publish";');
  await app.run("publishSermon()");
  assert.equal(app.run("workflow.podcastPublished"), true);
  assert.equal(app.calls.some(url => url.endsWith("/audio") || url.endsWith("/publish") || url.endsWith("/episodes")), false);
});

test("explicit podcast Publish is separate from YouTube visibility", async () => {
  const app = await setup();
  app.selectAudio();
  app.element("#podcast-visibility").value = "publish";
  await app.run("publishSermon()");
  assert.equal(app.run("workflow.podcastPublished"), true);
  assert.equal(app.calls.filter((url) => url.endsWith("/42/publish")).length, 1);
});

test("reselecting original video restores destination state after reload", async () => {
  const first = await setup({ audioFails: true });
  first.selectAudio();
  await first.run("publishSermon()");
  const second = await setup({ storage: first.storage });
  second.selectAudio();
  await second.run("publishSermon()");
  assert.equal(second.run("workflow.podcastAudioUploaded"), true);
  assert.equal(second.calls.some((url) => url.includes("youtube.test") || url.includes("playlistItems") || url.endsWith("/episodes")), false);
});

test("invalid audio is rejected before any publishing", async () => {
  const app = await setup();
  app.run('chooseAudio({name:"sermon.wav",size:100})');
  assert.equal(app.run("chosenAudio"), undefined);
  app.run('chooseAudio({name:"sermon.mp3",size:95000001})');
  assert.equal(app.run("chosenAudio"), undefined);
  assert.equal(app.calls.filter((url) => url.startsWith("alert:")).length, 2);
});
