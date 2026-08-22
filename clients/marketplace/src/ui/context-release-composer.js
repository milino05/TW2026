import { authoringRepository } from "../infrastructure/http/authoring-repository.js";

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
    this.load();
  }
  disconnectedCallback() { this.removeEventListener("submit", this.onSubmit); }

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

  render() {
    const candidates = (this.data?.candidates || []).map((candidate) => `
      <label class="candidate"><input type="checkbox" name="candidate" value="${escapeHtml(candidate.itemEditionId)}" ${candidate.selectedByCurrentRelease ? "checked" : ""}>
        <span><strong>${escapeHtml(candidate.title)}</strong>${candidate.subject?.preferredLabel ? ` · ${escapeHtml(candidate.subject.preferredLabel)}` : ""}<small>v${escapeHtml(candidate.version)} · ${(candidate.authorCredits || []).map(escapeHtml).join(", ")} · ${escapeHtml(candidate.license || "senza licenza")}</small></span>
      </label>`).join("");
    this.innerHTML = `<style>:host{display:block}main{max-width:64rem;margin:0 auto;padding:2rem 1rem}form{display:grid;gap:1rem}.candidate{display:grid;grid-template-columns:auto 1fr;gap:.8rem;align-items:start;padding:.8rem 0;border-bottom:1px solid currentColor}.candidate small{display:block;opacity:.75}button{font:inherit;padding:.6rem .8rem}</style>
      <main><p><a data-route href="/workspace">← Workspace</a></p><h1>Componi EditorialRelease</h1>
      ${this.data ? `<p><strong>${escapeHtml(this.data.context.name)}</strong> · ${escapeHtml(this.data.contentSpace.name)} · ${escapeHtml(this.data.namespace.name)}</p><p>Vengono proposti solo Item member del ContentSpace, nello stesso Namespace e autorizzati per il principal del Context.</p>` : ""}
      ${this.busy ? "<p>Elaborazione…</p>" : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.notice ? `<p role="status">${escapeHtml(this.notice)}</p>` : ""}
      ${this.data ? `<form data-release-composer>${candidates || "<p>Nessun contenuto release-ready disponibile.</p>"}<button ${this.busy ? "disabled" : ""}>Pubblica nuova release</button></form>` : ""}
      </main>`;
  }
}

customElements.define("artaround-context-release-composer", ContextReleaseComposer);
