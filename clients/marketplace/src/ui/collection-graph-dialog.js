import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundCollectionGraphDialog extends HTMLElement {
  config = null;
  mode = "new";
  view = "new";
  query = "";
  page = 1;
  choices = null;
  busy = false;
  error = null;
  selectedGraph = null;
  returnFocus = null;
  newDraft = { name: "", description: "" };
  forkDraft = { name: "", description: "" };

  connectedCallback() {
    this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("keydown", this.onKeyDown);
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("keydown", this.onKeyDown);
  }

  configure(options = {}) {
    this.config = options;
    this.mode = options.mode === "existing" ? "existing" : "new";
    this.view = this.mode;
    const current = options.currentSelection || null;
    if (this.mode === "new" && current?.graphMode === "new") {
      this.newDraft = {
        name: String(current.graphDisplayName || ""),
        description: String(current.graphDescription || ""),
      };
    }
    if (this.mode === "existing") {
      this.selectedGraph = current?.sourceGraph || current?.graph || null;
      if (current?.graphMode === "fork") {
        this.forkDraft = {
          name: String(current.graphDisplayName || ""),
          description: String(current.graphDescription || ""),
        };
      }
    }
    this.render();
    if (this.mode === "existing") void this.loadChoices();
    else this.focusFirst();
  }

  focusFirst() {
    requestAnimationFrame(() => this.querySelector("input, button, textarea")?.focus({ preventScroll: true }));
  }

  close() {
    this.dispatchEvent(new CustomEvent("collection-graph-dialog-close", { bubbles: true }));
    this.remove();
    this.returnFocus?.focus?.({ preventScroll: true });
  }

  select(selection) {
    this.dispatchEvent(new CustomEvent("collection-graph-selected", {
      bubbles: true,
      detail: { selection },
    }));
    this.remove();
    this.returnFocus?.focus?.({ preventScroll: true });
  }

  async loadChoices() {
    if (!this.config) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.choices = await editorialRepository.reusableSemanticGraphs({
        ownerType: this.config.ownerType,
        ownerId: this.config.ownerId,
        namespaceId: this.config.namespaceId,
        contentSpaceId: this.config.contentSpaceId,
        q: this.query,
        page: this.page,
        limit: 12,
      });
      const selectedId = id(this.selectedGraph);
      const refreshed = (this.choices?.results || []).find((graph) => id(graph) === selectedId);
      if (refreshed) this.selectedGraph = refreshed;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare i grafi compatibili";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.matches("[data-collection-graph-backdrop]") || target.closest("[data-close-collection-graph-dialog]")) {
      this.close();
      return;
    }
    const choice = target.closest("[data-collection-graph-choice]");
    if (choice) {
      const graph = (this.choices?.results || []).find((entry) => id(entry) === choice.dataset.collectionGraphChoice);
      if (graph) {
        this.selectedGraph = graph;
        this.error = null;
        this.render();
      }
      return;
    }
    const pageButton = target.closest("[data-collection-graph-page]");
    if (pageButton) {
      this.page = Math.max(1, Number(pageButton.dataset.collectionGraphPage) || 1);
      void this.loadChoices();
      return;
    }
    if (target.closest("[data-use-shared-graph]")) {
      if (!this.selectedGraph) return;
      this.select({
        graphMode: "shared",
        semanticGraphId: id(this.selectedGraph),
        graph: this.selectedGraph,
      });
      return;
    }
    if (target.closest("[data-start-graph-fork]")) {
      if (!this.selectedGraph) return;
      if (!this.forkDraft.name) this.forkDraft.name = `${this.selectedGraph.name || "Grafo semantico"} · copia`;
      this.view = "fork";
      this.error = null;
      this.render();
      this.focusFirst();
      return;
    }
    if (target.closest("[data-back-graph-list]")) {
      this.view = "existing";
      this.error = null;
      this.render();
    }
  };

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-collection-graph-search]")) {
      event.preventDefault();
      this.query = String(new FormData(form).get("q") || "").trim();
      this.page = 1;
      void this.loadChoices();
      return;
    }
    if (form.matches("[data-new-collection-graph]")) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      this.newDraft = {
        name: String(data.get("name") || "").trim(),
        description: String(data.get("description") || "").trim(),
      };
      this.select({
        graphMode: "new",
        graphDisplayName: this.newDraft.name,
        graphDescription: this.newDraft.description || null,
        graph: {
          name: this.newDraft.name,
          description: this.newDraft.description || null,
          isNew: true,
        },
      });
      return;
    }
    if (form.matches("[data-fork-collection-graph]")) {
      event.preventDefault();
      if (!form.reportValidity() || !this.selectedGraph) return;
      const data = new FormData(form);
      this.forkDraft = {
        name: String(data.get("name") || "").trim(),
        description: String(data.get("description") || "").trim(),
      };
      this.select({
        graphMode: "fork",
        semanticGraphId: id(this.selectedGraph),
        graphDisplayName: this.forkDraft.name,
        graphDescription: this.forkDraft.description || null,
        graph: {
          name: this.forkDraft.name,
          description: this.forkDraft.description || null,
          sourceName: this.selectedGraph.name || "Grafo semantico",
          subjectCount: Number(this.selectedGraph.subjectCount || 0),
          relationCount: Number(this.selectedGraph.relationCount || 0),
        },
        sourceGraph: this.selectedGraph,
      });
    }
  };

  onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...this.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  renderHeader(title, description) {
    return `<header class="task-modal-header collection-graph-dialog-header"><div><span class="eyebrow">Struttura semantica</span><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><button type="button" class="button-secondary small" data-close-collection-graph-dialog aria-label="Chiudi">×</button></header>`;
  }

  renderNew() {
    return `${this.renderHeader("Crea un nuovo grafo", "Configura una nuova struttura semantica. Il grafo verrà creato soltanto insieme alla Raccolta.")}
      <form class="collection-graph-dialog-form" data-new-collection-graph>
        <label>Nome del grafo<input name="name" required maxlength="160" placeholder="Relazioni sul Rinascimento" value="${escapeHtml(this.newDraft.name)}"></label>
        <label>Descrizione<textarea name="description" rows="3" placeholder="Ambito e criterio semantico">${escapeHtml(this.newDraft.description)}</textarea></label>
        <div class="operations"><button type="button" class="button-secondary" data-close-collection-graph-dialog>Annulla</button><button type="submit">Usa questo nuovo grafo</button></div>
      </form>`;
  }

  renderGraphCard(graph) {
    const graphId = id(graph);
    const selected = graphId === id(this.selectedGraph);
    const coverage = graph.currentSpaceCoverage || null;
    const coverageText = coverage && Number(coverage.totalSubjectCount || 0)
      ? `Coverage nello spazio ${Number(coverage.coveredSubjectCount || 0)}/${Number(coverage.totalSubjectCount || 0)}`
      : null;
    return `<button type="button" class="collection-graph-choice-card" data-collection-graph-choice="${escapeHtml(graphId)}" aria-pressed="${selected}">
      <span class="collection-graph-choice-icon">${icon("link", { size: 18 })}</span>
      <span class="collection-graph-choice-copy"><strong>${escapeHtml(graph.name || "Grafo semantico")}</strong><small>${escapeHtml(graph.description || "Grafo semantico autonomo e riusabile")}</small><span>${Number(graph.subjectCount || 0)} soggetti · ${Number(graph.relationCount || 0)} relazioni · ${Number(graph.collectionUsageCount || 0)} raccolte</span>${coverageText ? `<span>${escapeHtml(coverageText)}</span>` : ""}</span>
      ${graph.usedInCurrentSpace ? `<span class="status">Già usato qui</span>` : `<span class="status">Compatibile</span>`}
    </button>`;
  }

  renderGraphGroup(title, graphs) {
    if (!graphs.length) return "";
    return `<section class="collection-graph-dialog-group"><span class="eyebrow">${escapeHtml(title)}</span><div class="collection-graph-choice-list">${graphs.map((graph) => this.renderGraphCard(graph)).join("")}</div></section>`;
  }

  renderExisting() {
    const results = this.choices?.results || [];
    const inSpace = results.filter((graph) => graph.usedInCurrentSpace);
    const other = results.filter((graph) => !graph.usedInCurrentSpace);
    const pagination = this.choices?.pagination || { page: this.page, totalPages: 0 };
    return `${this.renderHeader("Usa un grafo esistente", "Scegli una struttura compatibile con le Regole editoriali della Raccolta.")}
      <form class="collection-graph-search" data-collection-graph-search role="search"><label>Cerca<input name="q" type="search" value="${escapeHtml(this.query)}" placeholder="Nome o descrizione"></label><button type="submit" class="button-secondary" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>
      ${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}
      ${this.busy && !this.choices ? `<artaround-progress-state>Caricamento grafi compatibili…</artaround-progress-state>` : results.length
        ? `<div class="collection-graph-dialog-results">${this.renderGraphGroup("Già usati in questo spazio", inSpace)}${this.renderGraphGroup("Altri grafi compatibili", other)}</div>`
        : `<artaround-empty-state><h3>Nessun grafo compatibile</h3><p>${this.query ? "Prova con un'altra ricerca." : "Non ci sono ancora grafi compatibili con queste Regole editoriali."}</p></artaround-empty-state>`}
      ${Number(pagination.totalPages || 0) > 1 ? `<nav class="pagination" aria-label="Pagine dei grafi"><button type="button" class="button-secondary" data-collection-graph-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)} di ${Number(pagination.totalPages || 1)}</span><button type="button" class="button-secondary" data-collection-graph-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.busy ? "disabled" : ""}>Successiva →</button></nav>` : ""}
      ${this.selectedGraph ? `<footer class="collection-graph-dialog-selection"><div><strong>${escapeHtml(this.selectedGraph.name || "Grafo semantico")}</strong><span>${Number(this.selectedGraph.subjectCount || 0)} soggetti · ${Number(this.selectedGraph.relationCount || 0)} relazioni</span></div><div class="operations"><button type="button" class="button-secondary" data-start-graph-fork>${icon("copy", { size: 15 })} Crea una copia indipendente</button><button type="button" data-use-shared-graph>Usa questo grafo</button></div></footer>` : ""}`;
  }

  renderFork() {
    return `${this.renderHeader("Crea una copia indipendente", `La nuova lineage partirà da “${this.selectedGraph?.name || "Grafo semantico"}” e poi evolverà separatamente.`)}
      <form class="collection-graph-dialog-form" data-fork-collection-graph>
        <label>Nome della copia<input name="name" required maxlength="160" value="${escapeHtml(this.forkDraft.name)}"></label>
        <label>Descrizione<textarea name="description" rows="3" placeholder="Ambito e criterio semantico">${escapeHtml(this.forkDraft.description)}</textarea></label>
        <div class="operations"><button type="button" class="button-secondary" data-back-graph-list>← Torna ai grafi</button><button type="submit">Usa la copia indipendente</button></div>
      </form>`;
  }

  render() {
    const body = this.view === "fork" ? this.renderFork() : this.view === "existing" ? this.renderExisting() : this.renderNew();
    this.innerHTML = `<div class="context-task-modal-layer collection-graph-dialog-layer" data-collection-graph-backdrop role="presentation"><section class="context-task-modal context-task-modal--large collection-graph-dialog" role="dialog" aria-modal="true" aria-label="Configura grafo della Raccolta">${body}</section></div>`;
  }
}

if (!customElements.get("artaround-collection-graph-dialog")) {
  customElements.define("artaround-collection-graph-dialog", ArtAroundCollectionGraphDialog);
}
