export class ArtAroundMediaField extends HTMLElement {
  previewUrl = null;

  connectedCallback() {
    this.addEventListener("change", this.onChange);
    this.addEventListener("click", this.onClick);
    this.sync();
  }

  disconnectedCallback() {
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("click", this.onClick);
    this.revokePreview();
  }

  get input() { return this.querySelector('input[type="file"]'); }
  get preview() { return this.querySelector("[data-media-preview]"); }

  revokePreview() {
    if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
    this.previewUrl = null;
  }

  sync() {
    const input = this.input;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.hasAttribute("accept")) input.setAttribute("accept", "image/*,audio/*,video/*");
  }

  showLocalPreview(file) {
    this.revokePreview();
    const preview = this.preview;
    if (!(preview instanceof HTMLElement) || !file) return;
    this.previewUrl = URL.createObjectURL(file);
    if (preview instanceof HTMLImageElement || preview instanceof HTMLVideoElement || preview instanceof HTMLAudioElement) preview.src = this.previewUrl;
    else preview.style.backgroundImage = `url("${this.previewUrl.replaceAll('"', '%22')}")`;
  }

  onChange = (event) => {
    const input = event.target instanceof HTMLInputElement && event.target.type === "file" ? event.target : null;
    if (!input || !this.contains(input)) return;
    const file = input.files?.[0] || null;
    if (file) this.showLocalPreview(file);
    this.dispatchEvent(new CustomEvent("artaround:media-selected", { detail: { file }, bubbles: true, composed: true }));
  };

  onClick = (event) => {
    const remove = event.target instanceof Element ? event.target.closest("[data-media-remove]") : null;
    if (!remove || !this.contains(remove)) return;
    this.dispatchEvent(new CustomEvent("artaround:media-remove-requested", { bubbles: true, composed: true }));
  };
}

if (!customElements.get("artaround-media-field")) customElements.define("artaround-media-field", ArtAroundMediaField);
