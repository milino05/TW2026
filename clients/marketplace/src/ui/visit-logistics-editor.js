import { authoringRepository } from "../infrastructure/http/authoring-repository.js";

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
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
  }

  get visitId() { return visitIdFromUrl(); }
  get revision() { return this.projection?.visit?.revision || null; }
  get editable() { return hasOperation(this.projection, "visit.edit"); }

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
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Aggiornamento logistica non riuscito";
    } finally {
      this.busy = false;
      this.render();
    }
  };

  renderRouteHints() {
    const hints = this.revision?.logistics?.routeHints || [];
    if (!hints.length) return `<p>Nessuna indicazione di trasferimento esplicita. Il routing fisico resta responsabilità della Venue/Layout.</p>`;
    return `<ul>${hints.map((hint) => `<li><strong>${escapeHtml(hint.type)}</strong>${hint.instructionOverride ? ` — ${escapeHtml(hint.instructionOverride)}` : ""}${hint.note ? ` · ${escapeHtml(hint.note)}` : ""}${hint.estimatedTransferSeconds != null ? ` · ${escapeHtml(hint.estimatedTransferSeconds)} s` : ""}</li>`).join("")}</ul>`;
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
    const form = this.editable ? `<form data-visit-logistics><label>Note prima della visita, una per riga<textarea name="preVisitNotes" rows="5">${escapeHtml(notes)}</textarea></label><button type="submit" ${this.busy ? "disabled" : ""}>Salva indicazioni logistiche</button></form>` : `<p>${notes ? escapeHtml(notes).replaceAll("\n", "<br>") : "Nessuna nota pre-visita."}</p><p>La revisione non è modificabile nello stato corrente.</p>`;
    this.innerHTML = `<style>.visit-logistics{max-width:72rem;margin:0 auto 2rem;padding:1rem;border-top:1px solid currentColor}.visit-logistics form,.visit-logistics label{display:grid;gap:.6rem}.visit-logistics button,.visit-logistics textarea{font:inherit;padding:.55rem .7rem}.visit-logistics .note{opacity:.76}</style><section class="visit-logistics"><h2>Indicazioni logistiche</h2><p class="note">Le indicazioni logistiche appartengono alla Visit ma sono separate dai contenuti: non sono Item e non vengono inserite in <code>contentEntries</code>.</p>${this.message ? `<p role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${form}<h3>Trasferimenti strutturati</h3>${this.renderRouteHints()}</section>`;
  }
}

customElements.define("artaround-visit-logistics-editor", ArtAroundVisitLogisticsEditor);
