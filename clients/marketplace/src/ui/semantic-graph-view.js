import { navigate } from "../application/router.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";
import "./semantic-graph-editor.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundSemanticGraphView extends HTMLElement {
  semanticGraphId = null;
  section = "graph";
  data = null;
  busy = false;
  error = null;
  dirty = false;

  connectedCallback() {
    const params = new URLSearchParams(window.location.search);
    this.semanticGraphId = params.get("semanticGraphId");
    this.section = ["graph", "settings"].includes(params.get("section")) ? params.get("section") : "graph";
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("input", this.onInput);
    this.addEventListener("semantic-graph-changed", this.onGraphChanged);
    void this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("semantic-graph-changed", this.onGraphChanged);
  }

  hasUnsavedChanges() { return this.dirty; }
  discardUnsavedChanges() { this.dirty = false; }

  onInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (target?.form?.matches("[data-graph-settings], [data-graph-fork]")) this.dirty = true;
  };

  onGraphChanged = () => { void this.load({ preserveSection: true }); };

  async load({ preserveSection = false } = {}) {
    if (!this.semanticGraphId) { this.error = "Grafo semantico non specificato"; this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.data = await editorialRepository.semanticGraphAuthoring(this.semanticGraphId);
      if (!preserveSection) this.dirty = false;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile aprire il grafo semantico";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  setSection(section) {
    if (!["graph", "settings"].includes(section)) return;
    this.section = section;
    const params = new URLSearchParams(window.location.search);
    params.set("semanticGraphId", this.semanticGraphId);
    params.set("section", section);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params.toString()}`);
    this.render();
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const tab = target?.closest("button[data-graph-section]");
    if (tab) { this.setSection(tab.dataset.graphSection); return; }
    const collection = target?.closest("button[data-open-graph-collection]");
    if (collection) {
      navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(collection.dataset.openGraphCollection)}`);
      return;
    }
    if (target?.closest("button[data-trash-graph]")) await this.trashGraph();
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-graph-settings]")) {
      event.preventDefault();
      const data = new FormData(form);
      await this.run(async () => {
        await editorialRepository.updateSemanticGraph(this.semanticGraphId, {
          displayName: String(data.get("displayName") || "").trim(),
          description: String(data.get("description") || "").trim() || null,
        });
        this.dirty = false;
      });
      return;
    }
    if (form.matches("[data-graph-fork]")) {
      event.preventDefault();
      const data = new FormData(form);
      const displayName = String(data.get("displayName") || "").trim();
      if (!displayName) return;
      await this.run(async () => {
        const created = await editorialRepository.forkSemanticGraph(this.semanticGraphId, {
          displayName,
          description: String(data.get("description") || "").trim() || null,
        });
        const createdId = id(created?.graph);
        if (!createdId) throw new Error("La copia è stata creata ma non è stato restituito il suo identificatore");
        this.dirty = false;
        navigate(`/workspace/semantic-graph?semanticGraphId=${encodeURIComponent(createdId)}`);
      }, { reload: false });
    }
  };

  async run(operation, { reload = true } = {}) {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await operation();
      if (reload) await this.load({ preserveSection: true });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione sul grafo non completata";
      this.busy = false;
      this.render();
    }
  }

  async trashGraph() {
    if (!this.data?.permissions?.canEdit) return;
    const usage = Number(this.data?.graph?.collectionUsageCount || 0);
    const confirmed = await openActionDialog({
      title: `Eliminare il grafo “${this.data.graph.name}”?`,
      message: usage
        ? `Il grafo è ancora usato da ${usage} ${usage === 1 ? "raccolta" : "raccolte"}. Rimuovi prima i riferimenti attivi.`
        : "Il grafo non verrà più mostrato tra le risorse attive. Le revisioni già congelate in review o release restano storicamente valide.",
      confirmLabel: usage ? "Chiudi" : "Elimina grafo",
      tone: usage ? "neutral" : "danger",
    });
    if (!confirmed || usage) return;
    await this.run(async () => {
      await editorialRepository.removeSemanticGraph(this.semanticGraphId);
      this.dirty = false;
      navigate("/workspace");
    }, { reload: false });
  }

  renderTabs() {
    return `<nav class="context-workspace-tabs" aria-label="Sezioni del grafo"><button type="button" data-graph-section="graph" aria-current="${this.section === "graph" ? "page" : "false"}">Collegamenti</button><button type="button" data-graph-section="settings" aria-current="${this.section === "settings" ? "page" : "false"}">Impostazioni</button></nav>`;
  }

  renderGraph() {
    const graph = this.data.graph;
    const usages = this.data.usages || [];
    return `<section class="studio-section"><header class="section-heading"><div><span class="eyebrow">Grafo semantico autonomo</span><h2>Subject e relazioni</h2><p>Il grafo descrive conoscenza semantica indipendentemente dai contenuti e dagli spazi editoriali. Le raccolte che lo condividono usano la stessa working lineage.</p></div><div class="stats"><span><strong>${Number(graph.subjectCount || 0)}</strong> soggetti</span><span><strong>${Number(graph.relationCount || 0)}</strong> relazioni</span></div></header><artaround-semantic-graph-editor></artaround-semantic-graph-editor>${usages.length ? `<article class="panel"><span class="eyebrow">Utilizzi attivi</span><h3>${usages.length} ${usages.length === 1 ? "raccolta usa" : "raccolte usano"} questo grafo</h3><div class="semantic-inventory-list">${usages.map((usage) => `<button type="button" class="semantic-inventory-card" data-open-graph-collection="${escapeHtml(id(usage.editorialContextId))}"><span><strong>${escapeHtml(usage.collectionName || "Raccolta")}</strong><small>${escapeHtml(usage.contentSpaceName || "Spazio editoriale")}</small></span><span class="status">working v${Number(usage.workingVersion || 0)}</span></button>`).join("")}</div></article>` : `<div class="empty-state compact"><h3>Nessuna raccolta lo usa ancora</h3><p>Il grafo resta comunque una risorsa valida e modificabile. Potrà essere scelto da una raccolta compatibile in seguito.</p></div>`}</section>`;
  }

  renderSettings() {
    const graph = this.data.graph;
    const editable = this.data.permissions?.canEdit === true;
    const usages = Number(graph.collectionUsageCount || 0);
    return `<section class="studio-section studio-settings-grid"><form class="panel" data-graph-settings><span class="eyebrow">Identità del grafo</span><h2>Dettagli</h2><label>Nome<input name="displayName" required maxlength="160" value="${escapeHtml(graph.name || "")}" ${editable ? "" : "disabled"}></label><label>Descrizione<textarea name="description" rows="5" ${editable ? "" : "disabled"}>${escapeHtml(graph.description || "")}</textarea></label><label>Regole editoriali<input value="${escapeHtml(this.data.namespace?.name || "")}" disabled><span class="note">Il Namespace è parte della compatibilità del grafo e non può essere sostituito.</span></label><label>Revisione semantica<input value="v${Number(this.data.workingRevision?.version || 0)} · regole v${Number(this.data.namespaceRevision?.version || 0)}" disabled></label>${editable ? `<button type="submit">Salva modifiche</button>` : `<p class="note">Non disponi del permesso per modificare questo grafo.</p>`}</form><form class="panel" data-graph-fork><span class="eyebrow">Copia indipendente</span><h2>Crea una nuova lineage</h2><p>Copia Subject, classificazioni e relazioni della working revision corrente. Nessun Item o ContentSpace viene copiato.</p><label>Nome della copia<input name="displayName" required maxlength="160" value="${escapeHtml(`${graph.name || "Grafo"} · copia`)}" ${editable ? "" : "disabled"}></label><label>Descrizione<textarea name="description" rows="3" ${editable ? "" : "disabled"}>${escapeHtml(graph.description || "")}</textarea></label>${editable ? `<button type="submit" class="button-secondary">${icon("copy", { size: 15 })} Crea copia indipendente</button>` : ""}</form><article class="panel studio-danger-zone"><span class="eyebrow">Zona pericolosa</span><h2>Elimina grafo</h2><p>${usages ? `Questo grafo è usato da ${usages} ${usages === 1 ? "raccolta attiva" : "raccolte attive"} e non può essere eliminato finché resta referenziato.` : "L'eliminazione riguarda la risorsa attiva. Le revisioni già congelate restano disponibili allo storico delle raccolte."}</p>${editable ? `<button type="button" class="button-secondary danger" data-trash-graph ${usages ? "disabled" : ""}>${icon("trash", { size: 15 })} Elimina grafo</button>` : ""}</article></section>`;
  }

  configureEditor() {
    const editor = this.querySelector("artaround-semantic-graph-editor");
    if (!editor || !this.data) return;
    editor.configure({
      semanticGraphId: this.semanticGraphId,
      relationTypes: this.data.namespaceRevision?.relationTypes || [],
      subjectClasses: this.data.namespaceRevision?.subjectClasses || [],
      editable: this.data.permissions?.canEdit === true,
      locked: false,
    });
  }

  render() {
    if (this.busy && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Apertura del grafo semantico…</p></div></main>`; return; }
    if (this.error && !this.data) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Grafo semantico</h1><p role="alert">${escapeHtml(this.error)}</p><a data-route href="/workspace">Torna alla Libreria</a></div></main>`; return; }
    if (!this.data) return;
    const graph = this.data.graph;
    const section = this.section === "settings" ? this.renderSettings() : this.renderGraph();
    this.innerHTML = `<main class="page context-workspace-page" aria-busy="${this.busy}"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">Libreria</a><span aria-hidden="true">/</span><span>Grafi semantici</span><span aria-hidden="true">/</span><span>${escapeHtml(graph.name)}</span></nav><header class="context-workspace-bar"><div><span class="eyebrow">Grafo semantico</span><h1>${escapeHtml(graph.name)}</h1><p>${escapeHtml(graph.description || "Struttura semantica autonoma e riusabile tra raccolte compatibili.")}</p><p class="note">Regole editoriali: <strong>${escapeHtml(this.data.namespace?.name || "")}</strong> · revisione v${Number(this.data.namespaceRevision?.version || 0)}</p></div><div class="context-workspace-status"><span class="status">${Number(graph.subjectCount || 0)} soggetti</span><span class="status">${Number(graph.relationCount || 0)} relazioni</span><span class="status">${Number(graph.collectionUsageCount || 0)} raccolte · ${Number(graph.contentSpaceUsageCount || 0)} spazi</span></div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderTabs()}<div class="context-workspace-content">${section}</div></main>`;
    queueMicrotask(() => this.configureEditor());
  }
}

customElements.define("artaround-semantic-graph-view", ArtAroundSemanticGraphView);
