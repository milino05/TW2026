import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { icon } from "./icons.js";

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
      <article class="target-choice">
        <div class="target-choice__icon">${icon("museum", { size: 22 })}</div>
        <div class="target-choice__copy"><span class="eyebrow">${escapeHtml(target.subject?.preferredLabel || "Subject non disponibile")}</span><h2>${escapeHtml(target.label)}</h2>
        ${target.description ? `<p>${escapeHtml(target.description)}</p>` : ""}
        ${(target.recognitionMedia || []).length ? `<span class="chip">${target.recognitionMedia.length} ${target.recognitionMedia.length === 1 ? "immagine" : "immagini"} di riconoscimento</span>` : ""}</div>
        <a class="button-link" data-route href="/workspace/item-authoring?venueTargetId=${encodeURIComponent(target.id)}">Crea contenuto ${icon("chevron", { size: 16 })}</a>
      </article>`).join("");
    this.innerHTML = `<main class="target-chooser-page"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/catalog">${icon("arrowLeft", { size: 16 })} Catalogo</a><span>/</span><span>Oggetti della sede</span></nav><header class="page-header"><div><span class="eyebrow">Contesto fisico</span><h1>${escapeHtml(this.data?.venue?.name || "Oggetti della sede")}</h1><p>Scegli l'oggetto a cui associare il nuovo contenuto. Il soggetto verrà precompilato nel wizard.</p></div>${this.data ? `<span class="count">${this.data.targets.length}</span>` : ""}</header>
      ${this.error ? `<p role="alert">${icon("warning", { size: 17 })} ${escapeHtml(this.error)}</p>` : ""}<div class="target-choice-list">${targets || (!this.error ? `<div class="empty-state">${icon("museum", { size: 28 })}<h3>Nessun oggetto pubblicato</h3><p>Questa sede non espone ancora oggetti utilizzabili per la creazione di contenuti.</p></div>` : "")}</div></main>`;
  }
}

customElements.define("artaround-venue-target-chooser", VenueTargetChooser);
