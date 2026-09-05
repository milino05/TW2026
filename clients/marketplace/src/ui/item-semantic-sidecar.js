import { currentRoute, navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";
import "./semantic-graph-editor.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function id(value) { return String(value?.id || value?._id || value || ""); }
function itemParams() { return new URLSearchParams(window.location.search); }

export class ArtAroundItemSemanticSidecar extends HTMLElement {
  context = readOperatingContext();
  open = false;
  busy = false;
  error = null;
  itemId = null;
  subject = null;
  editorialContextId = null;
  studio = null;
  graphProjection = null;
  subjectInGraph = false;
  choices = null;
  query = "";
  page = 1;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    window.addEventListener("popstate", this.onRouteChanged);
    window.addEventListener("keydown", this.onWindowKeyDown);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    window.removeEventListener("popstate", this.onRouteChanged);
    window.removeEventListener("keydown", this.onWindowKeyDown);
  }

  onRouteChanged = () => {
    this.context = readOperatingContext();
    if (!this.isItemRoute()) this.reset();
    this.render();
  };

  onWindowKeyDown = (event) => {
    if (event.key !== "Escape" || !this.open || event.defaultPrevented) return;
    this.close();
  };

  isItemRoute() { return currentRoute() === "/workspace/item-authoring"; }
  currentItemId() { return String(itemParams().get("itemId") || ""); }
  contextualCollectionId() { return String(itemParams().get("editorialContextId") || ""); }

  reset() {
    this.open = false;
    this.busy = false;
    this.error = null;
    this.itemId = null;
    this.subject = null;
    this.editorialContextId = null;
    this.studio = null;
    this.graphProjection = null;
    this.subjectInGraph = false;
    this.choices = null;
    this.query = "";
    this.page = 1;
  }

  close() {
    this.open = false;
    this.error = null;
    this.studio = null;
    this.graphProjection = null;
    this.subjectInGraph = false;
    this.editorialContextId = null;
    this.render();
  }

  async openSidecar() {
    this.open = true;
    this.busy = true;
    this.error = null;
    this.itemId = this.currentItemId();
    this.subject = null;
    this.studio = null;
    this.graphProjection = null;
    this.subjectInGraph = false;
    this.choices = null;
    this.query = "";
    this.page = 1;
    this.render();
    if (!this.itemId) {
      this.busy = false;
      this.error = "Conferma prima il Subject del contenuto. Appena l’Item esiste potrai aprire i suoi collegamenti senza lasciare l’editor.";
      this.render();
      return;
    }
    try {
      const projection = await authoringRepository.projection(this.itemId);
      this.subject = projection?.subject || null;
      if (!id(this.subject)) throw new Error("Il Subject del contenuto non è disponibile");
      const contextualCollectionId = this.contextualCollectionId();
      if (contextualCollectionId) {
        await this.openGraph(contextualCollectionId);
        return;
      }
      await this.loadChoices({ autoOpenSingle: true });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile aprire i collegamenti";
      this.busy = false;
      this.render();
    }
  }

  async loadChoices({ autoOpenSingle = false } = {}) {
    const principal = operatingPrincipal(this.context);
    if (!principal) throw new Error("Area di lavoro non selezionata");
    this.busy = true;
    this.error = null;
    this.studio = null;
    this.graphProjection = null;
    this.subjectInGraph = false;
    this.editorialContextId = null;
    this.render();
    try {
      this.choices = await editorialRepository.relationChoices({
        ownerType: this.context.type,
        ownerId: this.context.id,
        q: this.query,
        page: this.page,
        limit: 8,
      });
      const results = this.choices?.results || [];
      if (autoOpenSingle && Number(this.choices?.pagination?.total || 0) === 1 && results[0]?.id) {
        await this.openGraph(id(results[0].id));
        return;
      }
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async focusedGraphProjection(editorialContextId) {
    try {
      return await editorialRepository.graphNeighborhood(editorialContextId, {
        view: "working",
        focusSubjectId: id(this.subject),
        limit: 1,
      });
    } catch (error) {
      if (error?.status === 404 && error?.code === "GRAPH_SUBJECT_NOT_FOUND") return null;
      throw error;
    }
  }

  async openGraph(editorialContextId) {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const [studio, graphProjection] = await Promise.all([
        editorialRepository.studio(editorialContextId),
        this.focusedGraphProjection(editorialContextId),
      ]);
      if (!studio?.permissions?.canEditGraph) throw new Error("Il tuo ruolo non consente di modificare i collegamenti di questa raccolta.");
      this.editorialContextId = editorialContextId;
      this.studio = studio;
      this.graphProjection = graphProjection;
      this.subjectInGraph = Boolean(graphProjection);
      this.choices = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile aprire il grafo semantico";
      this.studio = null;
      this.graphProjection = null;
      this.subjectInGraph = false;
      this.editorialContextId = null;
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async addSubjectToGraph() {
    if (!this.editorialContextId || !id(this.subject) || this.subjectInGraph) return;
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await editorialRepository.addGraphSubject(this.editorialContextId, id(this.subject));
      const graphProjection = await this.focusedGraphProjection(this.editorialContextId);
      this.graphProjection = graphProjection;
      this.subjectInGraph = Boolean(graphProjection);
      if (!this.subjectInGraph) throw new Error("Il Subject non risulta ancora presente nel grafo");
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è stato possibile aggiungere il Subject al grafo";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-sidecar-collection-search]")) return;
    event.preventDefault();
    this.query = String(new FormData(form).get("q") || "").trim();
    this.page = 1;
    void this.loadChoices();
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-open-item-semantic-sidecar]")) { void this.openSidecar(); return; }
    if (target.closest("[data-close-item-semantic-sidecar]")) { this.close(); return; }
    if (target.closest("[data-add-sidecar-subject]")) { void this.addSubjectToGraph(); return; }
    if (target.closest("[data-change-sidecar-context]")) { this.query = ""; this.page = 1; this.choices = null; void this.loadChoices(); return; }
    if (target.closest("[data-open-editorial-spaces]")) { this.close(); navigate("/workspace/editorial-spaces"); return; }
    if (target.closest("[data-open-relation-hub]")) { this.close(); navigate("/create?mode=relations"); return; }
    const collection = target.closest("[data-sidecar-editorial-context]");
    if (collection) { void this.openGraph(collection.dataset.sidecarEditorialContext); return; }
    const page = target.closest("[data-sidecar-page]");
    if (page) {
      this.page = Math.max(1, Number(page.dataset.sidecarPage) || 1);
      void this.loadChoices();
    }
  };

  renderLauncher() {
    if (!this.isItemRoute()) return "";
    return `<button type="button" class="workspace-sidecar-launcher" data-open-item-semantic-sidecar aria-haspopup="true">${icon("link", { size: 16 })} Aggiungi collegamenti</button>`;
  }

  renderChoice(choice) {
    const graph = choice.semanticGraph || {};
    const shared = Number(graph.sharedByCollections || 1);
    return `<button type="button" class="workspace-sidecar-choice" data-sidecar-editorial-context="${escapeHtml(id(choice.id))}"><span class="workspace-sidecar-choice__icon">${icon("link", { size: 18 })}</span><span class="workspace-sidecar-choice__copy"><strong>${escapeHtml(choice.name || "Raccolta editoriale")}</strong><small>${escapeHtml(choice.contentSpace?.name || "Spazio editoriale")} · ${escapeHtml(choice.namespace?.name || "Regole editoriali")}</small><span>${Number(choice.itemCount || 0)} contenuti · ${Number(choice.relationCount || 0)} relazioni${shared > 1 ? ` · grafo condiviso da ${shared} raccolte` : ""}</span></span>${icon("chevron", { size: 15 })}</button>`;
  }

  renderChooser() {
    const results = this.choices?.results || [];
    const pagination = this.choices?.pagination || { page: this.page, total: 0, totalPages: 0 };
    return `<section class="workspace-sidecar__chooser"><div><span class="eyebrow">Grafo semantico</span><h2>Scegli dove lavorare</h2><p>Scegli la raccolta che fornisce il contesto semantico per <strong>${escapeHtml(this.subject?.preferredLabel || "il Subject del contenuto")}</strong>. La sola apertura non modifica il grafo.</p></div><form class="inline-form" data-sidecar-collection-search role="search"><label>Cerca raccolta<input name="q" value="${escapeHtml(this.query)}" placeholder="Nome o descrizione"></label><button type="submit" class="button-secondary" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${results.length ? `<div class="workspace-sidecar-choice-list">${results.map((choice) => this.renderChoice(choice)).join("")}</div>` : this.busy ? `<div class="empty-state compact"><p>Ricerca delle raccolte…</p></div>` : `<div class="empty-state compact"><h3>Nessuna raccolta modificabile</h3><p>${this.query ? "Nessuna raccolta corrisponde alla ricerca." : "Per aggiungere collegamenti serve una raccolta il cui grafo sia modificabile nella tua area di lavoro."}</p><div class="button-row"><button type="button" class="button-secondary" data-open-editorial-spaces>Apri gli spazi editoriali</button><button type="button" class="button-secondary" data-open-relation-hub>Collega soggetti</button></div></div>`}${Number(pagination.totalPages || 0) > 1 ? `<nav class="pagination" aria-label="Pagine delle raccolte"><button type="button" data-sidecar-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)} di ${Number(pagination.totalPages || 1)}</span><button type="button" data-sidecar-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.busy ? "disabled" : ""}>Successiva →</button></nav>` : ""}</section>`;
  }

  renderMembershipPrompt() {
    const graph = this.studio?.semanticGraph || {};
    const shared = Number(graph.sharedByCollections || 1);
    return `<section class="workspace-sidecar__chooser"><div><span class="eyebrow">Relazioni · ${escapeHtml(this.studio?.context?.name || "Raccolta")}</span><h2>${escapeHtml(this.subject?.preferredLabel || "Subject")}</h2><p>Questo Subject non appartiene ancora al grafo <strong>${escapeHtml(graph.name || "semantico")}</strong>. Aggiungerlo crea solo la membership semantica: non aggiunge contenuti alla raccolta e non modifica la presenza fisica.</p>${shared > 1 ? `<artaround-callout tone="info">Il grafo è condiviso da ${shared} raccolte: il nuovo Subject sarà disponibile semanticamente in tutte quelle che usano la sua bozza corrente.</artaround-callout>` : ""}</div><div class="button-row"><button type="button" data-add-sidecar-subject ${this.busy ? "disabled" : ""}>${icon("plus", { size: 15 })} Aggiungi al grafo e usa come contesto</button>${this.contextualCollectionId() ? "" : `<button type="button" class="button-secondary" data-change-sidecar-context>Scegli un'altra raccolta</button>`}</div></section>`;
  }

  renderGraph() {
    const graph = this.studio?.semanticGraph || {};
    const shared = Number(graph.sharedByCollections || 1);
    return `<section class="workspace-sidecar__graph"><header class="workspace-sidecar__context"><div><span class="eyebrow">Relazioni · ${escapeHtml(this.studio?.context?.name || "Raccolta")}</span><h2>${escapeHtml(this.subject?.preferredLabel || "Collegamenti")}</h2><p>Grafo: <strong>${escapeHtml(graph.name || "Grafo semantico")}</strong>${shared > 1 ? ` · condiviso da ${shared} raccolte` : ""}</p></div>${this.contextualCollectionId() ? "" : `<button type="button" class="button-secondary small" data-change-sidecar-context>Scegli un altro contesto</button>`}</header><artaround-semantic-graph-editor></artaround-semantic-graph-editor></section>`;
  }

  configureGraph() {
    if (!this.studio || !this.editorialContextId || !this.subjectInGraph || !id(this.subject)) return;
    const graph = this.querySelector("artaround-semantic-graph-editor");
    if (!graph) return;
    graph.focusSubjectId = id(this.subject);
    graph.configure({
      editorialContextId: this.editorialContextId,
      relationTypes: this.studio.namespace?.revision?.relationTypes || [],
      subjectClasses: this.studio.namespace?.revision?.subjectClasses || [],
      editable: this.studio.permissions?.canEditGraph === true,
      locked: false,
    });
  }

  render() {
    if (!this.isItemRoute()) { this.innerHTML = ""; return; }
    if (!this.open) { this.innerHTML = this.renderLauncher(); return; }
    const body = this.studio
      ? (this.subjectInGraph ? this.renderGraph() : this.renderMembershipPrompt())
      : this.subject && this.choices
        ? this.renderChooser()
        : this.error
          ? `<div class="empty-state"><h2>Collegamenti non disponibili</h2><p>${escapeHtml(this.error)}</p>${!this.currentItemId() ? "" : `<button type="button" class="button-secondary" data-open-relation-hub>Apri Collega soggetti</button>`}</div>`
          : `<div class="empty-state"><p>${this.busy ? "Preparazione del grafo…" : "Preparazione…"}</p></div>`;
    this.innerHTML = `${this.renderLauncher()}<div class="workspace-sidecar-layer"><aside class="workspace-sidecar" aria-label="Collegamenti semantici del contenuto"><header class="workspace-sidecar__header"><div><span class="eyebrow">Contenuto · Semantica</span><strong>Aggiungi collegamenti</strong></div><button type="button" class="button-secondary small" data-close-item-semantic-sidecar aria-label="Chiudi collegamenti">×</button></header>${this.error && this.subject ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<div class="workspace-sidecar__body">${body}</div></aside></div>`;
    if (this.studio && this.subjectInGraph) queueMicrotask(() => this.configureGraph());
  }
}

if (!customElements.get("artaround-item-semantic-sidecar")) {
  customElements.define("artaround-item-semantic-sidecar", ArtAroundItemSemanticSidecar);
}

if (!document.querySelector("artaround-item-semantic-sidecar")) {
  document.body.append(document.createElement("artaround-item-semantic-sidecar"));
}
