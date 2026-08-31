const EDITOR_SELECTOR = "artaround-item-authoring-view";
let observer = null;
let scanQueued = false;

function enhanceUploadRow(row) {
  if (!(row instanceof HTMLElement) || row.dataset.artaroundMediaFieldEnhanced === "true") return;
  const input = row.querySelector('input[type="file"][data-media-upload]');
  if (!(input instanceof HTMLInputElement)) return;

  const field = document.createElement("artaround-media-field");
  field.dataset.artaroundMediaEnhancement = "item-upload";
  row.parentNode?.insertBefore(field, row);
  field.append(row);
  row.dataset.artaroundMediaFieldEnhanced = "true";

  const card = field.closest(".item-media-card");
  if (card instanceof HTMLElement) {
    card.dataset.mediaFieldScope = "";
    const preview = card.querySelector("figure img");
    if (preview instanceof HTMLElement) preview.dataset.mediaPreview = "";
  }
}

function scan() {
  for (const editor of document.querySelectorAll(EDITOR_SELECTOR)) {
    for (const row of editor.querySelectorAll(".media-upload-row")) enhanceUploadRow(row);
  }
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    scan();
  });
}

export function installItemMediaFieldAdapter() {
  if (observer || typeof document === "undefined") return;
  queueScan();
  observer = new MutationObserver(queueScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

installItemMediaFieldAdapter();
