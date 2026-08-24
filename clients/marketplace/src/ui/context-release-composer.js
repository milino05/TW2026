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
    if (!contextId) { this.error = "EditorialContext non specificato."; this.render(); return; }
    this.busy = true; this.render();
    try { this.data = await authoringRepository.editorialReleaseComposer(contextId); }
    catch (error) { this.error = error instanceof Error ? error.message : "Composer non disponibile"; }
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
    this.busy = true; this.error = null; this.notice = null; this.render();
    try {
      const release = await authoringRepository.createEditorialRelease(this.contextId(), {
        namespaceRevisionId: this.data.releaseInputs.namespaceRevisionId,
        graphRevisionId: this.data.releaseInputs.graphRevisionId,
        itemBindings,
      });
      this.notice = `EditorialRelease ${release.version} pubblicata.`;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Pubblicazione della release non riuscita";
      this.busy = false; this.render();
    }
  };

  onChange = (event) => {
    if (!event.target?.matches?.('[name="candidate"]')) return;
    const count = this.querySelectorAll('[name="candidate"]:checked').length;
    const output = this.querySelector("[data-selection-count]");
    if (output) output.textContent = `${count} ${count === 1 ? "contenuto selezionato" : "contenuti selezionati"}`;
  };

  render() {
    const selectedCount = (this.data?.candidates || []).filter((candidate) => candidate.selectedByCurrentRelease).length;
    const candidates = (this.data?.candidates || []).map((candidate) => `
      <label class="candidate"><input type="checkbox" name="candidate" value="${escapeHtml(candidate.itemEditionId)}" ${candidate.selectedByCurrentRelease ? "checked" : ""}>
        <span class="candidate-copy"><strong>${escapeHtml(candidate.title)}</strong>${candidate.subject?.preferredLabel ? `<span>${escapeHtml(candidate.subject.preferredLabel)}</span>` : ""}<small>Versione ${escapeHtml(candidate.version)} · ${(candidate.authorCredits || []).map(escapeHtml).join(", ") || "Autore non indicato"}</small></span>
        <span class="chip">${escapeHtml(candidate.license || "Licenza non indicata")}</span>
      </label>`).join("");
    this.innerHTML = `<main class="composer-page">
      <nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">${icon("arrowLeft", { size: 16 })} Workspace</a><span>/</span><span>Editorial release</span></nav>
      <header class="page-header"><div><span class="eyebrow">Pubblicazione editoriale</span><h1>Componi la release</h1><p>Seleziona i contenuti pronti e pubblica una nuova versione del contesto editoriale.</p></div>${this.data ? `<span class="chip" data-selection-count>${selectedCount} ${selectedCount === 1 ? "contenuto selezionato" : "contenuti selezionati"}</span>` : ""}</header>
      ${this.data ? `<section class="release-context surface"><div class="release-context__icon">${icon("book", { size: 24 })}</div><div><span class="eyebrow">Contesto corrente</span><h2>${escapeHtml(this.data.context.name)}</h2><p>${escapeHtml(this.data.contentSpace.name)} · ${escapeHtml(this.data.namespace.name)}</p></div></section>` : ""}
      ${this.busy ? `<p role="status">${icon("info", { size: 17 })} Elaborazione in corso…</p>` : ""}${this.error ? `<p role="alert">${icon("warning", { size: 17 })} ${escapeHtml(this.error)}</p>` : ""}${this.notice ? `<p role="status">${icon("check", { size: 17 })} ${escapeHtml(this.notice)}</p>` : ""}
      ${this.data ? `<form data-release-composer><div class="section-heading"><div><span class="eyebrow">Contenuti candidati</span><h2>Elementi della release</h2></div><span class="count">${this.data.candidates.length}</span></div><div class="candidate-list">${candidates || `<div class="empty-state">${icon("book", { size: 28 })}<h3>Nessun contenuto pronto</h3><p>Completa e pubblica almeno una revisione compatibile con questo ContentSpace.</p></div>`}</div><div class="composer-actions"><p>La release userà le revisioni di Namespace e grafo correnti.</p><button ${this.busy ? "disabled" : ""}>${icon("check", { size: 17 })} Pubblica nuova release</button></div></form>` : ""}
      </main>`;
  }
}

customElements.define("artaround-context-release-composer", ContextReleaseComposer);
