import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import {
  clearEditorialSpacePreference,
  resolveEditorialSpacePreference,
  setEditorialSpacePreference,
} from "../application/editorial-space-preference.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";
import { editorLabel, integrityLabel, resourceLabel, resourceStateLabel } from "./presentation.js";
import { openSpaceEditorDialog, openSpaceSelectionDialog } from "./workspace-space-dialogs.js";
import "./content-space-item-add-dialog.js";
import "./item-detail-dialog.js";

const CROSS_SPACE_TYPES = ["visit", "namespace", "semantic_graph", "physical_vocabulary"];
const RESOURCE_TYPES = [
  ["", "Tutte"],
  ["visit", "Visite"],
  ["namespace", "Regole editoriali"],
  ["semantic_graph", "Grafi semantici"],
  ["physical_vocabulary", "Vocabolari fisici"],
];

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function id(value) { return String(value?._id || value?.id || value || ""); }
function params() { return new URLSearchParams(window.location.search); }
function authoringHref(ref) {
  const type = String(ref?.resourceType || "");
  const resourceId = String(ref?.resourceId || "");
  if (!resourceId) return null;
  if (type === "visit") return `/workspace/visit-authoring?visitId=${encodeURIComponent(resourceId)}`;
  if (type === "namespace") return `/namespaces/editor?namespaceId=${encodeURIComponent(resourceId)}`;
  if (type === "semantic_graph") return `/workspace/semantic-graph?semanticGraphId=${encodeURIComponent(resourceId)}`;
  if (type === "physical_vocabulary") return `/physical-vocabularies/editor?physicalVocabularyId=${encodeURIComponent(resourceId)}`;
  return null;
}

export class ArtAroundWorkspaceBrowserView extends HTMLElement {
  context = readOperatingContext();
  section = params().get("section") === "resources" ? "resources" : "editorial";
  editorialSection = params().get("editorial") === "content" ? "content" : "collections";
  resourceQuery = params().get("q") || "";
  resourceType = CROSS_SPACE_TYPES.includes(params().get("resourceType")) ? params().get("resourceType") : "";
  resourcePage = Math.max(1, Number(params().get("page")) || 1);
  contentQuery = params().get("contentQ") || "";
  contentPage = Math.max(1, Number(params().get("contentPage")) || 1);
  removed = params().get("removed") || "";

  workspaceContext = null;
  spaces = [];
  currentSpace = null;
  spaceData = null;
  contentData = null;
  resources = null;
  busy = false;
  contentBusy = false;
  error = null;
  contentError = null;
  taskDialog = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("keydown", this.onKeyDown);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("library-item-added", this.onLibraryItemAdded);
    this.addEventListener("library-item-open", this.onLibraryItemOpen);
    this.addEventListener("library-item-detail-close", this.onLibraryItemDetailClose);
    void this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("keydown", this.onKeyDown);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("library-item-added", this.onLibraryItemAdded);
    this.removeEventListener("library-item-open", this.onLibraryItemOpen);
    this.removeEventListener("library-item-detail-close", this.onLibraryItemDetailClose);
    this.taskDialog?.close({ restoreFocus: false, notify: false });
    this.taskDialog = null;
  }

  principal() { return operatingPrincipal(this.context); }
  selectedPrincipal() { return this.workspaceContext?.principal || null; }
  canManageSpaces() {
    const principal = this.selectedPrincipal();
    if (!principal) return false;
    return principal.type === "user" || (principal.effectivePermissions || []).includes("editorial_space.manage");
  }

  async load() {
    const principal = this.principal();
    if (!principal) {
      this.error = "Area di lavoro non selezionata";
      this.render();
      return;
    }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.workspaceContext = await marketplaceRepository.workspaceContext(principal);
      if (this.section === "resources") {
        this.spaces = [];
        this.currentSpace = null;
        this.spaceData = null;
        this.contentData = null;
        await this.loadResources();
      } else {
        this.spaces = await editorialRepository.spaceSummaries({ ownerType: this.context.type, ownerId: this.context.id });
        this.currentSpace = resolveEditorialSpacePreference(principal, this.spaces);
        await this.loadEditorialSection();
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare la Libreria";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async loadEditorialSection() {
    this.spaceData = null;
    this.contentData = null;
    this.contentError = null;
    if (!this.currentSpace) return;
    this.spaceData = await editorialRepository.spaceProjection(id(this.currentSpace));
    if (this.editorialSection === "content") await this.loadContent();
  }

  async loadContent() {
    if (!this.currentSpace) return;
    this.contentBusy = true;
    this.contentError = null;
    this.render();
    try {
      this.contentData = await editorialRepository.listSpaceItems(id(this.currentSpace), {
        q: this.contentQuery,
        page: this.contentPage,
        limit: 18,
      });
    } catch (error) {
      this.contentError = error instanceof Error ? error.message : "Non è possibile caricare i contenuti dello spazio";
    } finally {
      this.contentBusy = false;
      this.render();
    }
  }

  async loadResources() {
    const principal = this.principal();
    if (!principal) return;
    this.resources = await marketplaceRepository.workspaceResources(principal, {
      ownership: "owned",
      q: this.resourceQuery,
      resourceTypes: this.resourceType ? [this.resourceType] : CROSS_SPACE_TYPES,
      page: this.resourcePage,
      limit: 12,
    });
    this.resourcePage = Math.max(1, Number(this.resources?.page) || this.resourcePage);
  }

  openSpaceChooser() {
    if (this.taskDialog || !this.spaces.length) return;
    this.taskDialog = openSpaceSelectionDialog({
      spaces: this.spaces,
      currentSpace: this.currentSpace,
      canCreate: this.canManageSpaces(),
      onDismiss: () => { this.taskDialog = null; },
      onChoose: (space) => {
        this.taskDialog = null;
        void this.chooseSpace(space);
      },
      onCreate: () => {
        this.taskDialog = null;
        this.openSpaceEditor("create");
      },
    });
  }

  openSpaceEditor(mode) {
    if (this.taskDialog || !this.canManageSpaces()) return;
    const creating = mode === "create";
    this.taskDialog = openSpaceEditorDialog({
      mode,
      initial: creating ? {} : {
        name: this.spaceData?.space?.name || this.currentSpace?.name || "",
        description: this.spaceData?.space?.description || this.currentSpace?.description || "",
      },
      stats: this.spaceData?.stats || {},
      canDelete: !creating,
      onDismiss: () => { this.taskDialog = null; },
      onSave: async ({ name, description }) => {
        if (creating) {
          const created = await editorialRepository.createSpace({
            name,
            description,
            ownerType: this.context.type,
            ownerId: this.context.id,
          });
          setEditorialSpacePreference(this.principal(), id(created));
        } else if (this.currentSpace) {
          await editorialRepository.updateSpace(id(this.currentSpace), { name, description });
        }
        this.taskDialog = null;
        await this.load();
      },
      onDelete: async () => {
        const removed = await this.removeCurrentSpace();
        if (removed) this.taskDialog = null;
        return removed;
      },
    });
  }

  async chooseSpace(chosen) {
    setEditorialSpacePreference(this.principal(), id(chosen));
    this.currentSpace = chosen;
    this.busy = true;
    this.render();
    try { await this.loadEditorialSection(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Non è possibile aprire lo spazio selezionato"; }
    finally { this.busy = false; this.render(); }
  }

  openItemAddDialog() {
    if (!this.currentSpace || this.querySelector("artaround-content-space-item-add-dialog")) return;
    const dialog = document.createElement("artaround-content-space-item-add-dialog");
    dialog.setAttribute("content-space-id", id(this.currentSpace));
    dialog.setAttribute("space-name", this.spaceData?.space?.name || this.currentSpace.name || "Spazio editoriale");
    dialog.setAttribute("owner-type", this.context.type || "user");
    dialog.setAttribute("owner-id", id(this.context.id));
    this.append(dialog);
  }

  openItemDetail(itemId) {
    if (!this.currentSpace || !itemId) return;
    this.querySelector("artaround-item-detail-dialog")?.remove();
    const dialog = document.createElement("artaround-item-detail-dialog");
    dialog.setAttribute("content-space-id", id(this.currentSpace));
    dialog.setAttribute("item-id", id(itemId));
    this.append(dialog);
  }

  onLibraryItemAdded = () => {
    this.spaceData = null;
    void this.loadEditorialSection();
  };
  onLibraryItemOpen = (event) => {
    const itemId = event.detail?.itemId;
    if (itemId) this.openItemDetail(itemId);
  };
  onLibraryItemDetailClose = () => {
    if (this.section === "editorial" && this.editorialSection === "content") void this.loadContent();
  };
  onKeyDown = (event) => {
    if (!["Enter", " "].includes(event.key)) return;
    const target = event.target instanceof Element ? event.target : null;
    const item = target?.closest('[data-open-item][role="button"]');
    if (!item) return;
    event.preventDefault();
    this.openItemDetail(item.dataset.openItem);
  };

  navigationUrl({ section = this.section, editorial = this.editorialSection, q = "", resourceType = "", page = 1, contentQ = "", contentPage = 1 } = {}) {
    const query = new URLSearchParams();
    if (section === "resources") {
      query.set("section", "resources");
      if (q) query.set("q", q);
      if (resourceType) query.set("resourceType", resourceType);
      if (page > 1) query.set("page", String(page));
    } else {
      if (editorial === "content") query.set("editorial", "content");
      if (editorial === "content" && contentQ) query.set("contentQ", contentQ);
      if (editorial === "content" && contentPage > 1) query.set("contentPage", String(contentPage));
    }
    return `/workspace${query.toString() ? `?${query.toString()}` : ""}`;
  }

  onSubmit = (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-resource-search]")) {
      event.preventDefault();
      const data = new FormData(form);
      navigate(this.navigationUrl({
        section: "resources",
        q: String(data.get("q") || "").trim(),
        resourceType: String(data.get("resourceType") || ""),
        page: 1,
      }));
      return;
    }
    if (form.matches("[data-content-search]")) {
      event.preventDefault();
      const data = new FormData(form);
      navigate(this.navigationUrl({
        section: "editorial",
        editorial: "content",
        contentQ: String(data.get("q") || "").trim(),
        contentPage: 1,
      }));
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const libraryTab = target.closest("button[data-library-tab]");
    if (libraryTab) {
      const tab = libraryTab.dataset.libraryTab;
      if (tab === "resources") navigate("/workspace?section=resources");
      else if (tab === "content") navigate(this.navigationUrl({ section: "editorial", editorial: "content" }));
      else navigate("/workspace");
      return;
    }
    if (target.closest("[data-change-space]")) { this.openSpaceChooser(); return; }
    if (target.closest("[data-space-settings]")) { this.openSpaceEditor("settings"); return; }
    if (target.closest("[data-new-space]")) { this.openSpaceEditor("create"); return; }

    const collection = target.closest("[data-collection-id]");
    if (collection) {
      navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(collection.dataset.collectionId)}`);
      return;
    }
    if (target.closest("[data-new-collection]") && this.currentSpace) {
      navigate(`/workspace/editorial-collection-new?contentSpaceId=${encodeURIComponent(id(this.currentSpace))}`);
      return;
    }
    if (target.closest("[data-new-content]") && this.currentSpace) {
      this.openItemAddDialog();
      return;
    }
    const item = target.closest("[data-open-item]");
    if (item) {
      this.openItemDetail(item.dataset.openItem);
      return;
    }
    const contentPage = target.closest("button[data-content-page]");
    if (contentPage) {
      navigate(this.navigationUrl({
        section: "editorial",
        editorial: "content",
        contentQ: this.contentQuery,
        contentPage: Math.max(1, Number(contentPage.dataset.contentPage) || 1),
      }));
      return;
    }

    const resourcePage = target.closest("button[data-resource-page]");
    if (resourcePage) {
      navigate(this.navigationUrl({
        section: "resources",
        q: this.resourceQuery,
        resourceType: this.resourceType,
        page: Math.max(1, Number(resourcePage.dataset.resourcePage) || 1),
      }));
      return;
    }
    const edit = target.closest("button[data-authoring-href]");
    if (edit) { navigate(edit.dataset.authoringHref); return; }
    const detail = target.closest("button[data-resource-detail]");
    if (detail) {
      const query = new URLSearchParams({
        resourceType: detail.dataset.resourceType,
        resourceId: detail.dataset.resourceId,
        ownership: "owned",
      });
      navigate(`/workspace/resource?${query.toString()}`);
    }
  };

  async removeCurrentSpace() {
    if (!this.currentSpace || !this.canManageSpaces()) return false;
    const collectionCount = Number(this.spaceData?.stats?.collectionCount || 0);
    if (collectionCount > 0) return false;
    const confirmed = await openActionDialog({
      title: `Eliminare lo spazio “${this.spaceData?.space?.name || this.currentSpace.name || "editoriale"}”?`,
      message: "Lo spazio verrà rimosso. Gli Item non vengono eliminati; l'operazione sarà bloccata se un contenuto posseduto resterebbe senza alcuno spazio editoriale attivo.",
      confirmLabel: "Elimina spazio",
      cancelLabel: "Annulla",
      tone: "danger",
    });
    if (!confirmed) return false;
    try {
      await editorialRepository.removeSpace(id(this.currentSpace));
      clearEditorialSpacePreference(this.principal(), { silent: true });
      await this.load();
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Eliminazione dello spazio non completata";
      this.render();
      return false;
    }
  }

  activeLibraryTab() {
    if (this.section === "resources") return "resources";
    return this.editorialSection === "content" ? "content" : "collections";
  }

  renderLibraryTabs() {
    const active = this.activeLibraryTab();
    return `<nav class="context-workspace-tabs library-tabs" aria-label="Sezioni della Libreria"><button type="button" data-library-tab="collections" aria-current="${active === "collections" ? "page" : "false"}">Raccolte</button><button type="button" data-library-tab="content" aria-current="${active === "content" ? "page" : "false"}">Contenuti</button><button type="button" data-library-tab="resources" aria-current="${active === "resources" ? "page" : "false"}">Risorse condivise</button></nav>`;
  }

  renderCurrentSpace() {
    if (!this.currentSpace || !this.spaceData) return "";
    const stats = this.spaceData.stats || {};
    return `<section class="panel library-current-space library-scope-panel"><div class="section-heading"><div><span class="eyebrow">Spazio editoriale</span><h2>${escapeHtml(this.spaceData.space.name)}</h2><p>${escapeHtml(this.spaceData.space.description || "Corpus editoriale condiviso da più raccolte.")}</p></div><div class="button-row"><button type="button" class="button-secondary" data-change-space>Cambia</button>${this.canManageSpaces() ? `<button type="button" class="button-secondary" data-space-settings>${icon("settings", { size: 15 })} Impostazioni</button>` : ""}</div></div><div class="stats"><span><strong>${Number(stats.collectionCount || 0)}</strong> raccolte</span><span><strong>${Number(stats.itemCount || 0)}</strong> contenuti</span><span><strong>${Number(stats.subjectCount || 0)}</strong> soggetti censiti</span></div></section>`;
  }

  renderEditorialScope() {
    if (this.currentSpace && this.spaceData) return this.renderCurrentSpace();
    if (!this.spaces.length) {
      return `<section class="panel library-current-space library-scope-panel"><div class="section-heading"><div><span class="eyebrow">Spazio editoriale</span><h2>Nessuno spazio editoriale</h2><p>Gli spazi organizzano raccolte e contenuti in corpus editoriali distinti.</p></div>${this.canManageSpaces() ? `<button type="button" data-new-space>${icon("plus", { size: 15 })} Crea spazio editoriale</button>` : ""}</div></section>`;
    }
    return `<section class="panel library-current-space library-scope-panel"><div class="section-heading"><div><span class="eyebrow">Spazio editoriale</span><h2>Nessuno spazio selezionato</h2><p>Scegli lo spazio in cui vuoi consultare raccolte e contenuti.</p></div><button type="button" class="button-secondary" data-change-space>Scegli spazio</button></div></section>`;
  }

  renderWorkAreaScope() {
    const areaName = this.context?.type === "organization"
      ? (this.context?.name || "Organizzazione")
      : (this.context?.name || "Area personale");
    return `<section class="panel library-current-space library-scope-panel library-work-area"><div class="section-heading"><div><span class="eyebrow">Area di lavoro</span><h2>${escapeHtml(areaName)}</h2><p>Risorse disponibili trasversalmente agli spazi editoriali di questa area di lavoro.</p></div></div></section>`;
  }

  renderLibraryScope() {
    return this.section === "resources" ? this.renderWorkAreaScope() : this.renderEditorialScope();
  }

  renderCollectionCard(collection) {
    const state = collection.reviewActive ? "In revisione" : collection.published ? "Pubblicata" : "Bozza di lavoro";
    return `<article class="asset owned"><header><span class="asset-icon">${icon("catalog", { size: 20 })}</span><div><p class="badge">Raccolta editoriale</p><h3>${escapeHtml(collection.name)}</h3></div><span class="status">${escapeHtml(state)}</span></header><div class="asset-copy"><p>${escapeHtml(collection.shortDescription || "Raccolta editoriale")}</p><p class="muted"><strong>Regole editoriali:</strong> ${escapeHtml(collection.namespace?.name || "Non disponibili")}</p><div class="stats"><span><strong>${Number(collection.itemCount || 0)}</strong> contenuti</span><span><strong>${Number(collection.subjectCount || 0)}</strong> soggetti</span></div></div><footer class="operations"><button type="button" data-collection-id="${escapeHtml(collection.id)}">Apri raccolta ${icon("chevron", { size: 14 })}</button></footer></article>`;
  }

  renderCollections() {
    const collections = this.spaceData?.collections || [];
    return `<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Raccolte</span><h2>Raccolte dello spazio</h2><p>Ogni raccolta seleziona contenuti dello spazio e li combina con Regole editoriali e un grafo semantico.</p></div>${this.spaceData?.permissions?.canCreateCollection ? `<button type="button" data-new-collection>${icon("plus", { size: 16 })} Nuova raccolta</button>` : ""}</div>${collections.length ? `<div class="asset-grid">${collections.map((collection) => this.renderCollectionCard(collection)).join("")}</div>` : `<div class="empty-state"><h3>Nessuna raccolta</h3><p>I contenuti dello spazio possono esistere senza appartenere ancora a una raccolta. Crea una raccolta quando vuoi curare una selezione con regole e relazioni.</p>${this.spaceData?.permissions?.canCreateCollection ? `<button type="button" data-new-collection>${icon("plus", { size: 15 })} Crea la prima raccolta</button>` : ""}</div>`}</section>`;
  }

  renderContentCard(row) {
    const subject = row.subject || {};
    return `<article class="asset owned content-item-card" data-open-item="${escapeHtml(id(row.itemId))}" role="button" tabindex="0"><header><span class="asset-icon">${icon("book", { size: 20 })}</span><div><p class="badge">Item</p><h3>${escapeHtml(subject.label || "Soggetto non disponibile")}</h3></div></header><div class="asset-copy">${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : `<p class="muted">Contenuto disponibile nello spazio editoriale.</p>`}<div class="stats"><span><strong>${Number(row.editionCount || 0)}</strong> ${Number(row.editionCount || 0) === 1 ? "edizione" : "edizioni"}</span><span><strong>${Number(row.collectionUsageCount || 0)}</strong> ${Number(row.collectionUsageCount || 0) === 1 ? "raccolta" : "raccolte"}</span></div></div><footer class="operations"><span class="button-link">Dettagli ${icon("chevron", { size: 14 })}</span></footer></article>`;
  }

  renderContents() {
    const rows = this.contentData?.results || [];
    const pagination = this.contentData?.pagination || { page: this.contentPage, total: 0, totalPages: 0 };
    return `<section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Inventario editoriale</span><h2>Contenuti dello spazio</h2><p>Lo spazio contiene Item indipendenti dalle singole raccolte. Uno stesso contenuto può essere usato da più raccolte.</p></div><div class="button-row"><span class="count">${Number(pagination.total || 0)}</span><button type="button" data-new-content>${icon("plus", { size: 16 })} Aggiungi contenuto</button></div></div><section class="panel"><form class="inline-form" data-content-search role="search"><label>Cerca per soggetto<input name="q" value="${escapeHtml(this.contentQuery)}" placeholder="Opera, autore, tema…"></label><button type="submit" ${this.contentBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form></section>${this.contentError ? `<p role="alert">${escapeHtml(this.contentError)}</p>` : ""}${this.contentBusy && !this.contentData ? `<div class="asset-grid"><div class="skeleton skeleton-card"></div><div class="skeleton skeleton-card"></div></div>` : rows.length ? `<div class="asset-grid">${rows.map((row) => this.renderContentCard(row)).join("")}</div>` : `<div class="empty-state"><h3>${this.contentQuery ? "Nessun contenuto corrispondente" : "Nessun contenuto nello spazio"}</h3><p>${this.contentQuery ? "Prova con un altro soggetto o rimuovi il filtro di ricerca." : "Usa “Aggiungi contenuto” per inserire il primo Item nello spazio editoriale corrente."}</p></div>`}<nav class="pagination" aria-label="Pagine dei contenuti"><button type="button" data-content-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.contentBusy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)}${Number(pagination.totalPages || 0) ? ` di ${Number(pagination.totalPages)}` : ""}</span><button type="button" data-content-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.contentBusy ? "disabled" : ""}>Successiva →</button></nav></section>`;
  }

  renderEditorial() {
    if (!this.spaces.length) {
      return `<section class="empty-state"><h3>Lavoro editoriale non ancora configurato</h3><p>Crea uno spazio editoriale dal pannello qui sopra per iniziare a organizzare raccolte e contenuti.</p></section>`;
    }
    if (!this.currentSpace || !this.spaceData) return `<section class="empty-state"><p>Seleziona uno spazio editoriale dal pannello qui sopra per continuare.</p></section>`;
    return this.editorialSection === "content" ? this.renderContents() : this.renderCollections();
  }

  renderResourceCard(asset) {
    const editHref = (asset.availableOperations || []).some((operation) => operation.code === "open_editor") ? authoringHref(asset.authoringRef) : null;
    const state = asset.state ? `<span class="status">${escapeHtml(resourceStateLabel(asset.state))}</span>` : "";
    const editorial = asset.editorialWorkflow ? `<p><strong>Stato editoriale:</strong> ${escapeHtml(resourceStateLabel(asset.editorialWorkflow.status))} · ${escapeHtml(integrityLabel(asset.editorialWorkflow.integrityStatus))}</p>` : "";
    const graphStats = asset.resourceType === "semantic_graph" && asset.semanticGraphStats
      ? `<div class="stats"><span><strong>${Number(asset.semanticGraphStats.subjectCount || 0)}</strong> soggetti</span><span><strong>${Number(asset.semanticGraphStats.relationCount || 0)}</strong> relazioni</span><span><strong>${Number(asset.semanticGraphStats.collectionUsageCount || 0)}</strong> raccolte</span><span><strong>${Number(asset.semanticGraphStats.contentSpaceUsageCount || 0)}</strong> spazi</span></div>`
      : "";
    const assetIcon = asset.resourceType === "visit" ? "route" : asset.resourceType === "semantic_graph" ? "link" : "book";
    return `<article class="asset owned"><header><span class="asset-icon">${icon(assetIcon, { size: 20 })}</span><div><p class="badge">${escapeHtml(resourceLabel(asset.resourceType))}</p><h3>${escapeHtml(asset.title)}</h3></div>${state}</header><div class="asset-copy">${asset.summary ? `<p>${escapeHtml(asset.summary)}</p>` : ""}${editorial}${graphStats}</div><footer class="operations">${editHref ? `<button type="button" data-authoring-href="${escapeHtml(editHref)}">${icon("edit", { size: 15 })}${escapeHtml(editorLabel(asset.resourceType, "Apri"))}</button>` : ""}<button type="button" class="button-secondary" data-resource-detail data-resource-type="${escapeHtml(asset.resourceType)}" data-resource-id="${escapeHtml(asset.resourceId)}">Dettagli ${icon("chevron", { size: 14 })}</button></footer></article>`;
  }

  renderResources() {
    const results = this.resources?.results || [];
    const total = Number(this.resources?.total || 0);
    const page = Number(this.resources?.page || this.resourcePage);
    const pageSize = Number(this.resources?.pageSize || 12);
    const options = RESOURCE_TYPES.map(([value, label]) => `<option value="${escapeHtml(value)}" ${value === this.resourceType ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    return `<section class="panel"><form data-resource-search class="inline-form" role="search"><label>Cerca<input name="q" value="${escapeHtml(this.resourceQuery)}" placeholder="Titolo o descrizione"></label><label>Tipo di risorsa<select name="resourceType">${options}</select></label><button type="submit" ${this.busy ? "disabled" : ""}>${icon("search", { size: 15 })} Mostra i risultati</button></form></section><section class="workspace-section"><div class="section-heading"><div><span class="eyebrow">Risorse condivise</span><h2>Risorse dell'area di lavoro</h2><p>Visite, Regole editoriali, grafi semantici e vocabolari fisici sono riutilizzabili trasversalmente agli spazi editoriali dell'area di lavoro.</p></div><span class="count">${total}</span></div>${results.length ? `<div class="asset-grid">${results.map((asset) => this.renderResourceCard(asset)).join("")}</div>` : `<div class="empty-state"><h3>Nessuna risorsa trovata</h3><p>${this.resourceQuery || this.resourceType ? "Prova a modificare ricerca o tipo di risorsa." : "Le risorse condivise che creerai compariranno qui."}</p><a class="button-link" data-route href="/create">${icon("plus", { size: 15 })} Crea una risorsa</a></div>`}<nav class="pagination" aria-label="Pagine delle risorse"><button type="button" data-resource-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page}</span><button type="button" data-resource-page="${page + 1}" ${page * pageSize >= total || this.busy ? "disabled" : ""}>Successiva →</button></nav></section>`;
  }

  renderRemovedMessage() {
    if (!this.removed) return "";
    const label = {
      content: "Contenuto eliminato dall’account.",
      collection: "Raccolta eliminata dall’account.",
      namespace: "Regole editoriali eliminate dall’account.",
      physical_vocabulary: "Vocabolario fisico eliminato dall’account.",
      visit: "Visita eliminata dall’account.",
    }[this.removed] || "Risorsa eliminata dall’account.";
    return `<p class="status success" role="status">${escapeHtml(label)} Le snapshot già acquisite e i diritti già concessi restano validi.</p>`;
  }

  render() {
    if (this.busy && !this.workspaceContext) {
      this.innerHTML = `<main class="page"><div class="empty-state"><div class="skeleton skeleton-line" style="width:14rem"></div><p>Caricamento della Libreria…</p></div></main>`;
      return;
    }
    if (this.error && !this.workspaceContext) {
      this.innerHTML = `<main class="page"><div class="empty-state"><h1>Libreria</h1><p role="alert">${escapeHtml(this.error)}</p></div></main>`;
      return;
    }
    const content = this.section === "resources" ? this.renderResources() : this.renderEditorial();
    this.innerHTML = `<main class="page workspace-page" aria-busy="${this.busy || this.contentBusy}"><header class="page-header"><div><span class="eyebrow">Libreria</span><h1>Libreria</h1><p>Organizza raccolte e contenuti nello spazio editoriale corrente oppure consulta le risorse condivise dell'area di lavoro.</p></div></header>${this.renderLibraryScope()}${this.renderLibraryTabs()}${this.renderRemovedMessage()}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${content}</main>`;
  }
}

customElements.define("artaround-workspace-browser-view", ArtAroundWorkspaceBrowserView);
