const input = document.querySelector("#video-file");
const dropZone = document.querySelector("#drop-zone");
const selectedFile = document.querySelector("#selected-file");
const preview = document.querySelector("#video-preview");
const fileName = document.querySelector("#file-name");
const fileMeta = document.querySelector("#file-meta");
const removeButton = document.querySelector("#remove-file");
const continueButton = document.querySelector("#continue-button");

let previewUrl;

function formatBytes(bytes) {
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function chooseFile(file) {
  if (!file || !file.type.startsWith("video/")) return;
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;
  fileName.textContent = file.name;
  fileMeta.textContent = `${formatBytes(file.size)} · Ready for sermon details`;
  dropZone.hidden = true;
  selectedFile.hidden = false;
  continueButton.disabled = false;
}

function clearFile() {
  input.value = "";
  preview.removeAttribute("src");
  preview.load();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  dropZone.hidden = false;
  selectedFile.hidden = true;
  continueButton.disabled = true;
}

input.addEventListener("change", () => chooseFile(input.files?.[0]));
removeButton.addEventListener("click", clearFile);

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
continueButton.addEventListener("click", () => {
  window.alert("The upload screen is ready. Next we’ll connect secure login and the publishing services.");
});

