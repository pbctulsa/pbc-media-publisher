const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl"
].join(" ");
const YOUTUBE_CHUNK_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 256 * 1024 ** 3;
const MAX_YOUTUBE_TITLE_CHARACTERS = 100;
const MAX_AUDIO_BYTES = 95_000_000;
const audioInput = document.querySelector("#audio-file");
const audioMeta = document.querySelector("#audio-meta");
const removeAudio = document.querySelector("#remove-audio");
const podcastVisibility = document.querySelector("#podcast-visibility");

const input = document.querySelector("#video-file");
const dropZone = document.querySelector("#drop-zone");
const selectedFilePanel = document.querySelector("#selected-file");
const preview = document.querySelector("#video-preview");
const reviewPreview = document.querySelector("#review-preview");
const fileName = document.querySelector("#file-name");
const fileMeta = document.querySelector("#file-meta");
const removeButton = document.querySelector("#remove-file");
const detailsButton = document.querySelector("#details-button");
const reviewButton = document.querySelector("#review-button");
const publishButton = document.querySelector("#publish-button");
const detailsForm = document.querySelector("#details-form");
const uploadProgress = document.querySelector("#upload-progress");
const progressTitle = document.querySelector("#progress-title");
const progressPercent = document.querySelector("#progress-percent");
const progressBar = document.querySelector("#progress-bar");
const progressMessage = document.querySelector("#progress-message");
const statusMessage = document.querySelector("#status-message");
const publishSuccess = document.querySelector("#publish-success");
const youtubeVideoLink = document.querySelector("#youtube-video-link");

const titleInput = document.querySelector("#sermon-title");
const speakerInput = document.querySelector("#sermon-speaker");
const dateInput = document.querySelector("#sermon-date");
const scriptureInput = document.querySelector("#sermon-scripture");
const descriptionInput = document.querySelector("#sermon-description");
const visibilityInput = document.querySelector("#sermon-visibility");

let appConfig;
let previewUrl;
let chosenFile;
let activeUpload = false;
let uploadSessionUrl;
let uploadOffset = 0;
let chosenAudio;
let workflow = {};
let workflowKey;

function saveWorkflow() {
  // Persist confirmed destinations so a podcast retry does not upload another video.
  localStorage.setItem(workflowKey, JSON.stringify(workflow));
}

function chooseAudio(file) {
  if (activeUpload || uploadSessionUrl || workflow.podcastAudioUploaded) return;
  if (file && (!/\.(mp3|m4a)$/i.test(file.name) || file.size <= 0 || file.size > MAX_AUDIO_BYTES)) {
    window.alert("Choose an MP3 or M4A audio export smaller than 95 MB.");
    audioInput.value = "";
    file = undefined;
  }
  chosenAudio = file;
  podcastVisibility.disabled = !file || Boolean(workflow.videoId);
  removeAudio.hidden = !file;
  audioMeta.textContent = file ? `${file.name} · ${formatBytes(file.size)} · For the existing Buzzsprout podcast` : "No audio selected. Video-only publishing is still available.";
}

const today = new Date();
dateInput.value = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function friendlyDate(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function showStep(step) {
  for (const panel of document.querySelectorAll("[data-step]")) {
    panel.hidden = Number(panel.dataset.step) !== step;
  }
  for (const indicator of document.querySelectorAll("[data-step-indicator]")) {
    const indicatorStep = Number(indicator.dataset.stepIndicator);
    indicator.classList.toggle("active", indicatorStep === step);
    indicator.classList.toggle("complete", indicatorStep < step);
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showStatus(message) {
  statusMessage.textContent = message;
  statusMessage.hidden = !message;
}

function setProgress(state, percent, message) {
  uploadProgress.hidden = false;
  uploadProgress.className = `upload-progress ${state ? `upload-${state}` : ""}`;
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressMessage.textContent = message;
}

function chooseFile(file) {
  if (activeUpload || uploadSessionUrl || workflow.videoId) return;
  if (!file || !file.type.startsWith("video/")) {
    window.alert("Please choose an MP4 or MOV video file.");
    return;
  }
  if (file.size > MAX_VIDEO_BYTES) {
    window.alert("Please choose a video smaller than YouTube’s 256 GB limit.");
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  chosenFile = file;
  workflowKey = `pbc-publisher:${JSON.stringify([file.name, file.size, file.lastModified])}`;
  try {
    workflow = JSON.parse(localStorage.getItem(workflowKey) || "{}");
    if (!workflow || typeof workflow !== "object") workflow = {};
    saveWorkflow();
  } catch {
    workflow = {};
    window.alert("Allow browser storage before publishing. It protects against duplicate uploads when retrying.");
    chosenFile = undefined;
    return;
  }
  if (workflow.details) {
    const d = workflow.details;
    titleInput.value = d.title; speakerInput.value = d.speaker; dateInput.value = d.date;
    scriptureInput.value = d.scripture; descriptionInput.value = d.description; visibilityInput.value = d.visibility;
    podcastVisibility.value = workflow.podcastMode || "draft";
  }
  for (const field of [titleInput, speakerInput, dateInput, scriptureInput, descriptionInput, visibilityInput]) {
    field.disabled = Boolean(workflow.videoId);
  }
  removeButton.disabled = Boolean(workflow.videoId);
  uploadSessionUrl = undefined;
  uploadOffset = 0;
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;
  reviewPreview.src = previewUrl;
  fileName.textContent = file.name;
  fileMeta.textContent = workflow.videoId ? "Video already uploaded — continue to finish any remaining steps" : `${formatBytes(file.size)} · Ready for YouTube`;
  dropZone.hidden = true;
  selectedFilePanel.hidden = false;
  detailsButton.disabled = false;
}

function clearFile() {
  if (activeUpload || uploadSessionUrl || workflow.videoId) return;
  input.value = "";
  chosenFile = undefined;
  uploadSessionUrl = undefined;
  uploadOffset = 0;
  preview.removeAttribute("src");
  reviewPreview.removeAttribute("src");
  preview.load();
  reviewPreview.load();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  dropZone.hidden = false;
  selectedFilePanel.hidden = true;
  detailsButton.disabled = true;
}

function sermonDetails() {
  return {
    title: titleInput.value.trim(),
    speaker: speakerInput.value.trim(),
    date: dateInput.value,
    scripture: scriptureInput.value.trim(),
    description: descriptionInput.value.trim(),
    visibility: visibilityInput.value
  };
}

function youtubeTitle(details) {
  return `${details.title} | ${details.speaker} | ${friendlyDate(details.date)}`;
}

function fillReview() {
  const details = sermonDetails();
  document.querySelector("#review-title").textContent = youtubeTitle(details);
  document.querySelector("#review-speaker").textContent = details.speaker;
  document.querySelector("#review-date").textContent = friendlyDate(details.date);
  document.querySelector("#review-scripture").textContent = details.scripture || "—";
  document.querySelector("#review-visibility").textContent = details.visibility[0].toUpperCase() + details.visibility.slice(1);
  document.querySelector("#review-audio").textContent = chosenAudio
    ? `${chosenAudio.name} — ${podcastVisibility.value === "publish" ? "Publish to Buzzsprout" : "Unpublished draft in Buzzsprout"}`
    : workflow.podcastAudioUploaded ? "Already uploaded to Buzzsprout" : "No podcast audio selected";
}

function youtubeDescription(details) {
  const sections = [];
  if (details.description) sections.push(details.description);
  sections.push(`Speaker: ${details.speaker}`);
  if (details.scripture) sections.push(`Scripture: ${details.scripture}`);
  sections.push(`Sermon date: ${friendlyDate(details.date)}`);
  sections.push("Peniel Baptist Church · Tulsa, Oklahoma");
  return sections.join("\n\n");
}

async function loadConfig() {
  const response = await fetch("/api/config", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("The publisher configuration could not be loaded.");
  appConfig = await response.json();
  audioInput.disabled = !appConfig.buzzsproutConfigured;
  document.querySelector("#audio-help").textContent = appConfig.buzzsproutConfigured
    ? "Use the audio export from the same trimmed sermon. MP3 or M4A, up to 95 MB."
    : "Buzzsprout setup is pending. Video uploads still work; an administrator must connect the podcast first.";
  document.querySelector("#podcast-connection").textContent = appConfig.buzzsproutConfigured ? "audio optional" : "setup pending";
}

async function podcastRequest(path, init) {
  const response = await fetch(`/api/buzzsprout/${path}`, init);
  let data;
  try { data = await response.json(); }
  catch { throw new Error("Your portal session may have expired. Sign in again, then reselect the same video to continue. Check Buzzsprout before retrying."); }
  if (!response.ok) {
    const error = new Error(data.error || "Buzzsprout could not finish this step.");
    error.creationUncertain = data.creationUncertain !== false;
    throw error;
  }
  return data;
}

function rememberPodcast(episode) {
  if (!episode || !/^\d+$/.test(String(episode.id))) throw new Error("Buzzsprout did not confirm a valid episode ID. Retry to check for the draft.");
  workflow.podcastId = String(episode.id);
  workflow.podcastCreating = false;
  workflow.podcastError = "";
  if (episode.audioUploaded === true) workflow.podcastAudioUploaded = true;
  if (episode.published === true) workflow.podcastPublished = true;
  saveWorkflow();
}

async function recoverPodcast() {
  let result;
  try {
    result = await podcastRequest("episodes/lookup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ videoId: workflow.videoId })
    });
    if (!result || !("episode" in result)) throw new Error("Buzzsprout did not return an episode check result.");
  } catch (error) {
    throw new Error(`${error.message}${workflow.podcastError ? ` Previous attempt: ${workflow.podcastError}` : ""} No new draft was created during this check.`);
  }
  if (result.episode) { rememberPodcast(result.episode); return; }
  const previous = workflow.podcastError ? ` Previous attempt: ${workflow.podcastError}` : "";
  // Give an interrupted request time to finish before offering manual recovery.
  if (Date.now() - (workflow.podcastAttemptedAt || 0) < 60_000) {
    throw new Error(`No matching draft is visible yet. Wait one minute, then retry to check again.${previous}`);
  }
  if (!window.confirm("No matching draft was found in Buzzsprout. Check Buzzsprout and close any other publishing tabs first. If this sermon is already there, choose Cancel. Otherwise, choose OK to retry creating its podcast draft. Your YouTube video will not be uploaded again." + previous)) {
    throw new Error(`Podcast retry cancelled. Check Buzzsprout before trying again.${previous}`);
  }
  // Do not clear the uncertainty flag until a new attempt or confirmed ID is saved.
}

function uploadPodcastAudio() {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/buzzsprout/episodes/${workflow.podcastId}/audio`);
    xhr.setRequestHeader("content-type", /\.mp3$/i.test(chosenAudio.name) ? "audio/mpeg" : "audio/mp4");
    xhr.setRequestHeader("x-audio-size", String(chosenAudio.size));
    xhr.setRequestHeader("x-youtube-video-id", workflow.videoId);
    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) setProgress("", event.loaded / event.total * 100, "Sending audio to Buzzsprout. Keep this page open for confirmation.");
    });
    xhr.addEventListener("load", () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.accepted) resolve(data);
        else reject(new Error(data.error || "Buzzsprout did not accept the audio."));
      } catch { reject(new Error("Audio upload could not be confirmed. Sign in again and check Buzzsprout before retrying.")); }
    });
    xhr.addEventListener("error", () => reject(new Error("The audio connection was interrupted. Your YouTube upload is saved; check Buzzsprout before retrying audio.")));
    xhr.send(chosenAudio);
  });
}

async function publishPodcast(details) {
  if (!appConfig.buzzsproutConfigured) throw new Error("Buzzsprout setup is not complete yet.");
  progressTitle.textContent = "Preparing the Buzzsprout episode…";
  setProgress("", 0, "Your YouTube upload is saved. Preparing the podcast audio step…");
  if (!workflow.podcastId && workflow.podcastCreating) await recoverPodcast();
  if (!workflow.podcastId) {
    workflow.podcastCreating = true;
    workflow.podcastAttemptedAt = Date.now();
    saveWorkflow();
    try {
      const episode = await podcastRequest("episodes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: workflow.videoId, title: youtubeTitle(details), speaker: details.speaker, description: youtubeDescription(details) })
      });
      rememberPodcast(episode);
    } catch (error) {
      workflow.podcastError = error.message || "The draft creation response was lost.";
      // Only a definite rejection allows a normal retry. Network/unknown outcomes
      // stay in recovery mode, including workflows saved by the previous version.
      if (error.creationUncertain === false) workflow.podcastCreating = false;
      saveWorkflow();
      throw error;
    }
  }
  if (workflow.podcastPublished && !workflow.podcastAudioUploaded) throw new Error("This episode is already published in Buzzsprout. Check it there before changing its audio.");
  if (!workflow.podcastAudioUploaded) {
    if (!chosenAudio) throw new Error("Reselect the same audio file to finish the podcast upload.");
    progressTitle.textContent = "Uploading audio to Buzzsprout…";
    setProgress("", 0, "The video is already on YouTube. Uploading the podcast audio next…");
    await uploadPodcastAudio();
    workflow.podcastAudioUploaded = true;
    saveWorkflow();
  }
  if (workflow.podcastMode === "publish" && !workflow.podcastPublished) {
    progressTitle.textContent = "Preparing podcast publication…";
    await podcastRequest(`episodes/${workflow.podcastId}/publish`, {
      method: "POST", headers: { "x-youtube-video-id": workflow.videoId }
    });
    workflow.podcastPublished = true;
    saveWorkflow();
  }
}

function requestYouTubeToken() {
  return new Promise((resolve, reject) => {
    if (!appConfig?.youtubeClientId) {
      reject(new Error("YouTube authorization needs one final setup step: add the Google OAuth client ID to the portal."));
      return;
    }
    if (!globalThis.google?.accounts?.oauth2) {
      reject(new Error("Google authorization did not load. Refresh the page and try again."));
      return;
    }

    const tokenClient = globalThis.google.accounts.oauth2.initTokenClient({
      client_id: appConfig.youtubeClientId,
      scope: YOUTUBE_SCOPES,
      callback(response) {
        if (response?.access_token) resolve(response.access_token);
        else reject(new Error(response?.error_description || "Google authorization was not completed."));
      },
      error_callback(error) {
        reject(new Error(error?.message || "The Google authorization window was closed."));
      }
    });
    tokenClient.requestAccessToken();
  });
}

async function googleError(response, fallback) {
  try {
    const body = await response.json();
    return body?.error?.message || fallback;
  } catch {
    return fallback;
  }
}

async function startYouTubeSession(accessToken, details) {
  const response = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json; charset=UTF-8",
      "x-upload-content-length": String(chosenFile.size),
      "x-upload-content-type": chosenFile.type || "application/octet-stream"
    },
    body: JSON.stringify({
      snippet: {
        title: youtubeTitle(details),
        description: youtubeDescription(details),
        categoryId: "29",
        defaultLanguage: "en"
      },
      status: {
        privacyStatus: details.visibility,
        embeddable: true,
        license: "youtube",
        selfDeclaredMadeForKids: false
      }
    })
  });

  if (!response.ok) throw new Error(await googleError(response, "YouTube could not prepare the upload."));
  const location = response.headers.get("location");
  if (!location) throw new Error("YouTube did not return an upload address. Check the OAuth client settings and try again.");
  return location;
}

function sendChunk(accessToken, start, end) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadSessionUrl);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader("Content-Type", chosenFile.type || "application/octet-stream");
    xhr.setRequestHeader("Content-Range", `bytes ${start}-${end - 1}/${chosenFile.size}`);
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable) return;
      const totalUploaded = Math.min(chosenFile.size, start + event.loaded);
      const percent = totalUploaded / chosenFile.size * 100;
      setProgress("", percent, `${formatBytes(totalUploaded)} of ${formatBytes(chosenFile.size)} uploaded directly to YouTube`);
    });
    xhr.addEventListener("load", () => {
      if (xhr.status === 200 || xhr.status === 201) {
        try { resolve({ complete: true, video: JSON.parse(xhr.responseText) }); }
        catch { reject(new Error("YouTube accepted the video but returned an unreadable response.")); }
        return;
      }
      if (xhr.status === 308) {
        const range = xhr.getResponseHeader("Range");
        const acceptedEnd = range ? Number(range.split("-").pop()) + 1 : end;
        resolve({ complete: false, nextOffset: Number.isFinite(acceptedEnd) ? acceptedEnd : end });
        return;
      }
      if (xhr.status === 401) {
        reject(new Error("Google authorization expired. Select Authorize & publish again to resume the upload."));
        return;
      }
      let message = "YouTube could not accept this part of the video.";
      try { message = JSON.parse(xhr.responseText)?.error?.message || message; } catch {}
      reject(new Error(message));
    });
    xhr.addEventListener("error", () => reject(new Error("The connection to YouTube was interrupted. Select Authorize & publish to resume.")));
    xhr.send(chosenFile.slice(start, end));
  });
}

async function uploadToYouTube(accessToken) {
  while (uploadOffset < chosenFile.size) {
    const end = Math.min(uploadOffset + YOUTUBE_CHUNK_BYTES, chosenFile.size);
    let result;
    let lastError;
    for (const delay of [0, 1000, 3000, 7000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        result = await sendChunk(accessToken, uploadOffset, end);
        break;
      } catch (error) {
        lastError = error;
        if (/authorization expired/i.test(error.message)) throw error;
      }
    }
    if (!result) throw lastError || new Error("The upload could not continue.");
    if (result.complete) return result.video;
    uploadOffset = result.nextOffset;
  }
  throw new Error("YouTube did not confirm the completed upload.");
}

async function addToSermonsPlaylist(accessToken, videoId) {
  const response = await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      snippet: {
        playlistId: appConfig.sermonsPlaylistId,
        resourceId: { kind: "youtube#video", videoId }
      }
    })
  });
  if (!response.ok) throw new Error(await googleError(response, "The video uploaded, but it could not be added to the PBC Sermons playlist."));
}

async function publishSermon() {
  if (!chosenFile || activeUpload) return;
  if (chosenAudio && !appConfig?.buzzsproutConfigured) { showStatus("Connect Buzzsprout before publishing with audio, or remove the audio to upload video only."); return; }
  activeUpload = true;
  showStatus("");
  publishSuccess.hidden = true;
  publishButton.disabled = true;
  document.querySelectorAll("[data-back-to]").forEach((button) => { button.disabled = true; });

  try {
    const accessToken = !workflow.videoId || !workflow.playlistAdded ? await requestYouTubeToken() : undefined;
    const details = workflow.details || sermonDetails();
    workflow.details = details;
    workflow.wantsPodcast = workflow.wantsPodcast || Boolean(chosenAudio);
    workflow.podcastMode = workflow.podcastMode || podcastVisibility.value;
    saveWorkflow();
    progressTitle.textContent = "Uploading directly to YouTube…";
    setProgress("", uploadOffset / chosenFile.size * 100, "Starting the secure YouTube upload…");

    if (!workflow.videoId) {
      if (!uploadSessionUrl) uploadSessionUrl = await startYouTubeSession(accessToken, details);
      const video = await uploadToYouTube(accessToken);
      workflow.videoId = video.id;
      saveWorkflow();
    }
    uploadOffset = chosenFile.size;
    progressTitle.textContent = "Adding to the PBC Sermons playlist…";
    setProgress("", 100, "The video upload is complete. Finishing the playlist connection…");

    if (!workflow.playlistAdded) {
      await addToSermonsPlaylist(accessToken, workflow.videoId);
      workflow.playlistAdded = true;
      saveWorkflow();
    }
    youtubeVideoLink.href = `https://youtu.be/${workflow.videoId}`;
    if (workflow.wantsPodcast) await publishPodcast(details);

    activeUpload = false;
    progressTitle.textContent = workflow.wantsPodcast ? "Video and podcast audio sent" : "Published to YouTube";
    setProgress("complete", 100, "The daily Church Center sync will pick up the video.");
    publishSuccess.querySelector("span").textContent = workflow.wantsPodcast
      ? workflow.podcastPublished ? "The video is on YouTube. Buzzsprout has accepted the podcast for publication; processing and podcast-app updates may take time." : "The video is on YouTube. The audio was sent to an unpublished Buzzsprout draft; check it there after processing."
      : "It is on YouTube and in the PBC Sermons playlist.";
    publishSuccess.hidden = false;
    publishButton.hidden = true;
  } catch (error) {
    activeUpload = false;
    showStatus(error instanceof Error ? error.message : "The sermon could not be published.");
    progressTitle.textContent = workflow.videoId ? "Video saved — another step needs attention" : uploadOffset > 0 ? "Upload paused" : "Could not start upload";
    if (!uploadProgress.hidden) setProgress("error", 0, workflow.videoId ? "Your YouTube video will not be uploaded again. Retry only the unfinished steps." : "Keep this page open to resume the video upload.");
    if (workflow.videoId) publishButton.textContent = "Retry unfinished steps";
    publishButton.disabled = false;
    document.querySelectorAll("[data-back-to]").forEach((button) => { button.disabled = Boolean(workflow.videoId || uploadSessionUrl); });
  }
}

input.addEventListener("change", () => chooseFile(input.files?.[0]));
audioInput.addEventListener("change", () => {
  chooseAudio(audioInput.files?.[0]);
});
removeAudio.addEventListener("click", () => { chooseAudio(undefined); if (!chosenAudio) audioInput.value = ""; });
removeButton.addEventListener("click", clearFile);
detailsButton.addEventListener("click", () => showStep(2));
reviewButton.addEventListener("click", () => {
  if (!detailsForm.reportValidity()) return;
  const formattedTitle = youtubeTitle(sermonDetails());
  if (formattedTitle.length > MAX_YOUTUBE_TITLE_CHARACTERS) {
    window.alert(`The formatted YouTube title is ${formattedTitle.length} characters. Please shorten the sermon title or speaker name by at least ${formattedTitle.length - MAX_YOUTUBE_TITLE_CHARACTERS} characters.`);
    return;
  }
  fillReview();
  showStep(3);
});
publishButton.addEventListener("click", publishSermon);

for (const button of document.querySelectorAll("[data-back-to]")) {
  button.addEventListener("click", () => showStep(Number(button.dataset.backTo)));
}
for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
}
dropZone.addEventListener("drop", (event) => chooseFile(event.dataTransfer?.files?.[0]));
window.addEventListener("beforeunload", (event) => {
  if (!activeUpload) return;
  event.preventDefault();
  event.returnValue = "";
});

loadConfig().catch((error) => {
  appConfig = {};
  document.querySelector("#audio-help").textContent = "Could not check the podcast connection. Refresh the page before uploading audio.";
  document.querySelector("#podcast-connection").textContent = "connection unavailable";
  console.error(error);
});
