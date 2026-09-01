import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function inventoryStateLabel(status) {
  return { exposed: "Esposta", unplaced: "Da collocare", unavailable: "Non disponibile" }[status] || "Nell’inventario";
}
function targetContext(target) {
  const inventory = target.inventory || null;
  const content = target.museumContent || { availableCount: 0, draftCount: 0 };
  const rows = [];
  if (inventory) rows.push(`Inventario · ${inventoryStateLabel(inventory.status)}`);
  if (inventory?.place || inventory?.slot) {
    const location = [inventory.place?.label || inventory.place?.floorLabel, inventory.slot?.label].filter(Boolean).join(" · ");
    if (location) rows.push(location);
  }
  const available = Math.max(0, Number(content.availableCount) || 0);
  const drafts = Math.max(0, Number(content.draftCount) || 0);
  const contentParts = [];
  if (available) contentParts.push(`${available} ${available === 1 ? "contenuto disponibile" : "contenuti disponibili"}`);
  if (drafts) contentParts.push(`${drafts} ${drafts === 1 ? "bozza" : "bozze"}`);
  if (contentParts.length) rows.push(contentParts.join(" · "));
  return rows.map((row) => `<span class="chip">${escapeHtml(row)}</span>`).join("");
}

export class VenueTargetChooser extends HTMLElement {
  data = null; error = null; venueId = null;
  connectedCallback() { this.load(); }
  async load() {
    const venueId = new URLSearchParams(window.location.search).get("venueId");
    if (!venueId) { this.error = "Sede non specificata."; this.render(); return; }
    this.venueId = venueId;
    try { this.data = await authoringRepository.venueTargets(venueId); }
    catch (error) { this.error = error instanceof Error ? error.message : "Impossibile caricare le entità della sede"; }
    this.render();
  }
  render() {
    const targets = (this.data?.targets || []).map((target) => `<article class="target-choice"><div class="target-choice__icon">${icon("museum", { size: 22 })}</div><div class="target-choice__copy"><span class="eyebrow">${escapeHtml(target.subject?.preferredLabel || "Soggetto non disponibile")}</span><h2>${escapeHtml(target.label)}</h2>${target.description ? `<p>${escapeHtml(target.description)}</p>` : ""}${targetContext(target)}${(target.recognitionMedia || []).length ? `<span class="chip">${target.recognitionMedia.length} ${target.recognitionMedia.length === 1 ? "immagine" : "immagini"} di riconoscimento</span>` : ""}</div><a class="button-link" data-route href="/workspace/item-authoring?venueTargetId=${encodeURIComponent(target.id)}">Crea contenuto ${icon("chevron", { size: 16 })}</a></article>`).join("");
    const otherSubjectAction = this.data && this.venueId
      ? `<aside class="context-box"><div><span class="eyebrow">Non trovi l’entità giusta?</span><strong>Cerca un altro soggetto</strong><p>ArtAround controllerà prima l’inventario di questa sede e i contenuti del museo, poi estenderà la ricerca alle altre identità disponibili.</p></div><a class="button-link secondary" data-route href="/workspace/item-authoring?venueId=${encodeURIComponent(this.venueId)}&physicalIntent=1">Crea contenuto per un’altra entità ${icon("chevron", { size: 16 })}</a></aside>`
      : "";
    this.innerHTML = `<main class="target-chooser-page"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/create">${icon("arrowLeft", { size: 16 })} Crea</a><span>/</span><span>Entità della sede</span></nav><header class="page-header"><div><span class="eyebrow">Inventario della sede</span><h1>${escapeHtml(this.data?.venue?.name || "Entità della sede")}</h1><p>Scegli un’entità dell’inventario a cui associare il nuovo contenuto. Il Subject esatto verrà precompilato nel wizard, indipendentemente dal fatto che l’entità sia esposta, da collocare o temporaneamente non disponibile.</p></div>${this.data ? `<span class="count">${this.data.targets.length}</span>` : ""}</header>${this.error ? `<p role="alert">${icon("warning", { size: 17 })} ${escapeHtml(this.error)}</p>` : ""}<div class="target-choice-list">${targets || (!this.error ? `<div class="empty-state">${icon("museum", { size: 28 })}<h3>Nessuna entità nell’inventario</h3><p>Puoi comunque cercare un soggetto e, se hai il permesso fisico, aggiungerlo all’inventario durante la creazione del contenuto.</p></div>` : "")}</div>${otherSubjectAction}</main>`;
  }
}
customElements.define("artaround-venue-target-chooser", VenueTargetChooser);