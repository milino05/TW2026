import { currentRoute, navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";
import { createTaskDialog } from "./task-dialog.js";

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
function safeReturnTo() {
  const value = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return value.startsWith("/") && !value.startsWith("//") ? value : "/workspace";
}
function isMissingGraphSubject(error) {
  return error?.status === 404
    && (error?.code === "GRAPH_SUBJECT_NOT_FOUND"
      || error?.details?.some?.((entry) => entry?.code === "GRAPH_SUBJECT_NOT_FOUND"));
}

export class ArtAroundItemSemanticRelationsLauncher extends HTMLElement {
  context = readOperatingContext();
  dialog = null;
  busy = false;
  error = null;
  itemId = null;
  subject = null;
  editorialContextId = null;
  studio = null;
  choices = null;
  query = "";
  page = 1;
  state = "choose";

  connectedCallback() {
    this.addEventListener("click", this.onHostClick);
    window.addEventListener("popstate", this.onRouteChanged);
    this.render();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onHostClick);
    window.removeEventListener("popstate", this.onRouteChanged);
    this.dialog?.close({ restoreFocus: false, notify: false });
    this.dialog = null;
  }

  onRouteChanged = () => {
    this.context = readOperatingContext();
    if (!this.isItemRoute()) this.closeDialog();
    this.render();
  };

  isItemRoute() { return currentRoute() === "/workspace/item-authoring"; }
  currentItemId() { return String(itemParams().get("itemId") || ""); }
  contextualCollectionId() { return String(itemParams().get("editorialContextId") || ""); }

  reset() {
    this.busy = false;
    this.error = null;
    this.itemId = null;
    this.subject = null;
    this.editorialContextId = null;
    this.studio = null;
    this.choices = null;
    this.query = "";
    this.page = 1;
    this.state = "choose";
  }

  closeDialog() {
    this.dialog?.close({ notify: false });
    this.dialog = null;
    this.reset();
  }

  onHostClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-open-item-relations]")) void this.openRelations();
  };

  ensureDialog() {
    if (this.dialog) return;
    this.dialog = createTaskDialog({
      eyebrow: "Contenuto · Semantica",
      title: "Aggiungi collegamenti",
      description: "Scegli il contesto editoriale e poi continua nel workspace completo del grafo.",
      size: "large",
      initialFocus: "input[name='q']",
      renderBody: () => this.renderDialogBody(),
      renderFooter: () => this.renderDialogFooter(),
      isBusy: () => this.busy,
      isDirty: () => false,
      onDismiss: () => { this.dialog = null; this.reset(); },
      onClick: this.onDialogClick,
      onSubmit: this.onDialogSubmit,
    });
  }

  async openRelations() {
    if (this.dialog) return;
    this.reset();
    this.itemId = this.currentItemId();
    this.ensureDialog();
    if (!this.itemId) {
      this.error = "Conferma prima il Subject del contenuto. Appena l’Item esiste potrai aprire i suoi collegamenti.";
      this.state = "error";
      this.dialog?.render();
      return;
    }
    this.busy = true;
    this.dialog?.render();
    try {
      const projection = await authoringRepository.projection(this.itemId);
      this.subject = projection?.subject || null;
      if (!id(this.subject)) throw new Error("Il Subject del contenuto non è disponibile");
      const contextualCollectionId = this.contextualCollectionId();
      if (contextualCollectionId) {
        await this.prepareCollection(contextualCollectionId);
        return;
      }
      await this.loadChoices({ autoPrepareSingle: true });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile preparare i collegamenti";
      this.state = "error";
      this.busy = false;
      this.dialog?.render();
    }
  }

  async loadChoices({ autoPrepareSingle = false } = {}) {
    const principal = operatingPrincipal(this.context);
    if (!principal) throw new Error("Area di lavoro non selezionata");
    const subjectId = id(this.subject);
    if (!subjectId) throw new Error("Il Subject del contenuto non è disponibile");
    this.busy = true;
    this.error = null;
    this.state = "choose";
    this.dialog?.render();
    try {
      this.choices = await editorialRepository.relationChoices({
        ownerType: this.context.type,
        ownerId: this.context.id,
        subjectId,
        q: this.query,
        page: this.page,
        limit: 8,
      });
      const results = this.choices?.results || [];
      if (autoPrepareSingle && Number(this.choices?.pagination?.total || 0) === 1 && results[0]?.id) {
        await this.prepareCollection(id(results[0].id));
        return;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare le Raccolte";
    } finally {
      this.busy = false;
      this.dialog?.render();
      this.dialog?.focus("input[name='q']");
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
      if (isMissingGraphSubject(error)) {
        throw new Error("Questa Raccolta non contiene un contenuto che rappresenta il Subject dell’Item.");
      }
      throw error;
    }
  }

  async prepareCollection(editorialContextId) {
    this.busy = true;
    this.error = null;
    this.editorialContextId = editorialContextId;
    this.state = "preparing";
    this.dialog?.render();
    try {
      const [studio, projection] = await Promise.all([
        editorialRepository.studio(editorialContextId),
        this.focusedGraphProjection(editorialContextId),
      ]);
      if (!studio?.permissions?.canEditGraph) throw new Error("Il tuo ruolo non consente di modificare i collegamenti di questa Raccolta.");
      if (!id(studio?.semanticGraph)) throw new Error("La Raccolta non dispone di un grafo semantico modificabile.");
      if (!projection?.subjects?.some((entry) => id(entry?.subject) === id(this.subject))) {
        throw new Error("Il Subject dell’Item non è disponibile nel contesto semantico della Raccolta.");
      }
      this.studio = studio;
      this.openGraphWorkspace();
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile aprire il grafo semantico";
      this.state = "error";
    } finally {
      this.busy = false;
      this.dialog?.render();
    }
  }

  persistItemDraft() {
    const editor = document.querySelector("artaround-item-authoring-view");
    editor?.persistWorkingDraft?.();
  }

  openGraphWorkspace() {
    const semanticGraphId = id(this.studio?.semanticGraph);
    if (!semanticGraphId || !this.editorialContextId || !id(this.subject)) return;
    this.persistItemDraft();
    const query = new URLSearchParams({
      semanticGraphId,
      editorialContextId: this.editorialContextId,
      focusSubjectId: id(this.subject),
      returnTo: safeReturnTo(),
    });
    this.dialog?.close({ restoreFocus: false, notify: false });
    this.dialog = null;
    navigate(`/workspace/semantic-graph?${query.toString()}`);
  }

  onDialogSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-relation-collection-search]")) return;
    event.preventDefault();
    this.query = String(new FormData(form).get("q") || "").trim();
    this.page = 1;
    void this.loadChoices();
  };

  onDialogClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const collection = target.closest("[data-relation-editorial-context]");
    if (collection) { void this.prepareCollection(collection.dataset.relationEditorialContext); return; }
    const page = target.closest("[data-relation-page]");
    if (page) {
      this.page = Math.max(1, Number(page.dataset.relationPage) || 1);
      void this.loadChoices();
    }
  };

  renderChoice(choice) {
    return `<button type="button" class="task-resource-choice" data-relation-editorial-context="${escapeHtml(id(choice.id))}"><span class="resource-mark">${icon("link", { size: 18 })}</span><span><strong>${escapeHtml(choice.name || "Raccolta editoriale")}</strong><small>${escapeHtml(choice.contentSpace?.name || "Spazio editoriale")} · ${escapeHtml(choice.namespace?.name || "Regole editoriali")}</small><span>${Number(choice.itemCount || 0)} contenuti · ${Number(choice.relationCount || 0)} relazioni</span></span>${icon("chevron", { size: 15 })}</button>`;
  }

  renderChooser() {
    const results = this.choices?.results || [];
    const pagination = this.choices?.pagination || { page: this.page, total: 0, totalPages: 0 };
    const emptyCopy = this.query
      ? "Nessuna Raccolta eleggibile corrisponde alla ricerca."
      : `Nessuna Raccolta modificabile contiene un contenuto che rappresenta ${this.subject?.preferredLabel || "questo Subject"}.`;
    return `<div class="task-selection-layout"><div><span class="eyebrow">Grafo della Raccolta</span><h3>Scegli dove lavorare</h3><p>Sono mostrate soltanto le Raccolte modificabili che contengono almeno un contenuto per <strong>${escapeHtml(this.subject?.preferredLabel || "il Subject del contenuto")}</strong>.</p></div><form class="inline-form" data-relation-collection-search role="search"><label>Cerca raccolta<input name="q" value="${escapeHtml(this.query)}" placeholder="Nome o descrizione"></label><button type="submit" class="button-secondary" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form>${this.error ? `<artaround-callout tone="danger" role="alert">${escapeHtml(this.error)}</artaround-callout>` : ""}${results.length ? `<div class="task-resource-choice-list">${results.map((choice) => this.renderChoice(choice)).join("")}</div>` : this.busy ? `<artaround-progress-state>Ricerca delle Raccolte…</artaround-progress-state>` : `<div class="empty-state compact"><h3>Nessuna Raccolta disponibile</h3><p>${escapeHtml(emptyCopy)}</p></div>`}${Number(pagination.totalPages || 0) > 1 ? `<nav class="pagination" aria-label="Pagine delle Raccolte"><button type="button" data-relation-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)} di ${Number(pagination.totalPages || 1)}</span><button type="button" data-relation-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.busy ? "disabled" : ""}>Successiva →</button></nav>` : ""}</div>`;
  }

  renderDialogBody() {
    if (this.state === "error") return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h3>Collegamenti non disponibili</h3><p>${escapeHtml(this.error || "Non è possibile continuare.")}</p></div>`;
    if (this.state === "preparing" || (this.busy && !this.subject)) return `<artaround-progress-state>Preparazione del contesto semantico…</artaround-progress-state>`;
    return this.renderChooser();
  }

  renderDialogFooter() {
    return `<button type="button" class="button-secondary" data-modal-dismiss>Annulla</button>`;
  }

  render() {
    if (!this.isItemRoute()) { this.innerHTML = ""; return; }
    this.innerHTML = `<button type="button" class="button-secondary" data-open-item-relations aria-haspopup="dialog">${icon("link", { size: 16 })} Aggiungi collegamenti</button>`;
  }
}

if (!customElements.get("artaround-item-semantic-relations-launcher")) {
  customElements.define("artaround-item-semantic-relations-launcher", ArtAroundItemSemanticRelationsLauncher);
}

if (!document.querySelector("artaround-item-semantic-relations-launcher")) {
  document.body.append(document.createElement("artaround-item-semantic-relations-launcher"));
}
