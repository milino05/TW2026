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

function visitIdFromUrl() {
  return new URLSearchParams(window.location.search).get("visitId");
}

function hasOperation(projection, code) {
  return (projection?.availableOperations || []).some((operation) => operation.code === code);
}

function serializeRouteHints(revision) {
  return (revision?.logistics?.routeHints || []).map((hint) => ({
    _id: hint.id,
    fromAnchorId: hint.fromAnchorId,
    toAnchorId: hint.toAnchorId,
    type: hint.type,
    instructionOverride: hint.instructionOverride || null,
    note: hint.note || null,
    estimatedTransferSeconds: hint.estimatedTransferSeconds ?? null,
  }));
}

export class ArtAroundVisitLogisticsEditor extends HTMLElement {
  projection = null;
  busy = false;
  error = null;
  message = null;

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    window.addEventListener("artaround:visit-updated", this.onVisitUpdated);
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    window.removeEventListener("artaround:visit-updated", this.onVisitUpdated);
  }

  get visitId() { return visitIdFromUrl(); }
  get revision() { return this.projection?.visit?.revision || null; }
  get editable() { return hasOperation(this.projection, "visit.edit"); }

  onVisitUpdated = (event) => {
    if (!this.visitId || String(event.detail?.visitId || "") !== String(this.visitId)) return;
    this.load();
  };

  async load() {
    if (!this.visitId) { this.innerHTML = ""; return; }
    this.busy = true;
    this.render();
    try {
      this.projection = await authoringRepository.visitProjection({ visitId: this.visitId });
      this.error = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Indicazioni logistiche non disponibili";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("form[data-visit-logistics]")) return;
    event.preventDefault();
    if (!this.editable) return;
    const data = new FormData(form);
    const preVisitNotes = String(data.get("preVisitNotes") || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      await authoringRepository.updateVisit(this.visitId, {
        logistics: {
          preVisitNotes,
          routeHints: serializeRouteHints(this.revision),
        },
      });
      this.projection = await authoringRepository.visitProjection({ visitId: this.visitId });
      this.message = "Indicazioni logistiche aggiornate";
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Aggiornamento logistica non riuscito";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  renderRouteHints() {
    const hints = this.revision?.logistics?.routeHints || [];
    if (!hints.length) return `<div class="empty-state compact">${icon("route", { size: 24 })}<div><h3>Nessun trasferimento esplicito</h3><p>Il routing fisico resta responsabilità della Venue e del suo layout.</p></div></div>`;
    return `<div class="route-hint-list">${hints.map((hint, index) => `<article><span class="route-index">${index + 1}</span><div><strong>${escapeHtml(hint.type)}</strong>${hint.instructionOverride ? `<p>${escapeHtml(hint.instructionOverride)}</p>` : ""}${hint.note ? `<small>${escapeHtml(hint.note)}</small>` : ""}</div>${hint.estimatedTransferSeconds != null ? `<span class="chip">${escapeHtml(hint.estimatedTransferSeconds)} s</span>` : ""}</article>`).join("")}</div>`;
  }

  render() {
    if (!this.visitId) { this.innerHTML = ""; return; }
    if (this.busy && !this.projection) {
      this.innerHTML = `<section class="visit-logistics"><p>Caricamento indicazioni logistiche…</p></section>`;
      return;
    }
    if (!this.projection) {
      this.innerHTML = `<section class="visit-logistics"><p role="alert">${escapeHtml(this.error || "Indicazioni logistiche non disponibili")}</p></section>`;
      return;
    }
    const notes = (this.revision?.logistics?.preVisitNotes || []).join("\n");
    const form = this.editable ? `<form data-visit-logistics><label>Note prima della visita <small>Una indicazione per riga</small><textarea name="preVisitNotes" rows="5" placeholder="Per esempio: presentarsi 10 minuti prima…">${escapeHtml(notes)}</textarea></label><button type="submit" ${this.busy ? "disabled" : ""}>${icon("check", { size: 17 })} Salva indicazioni</button></form>` : `<div class="read-only-notes"><p>${notes ? escapeHtml(notes).replaceAll("\n", "<br>") : "Nessuna nota pre-visita."}</p><span class="chip">Sola lettura</span></div>`;
    this.innerHTML = `<section class="visit-logistics"><header><div><span class="eyebrow">Supporto alla visita</span><h2>Indicazioni logistiche</h2><p class="note">Informazioni operative separate dai contenuti: non sono Item e non entrano in <code>contentEntries</code>.</p></div><div class="section-icon">${icon("route", { size: 24 })}</div></header>${this.message ? `<p role="status">${icon("check", { size: 17 })} ${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 17 })} ${escapeHtml(this.error)}</p>` : ""}<div class="logistics-grid"><div>${form}</div><div><h3>Trasferimenti strutturati</h3>${this.renderRouteHints()}</div></div></section>`;
  }
}

customElements.define("artaround-visit-logistics-editor", ArtAroundVisitLogisticsEditor);
