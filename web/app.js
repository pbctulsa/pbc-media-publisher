import * as tus from "tus-js-client";

const input = document.querySelector("#video-file");
const dropZone = document.querySelector("#drop-zone");
const selectedFilePanel = document.querySelector("#selected-file");
const preview = document.querySelector("#video-preview");
const fileName = document.querySelector("#file-name");
const fileMeta = document.querySelector("#file-meta");
const removeButton = document.querySelector("#remove-file");
const continueButton = document.querySelector("#continue-button");
const uploadProgress = document.querySelector("#upload-progress");
const progressTitle = document.querySelector("#progress-title");
const progressPercent = document.querySelector("#progress-percent");
const progressBar = document.querySelector("#progress-bar");
const progressMessage = document.querySelector("#progress-message");

let previewUrl;
let chosenFile;
let activeUpload;
let uploadedVideoId;

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function setProgress(state, percent, message) {
  uploadProgress.hidden = false;
  uploadProgress.className = `upload-progress ${state ? `upload-${state}` : ""}`;
  progressBar.style.width = `${percent}%`;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressMessage.textContent = message;
}

function chooseFile(file) {
  if (!file || !file.type.startsWith("video/")) return;
  if (file.size > 30 * 1024 ** 3) {
    window.alert("Please choose a video smaller than 30 GB.");
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  chosenFile = file;
  uploadedVideoId = undefined;
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatBytes(file.size)} · Ready to upload securely`;
  dropZone.hidden = true;
  selectedFilePanel.hidden = false;
  uploadProgress.hidden = true;
  continueButton.disabled = false;
  continueButton.firstChild.textContent = "Upload video ";
}

function clearFile() {
  if (activeUpload) return;
  input.value = "";
  chosenFile = undefined;
  uploadedVideoId = undefined;
  preview.removeAttribute("src");
  preview.load();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  dropZone.hidden = false;
  selectedFilePanel.hidden = true;
  uploadProgress.hidden = true;
  continueButton.disabled = true;
  continueButton.firstChild.textContent = "Upload video ";
}

async function beginUpload() {
  if (uploadedVideoId) {
    window.alert("The video is uploaded. The sermon-details screen is the next step we’ll connect.");
    return;
  }
  if (!chosenFile || activeUpload) return;

  continueButton.disabled = true;
  removeButton.disabled = true;
  progressTitle.textContent = "Uploading securely…";
  setProgress("", 0, "Keep this window open. If the connection drops, the upload can resume.");

  activeUpload = new tus.Upload(chosenFile, {
    endpoint: "/api/uploads",
    chunkSize: 50 * 1024 * 1024,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
    metadata: {
      filename: chosenFile.name,
      filetype: chosenFile.type || "video/mp4"
    },
    removeFingerprintOnSuccess: true,
    onError(error) {
      console.error("Upload failed", error);
      activeUpload = undefined;
      removeButton.disabled = false;
      continueButton.disabled = false;
      progressTitle.textContent = "Upload paused";
      setProgress("error", 0, "The upload could not continue. Check the connection and select Upload video to retry.");
    },
    onProgress(bytesUploaded, bytesTotal) {
      const percent = bytesTotal > 0 ? (bytesUploaded / bytesTotal) * 100 : 0;
      setProgress("", percent, `${formatBytes(bytesUploaded)} of ${formatBytes(bytesTotal)} uploaded`);
    },
    onSuccess() {
      const uploadUrl = activeUpload?.url;
      uploadedVideoId = uploadUrl?.split("/").filter(Boolean).pop();
      activeUpload = undefined;
      removeButton.disabled = true;
      continueButton.disabled = false;
      continueButton.firstChild.textContent = "Continue to details ";
      progressTitle.textContent = "Video uploaded securely";
      setProgress("complete", 100, "Cloudflare is preparing the video. You can continue when the details screen is connected.");
      if (uploadedVideoId) sessionStorage.setItem("pbcUploadedVideoId", uploadedVideoId);
    }
  });

  const previousUploads = await activeUpload.findPreviousUploads();
  if (previousUploads.length > 0) activeUpload.resumeFromPreviousUpload(previousUploads[0]);
  activeUpload.start();
}

input.addEventListener("change", () => chooseFile(input.files?.[0]));
removeButton.addEventListener("click", clearFile);
continueButton.addEventListener("click", beginUpload);

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

