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

export class ContextReleaseComposer extends HTMLElement {
  data = null;
  error = null;
  notice = null;
  busy = false;

  connectedCallback() {
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("change", this.onChange);
    this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("change", this.onChange);
  }

  contextId() { return new URLSearchParams(window.location.search).get("editorialContextId"); }

  async load() {
    const contextId = this.contextId();
    if (!contextId) { this.error = "Raccolta editoriale non specificata."; this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
    try { this.data = await authoringRepository.editorialReleaseComposer(contextId); }
    catch (error) { this.error = error instanceof Error ? error.message : "Strumento di pubblicazione non disponibile"; }
    finally { this.busy = false; this.render(); }
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("form[data-release-composer]")) return;
    event.preventDefault();
    const selected = new Set(new FormData(form).getAll("candidate").map(String));
    const itemBindings = (this.data?.candidates || [])
      .filter((candidate) => selected.has(String(candidate.itemEditionId)))
      .map((candidate) => ({ itemEditionId: candidate.itemEditionId, itemRevisionId: candidate.itemRevisionId, curationSignals: [] }));
    this.busy = true;
    this.error = null;
    this.notice = null;
    this.render();
    try {
      const release = await authoringRepository.createEditorialRelease(this.contextId(), {
        namespaceRevisionId: this.data.releaseInputs.namespaceRevisionId,
        graphRevisionId: this.data.releaseInputs.graphRevisionId,
        itemBindings,
      });
      this.notice = `Versione ${release.version} della raccolta pubblicata.`;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Pubblicazione della nuova versione non riuscita";
      this.busy = false;
      this.render();
    }
  };

  onChange = (event) => {
    if (!event.target?.matches?.('[name="candidate"]')) return;
    const count = this.querySelectorAll('[name="candidate"]:checked').length;
    const output = this.querySelector("[data-selection-count]");
    if (output) output.textContent = `${count} ${count === 1 ? "contenuto selezionato" : "contenuti selezionati"}`;
  };

  renderTechnicalDetails() {
    if (!this.data?.releaseInputs) return "";
    return `<details class="technical-details"><summary>Dettagli tecnici della versione</summary><dl class="definition-list"><div><dt>NamespaceRevision</dt><dd><code>${escapeHtml(this.data.releaseInputs.namespaceRevisionId || "Non disponibile")}</code></dd></div><div><dt>GraphRevision</dt><dd><code>${escapeHtml(this.data.releaseInputs.graphRevisionId || "Non disponibile")}</code></dd></div></dl><p class="note">Questi riferimenti fissano lo stato delle regole editoriali e del grafo usato dalla versione pubblicata.</p></details>`;
  }

  render() {
    const selectedCount = (this.data?.candidates || []).filter((candidate) => candidate.selectedByCurrentRelease).length;
    const candidates = (this.data?.candidates || []).map((candidate) => `
      <label class="candidate"><input type="checkbox" name="candidate" value="${escapeHtml(candidate.itemEditionId)}" ${candidate.selectedByCurrentRelease ? "checked" : ""}>
        <span class="candidate-copy"><strong>${escapeHtml(candidate.title)}</strong>${candidate.subject?.preferredLabel ? `<span>${escapeHtml(candidate.subject.preferredLabel)}</span>` : ""}<small>Versione ${escapeHtml(candidate.version)} · ${(candidate.authorCredits || []).map(escapeHtml).join(", ") || "Autore non indicato"}</small></span>
        <span class="chip">${escapeHtml(candidate.license || "Licenza non indicata")}</span>
      </label>`).join("");

    this.innerHTML = `<main class="composer-page">
      <nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">${icon("arrowLeft", { size: 16 })} Libreria</a><span>/</span><span>Pubblica una nuova versione</span></nav>
      <header class="page-header"><div><span class="eyebrow">Raccolta editoriale</span><h1>Pubblica una nuova versione</h1><p>Scegli i contenuti da includere e crea una versione pubblicata della raccolta editoriale.</p></div>${this.data ? `<span class="chip" data-selection-count aria-live="polite">${selectedCount} ${selectedCount === 1 ? "contenuto selezionato" : "contenuti selezionati"}</span>` : ""}</header>
      ${this.data ? `<section class="release-context surface"><div class="release-context__icon">${icon("book", { size: 24 })}</div><div><span class="eyebrow">Raccolta editoriale</span><h2>${escapeHtml(this.data.context.name)}</h2><p>Spazio editoriale: <strong>${escapeHtml(this.data.contentSpace.name)}</strong> · Regole editoriali: <strong>${escapeHtml(this.data.namespace.name)}</strong></p></div></section>` : ""}
      ${this.busy ? `<p role="status">${icon("info", { size: 17 })} Elaborazione in corso…</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 17 })} ${escapeHtml(this.error)}</p>` : ""}${this.notice ? `<p role="status">${icon("check", { size: 17 })} ${escapeHtml(this.notice)}</p>` : ""}
      ${this.data ? `<form data-release-composer><div class="section-heading"><div><span class="eyebrow">Contenuti disponibili</span><h2>Contenuti della nuova versione</h2><p>La selezione definisce lo snapshot editoriale che verrà pubblicato.</p></div><span class="count">${this.data.candidates.length}</span></div><div class="candidate-list">${candidates || `<div class="empty-state">${icon("book", { size: 28 })}<h3>Nessun contenuto pronto</h3><p>Completa e pubblica almeno un contenuto compatibile con questo spazio editoriale.</p></div>`}</div><div class="composer-actions"><div><p>La nuova versione fotografa lo stato editoriale corrente.</p>${this.renderTechnicalDetails()}</div><button ${this.busy ? "disabled" : ""}>${icon("check", { size: 17 })} Pubblica nuova versione</button></div></form>` : ""}
      </main>`;
  }
}

customElements.define("artaround-context-release-composer", ContextReleaseComposer);
