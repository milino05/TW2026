import { ItemAuthoringView } from "./item-authoring-view.js";
import { openMediaViewer } from "./media-viewer.js";

const ITEM_MEDIA_PREVIEW_SELECTORS = [
  ".item-media-card > figure",
  ".review-media > figure",
];

function enhanceMediaPreview(figure) {
  if (!(figure instanceof HTMLElement) || figure.dataset.artaroundMediaViewer === "true") return;
  const image = figure.querySelector("img[src]");
  if (!(image instanceof HTMLImageElement)) return;

  figure.dataset.artaroundMediaViewer = "true";
  figure.setAttribute("role", "button");
  figure.setAttribute("tabindex", "0");
  figure.setAttribute("aria-label", image.alt
    ? `Apri anteprima: ${image.alt}`
    : "Apri anteprima immagine");

  const open = () => {
    if (!image.isConnected || !image.src) return;
    openMediaViewer({
      src: image.currentSrc || image.src,
      type: "image",
      alt: image.alt || "",
      title: "Anteprima immagine del contenuto",
    });
  };

  figure.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a, button, input, select, textarea")) return;
    open();
  });
  figure.addEventListener("keydown", (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    open();
  });
}

function enhanceItemMedia(editor) {
  for (const selector of ITEM_MEDIA_PREVIEW_SELECTORS) {
    for (const figure of editor.querySelectorAll(selector)) enhanceMediaPreview(figure);
  }
}

const prototype = ItemAuthoringView.prototype;
if (!prototype.__sharedMediaViewerProjection) {
  const render = prototype.render;
  prototype.render = function renderWithSharedMediaViewer(...args) {
    const result = render.apply(this, args);
    enhanceItemMedia(this);
    return result;
  };
  Object.defineProperty(prototype, "__sharedMediaViewerProjection", { value: true });
}
