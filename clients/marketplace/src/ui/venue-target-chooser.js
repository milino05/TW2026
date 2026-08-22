import { authoringRepository } from "../infrastructure/http/authoring-repository.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export class VenueTargetChooser extends HTMLElement {
  data = null;
  error = null;

  connectedCallback() { this.load(); }

  async load() {
    const venueId = new URLSearchParams(window.location.search).get("venueId");
    if (!venueId) {
      this.error = "Venue non specificata.";
      this.render();
      return;
    }
    try { this.data = await authoringRepository.venueTargets(venueId); }
    catch (error) { this.error = error instanceof Error ? error.message : "Impossibile caricare gli oggetti della Venue"; }
    this.render();
  }

  render() {
    const targets = (this.data?.targets || []).map((target) => `
      <article>
        <h2>${escapeHtml(target.label)}</h2>
        <p>${escapeHtml(target.subject?.preferredLabel || "Subject non disponibile")}</p>
        ${target.description ? `<p>${escapeHtml(target.description)}</p>` : ""}
        ${(target.recognitionMedia || []).length ? `<p>${target.recognitionMedia.length} immagine/i di riconoscimento disponibili nel contesto fisico.</p>` : ""}
        <a data-route href="/workspace/item-authoring?venueTargetId=${encodeURIComponent(target.id)}">Crea contenuto per questo oggetto</a>
      </article>`).join("");
    this.innerHTML = `<style>:host{display:block}main{max-width:64rem;margin:0 auto;padding:2rem 1rem}article{padding:1rem 0;border-bottom:1px solid currentColor}</style>
      <main><p><a data-route href="/catalog">← Catalogo</a></p><h1>${escapeHtml(this.data?.venue?.name || "Oggetti della sede")}</h1>
      <p>La scelta di un oggetto precompila il Subject del wizard. VenueTarget e Item restano entità separate.</p>
      ${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${targets || (!this.error ? "<p>Nessun oggetto pubblicato disponibile.</p>" : "")}</main>`;
  }
}

customElements.define("artaround-venue-target-chooser", VenueTargetChooser);
