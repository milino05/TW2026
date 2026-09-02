import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }

export class ArtAroundEditorialCollectionCreateView extends HTMLElement {
  context = readOperatingContext();
  preflight = null;
  spaces = [];
  requestedContentSpaceId = null;
  selectedSpace = null;
  selectedNamespaceId = "";
  graphMode = "new";
  selectedGraphId = "";
  graphQuery = "";
  graphPage = 1;
  graphChoices = null;
  graphBusy = false;
  busy = false;
  error = null;
  dirty = false;
  draft = { displayName: "", shortDescription: "", description: "" };

  connectedCallback() {
    this.requestedContentSpaceId = new URLSearchParams(window.location.search).get("contentSpaceId") || null;
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("click", this.onClick);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onChange);
    void this.load();
  }
  disconnectedCallback() {
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
  }

  hasUnsavedChanges() { return this.dirty; }
  discardUnsavedChanges() { this.dirty = false; }

  captureDraft(form = this.querySelector("[data-create-collection]")) {
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    this.draft = {
      displayName: String(data.get("displayName") || ""),
      shortDescription: String(data.get("shortDescription") || ""),
      description: String(data.get("description") || ""),
    };
  }

  onInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.form?.matches("[data-create-collection]")) return;
    if (!["displayName", "shortDescription", "description"].includes(target.name)) return;
    this.draft[target.name] = target.value;
    this.dirty = true;
  };

  async load() {
    const principal = operatingPrincipal(this.context);
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true; this.error = null; this.render();
    try {
      const [preflight, spaces] = await Promise.all([
        marketplaceRepository.authoringPreflight(principal),
        editorialRepository.listSpaces({ ownerType: this.context.type, ownerId: this.context.id }),
      ]);
      this.preflight = preflight;
      this.spaces = spaces || [];
      this.selectedSpace = this.requestedContentSpaceId
        ? this.spaces.find((space) => id(space) === String(this.requestedContentSpaceId)) || null
        : null;
      const namespaces = this.preflight?.collection?.usableNamespaces || [];
      this.selectedNamespaceId = namespaces.some((entry) => id(entry.id) === id(this.selectedNamespaceId))
        ? this.selectedNamespaceId
        : id(namespaces[0]?.id);
      if (this.selectedSpace && this.selectedNamespaceId) await this.loadGraphChoices({ render: false });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile preparare la nuova raccolta";
    } finally {
      this.busy = false; this.render();
    }
  }

  async loadGraphChoices({ render = true } = {}) {
    if (!this.selectedNamespaceId || !this.context) {
      this.graphChoices = { results: [], pagination: { page: 1, total: 0, totalPages: 0 } };
      if (render) this.render();
      return;
    }
    this.graphBusy = true;
    this.error = null;
    if (render) this.render();
    try {
      this.graphChoices = await editorialRepository.reusableSemanticGraphs({
        ownerType: this.context.type,
        ownerId: this.context.id,
        namespaceId: this.selectedNamespaceId,
        q: this.graphQuery,
        page: this.graphPage,
        limit: 8,
      });
      const results = this.graphChoices?.results || [];
      if (this.selectedGraphId && !results.some((graph) => id(graph.id) === id(this.selectedGraphId))) this.selectedGraphId = "";
      if (this.graphMode === "reuse" && !this.selectedGraphId && results.length) this.selectedGraphId = id(results[0].id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile cercare i grafi semantici disponibili";
    } finally {
      this.graphBusy = false;
      if (render) this.render();
    }
  }

  backHref() {
    const spaceId = id(this.selectedSpace) || this.requestedContentSpaceId;
    return spaceId ? `/workspace/editorial-space?contentSpaceId=${encodeURIComponent(spaceId)}` : "/workspace/editorial-spaces";
  }

  onChange = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;
    if (target.matches("select[name='namespaceId']")) {
      this.captureDraft(target.form);
      this.dirty = true;
      this.selectedNamespaceId = target.value;
      this.graphMode = "new";
      this.selectedGraphId = "";
      this.graphQuery = "";
      this.graphPage = 1;
      this.graphChoices = null;
      void this.loadGraphChoices();
      return;
    }
    if (target.matches("input[name='graphMode']")) {
      this.captureDraft(target.form);
      this.dirty = true;
      this.graphMode = target.value === "reuse" ? "reuse" : "new";
      if (this.graphMode === "reuse" && !this.selectedGraphId) this.selectedGraphId = id(this.graphChoices?.results?.[0]?.id);
      this.render();
      return;
    }
    if (target.matches("input[name='semanticGraphId']")) {
      this.selectedGraphId = target.value;
      this.dirty = true;
    }
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-back-space]")) { navigate(this.backHref()); return; }
    if (target?.closest("[data-search-graphs]")) {
      this.captureDraft();
      this.graphQuery = String(this.querySelector("[data-graph-query]")?.value || "").trim();
      this.graphPage = 1;
      this.selectedGraphId = "";
      void this.loadGraphChoices();
      return;
    }
    const page = target?.closest("[data-graph-page]");
    if (page) {
      this.captureDraft();
      this.graphPage = Math.max(1, Number(page.dataset.graphPage) || 1);
      this.selectedGraphId = "";
      void this.loadGraphChoices();
    }
  };

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-create-collection]")) return;
    event.preventDefault();
    if (!this.preflight?.collection?.allowed || !this.selectedSpace) return;
    this.captureDraft(form);
    const data = new FormData(form);
    const semanticGraphId = this.graphMode === "reuse" ? String(data.get("semanticGraphId") || this.selectedGraphId || "") : "";
    if (this.graphMode === "reuse" && !semanticGraphId) {
      this.error = "Scegli il grafo semantico da condividere con questa raccolta.";
      this.render();
      return;
    }
    const payload = {
      ownerType: this.context.type,
      ownerId: this.context.id,
      contentSpaceId: id(this.selectedSpace),
      namespaceId: String(data.get("namespaceId") || ""),
      ...(semanticGraphId ? { semanticGraphId } : {}),
      displayName: this.draft.displayName.trim(),
      shortDescription: this.draft.shortDescription.trim() || null,
      description: this.draft.description.trim() || null,
    };
    this.busy = true; this.error = null; this.render();
    try {
      const created = await editorialRepository.createCollection(payload);
      const editorialContextId = id(created?.editorialContext);
      if (!editorialContextId) throw new Error("La raccolta è stata creata ma non è stato restituito il suo identificatore");
      this.dirty = false;
      navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(editorialContextId)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Creazione della raccolta non completata";
      this.busy = false; this.render();
    }
  };

  blocker() {
    if (!this.requestedContentSpaceId) {
      return `<div class="empty-state"><span>${icon("workspace", { size: 28 })}</span><h1>Scegli prima uno spazio editoriale</h1><p>Le raccolte organizzano una selezione dei contenuti di uno spazio. Apri lo spazio in cui vuoi lavorare e crea la raccolta da lì.</p><a class="button-link" data-route href="/workspace/editorial-spaces">Apri gli spazi editoriali</a></div>`;
    }
    if (!this.selectedSpace) {
      return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h1>Spazio non disponibile</h1><p>Lo spazio richiesto non appartiene all'area di lavoro corrente o non è più disponibile.</p><a class="button-link" data-route href="/workspace/editorial-spaces">Torna agli spazi editoriali</a></div>`;
    }
    const blocker = this.preflight?.collection?.blockers?.[0];
    return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h1>La raccolta non può ancora essere creata</h1><p>${escapeHtml(blocker?.message || "Mancano i prerequisiti editoriali.")}</p><button type="button" class="button-secondary" data-back-space>Torna allo spazio</button></div>`;
  }

  renderGraphChoice(graph) {
    const graphId = id(graph.id);
    const checked = this.selectedGraphId === graphId;
    const usage = Number(graph.collectionUsageCount || 0);
    const subjects = Number(graph.subjectCount || 0);
    const relations = Number(graph.relationCount || 0);
    return `<label class="asset owned"><header><span class="asset-icon">${icon("link", { size: 18 })}</span><div><p class="badge">Grafo condivisibile</p><h3>${escapeHtml(graph.name || "Grafo semantico")}</h3></div><input type="radio" name="semanticGraphId" value="${escapeHtml(graphId)}" ${checked ? "checked" : ""}></header><div class="asset-copy">${graph.description ? `<p>${escapeHtml(graph.description)}</p>` : `<p class="muted">Conoscenza semantica riusabile indipendentemente dai contenuti della raccolta.</p>`}<div class="stats"><span><strong>${subjects}</strong> soggetti</span><span><strong>${relations}</strong> relazioni</span><span><strong>${usage}</strong> ${usage === 1 ? "raccolta" : "raccolte"}</span></div></div></label>`;
  }

  renderReusableGraphs() {
    if (this.graphMode !== "reuse") return "";
    const results = this.graphChoices?.results || [];
    const pagination = this.graphChoices?.pagination || { page: this.graphPage, total: 0, totalPages: 0 };
    return `<div class="full"><div class="panel inline-form"><label>Cerca un grafo<input type="search" data-graph-query value="${escapeHtml(this.graphQuery)}" placeholder="Nome o descrizione"></label><button type="button" class="button-secondary" data-search-graphs ${this.graphBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></div>${this.graphBusy && !this.graphChoices ? `<div class="skeleton skeleton-card"></div>` : results.length ? `<div class="asset-grid">${results.map((graph) => this.renderGraphChoice(graph)).join("")}</div>` : `<div class="empty-state compact"><h3>Nessun grafo compatibile</h3><p>${this.graphQuery ? "Prova con un'altra ricerca oppure crea un nuovo grafo." : "Non esistono ancora grafi con queste Regole editoriali. Puoi crearne uno nuovo insieme alla raccolta."}</p></div>`}${Number(pagination.totalPages || 0) > 1 ? `<nav class="pagination" aria-label="Pagine dei grafi"><button type="button" data-graph-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.graphBusy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)} di ${Number(pagination.totalPages || 1)}</span><button type="button" data-graph-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.graphBusy ? "disabled" : ""}>Successiva →</button></nav>` : ""}</div>`;
  }

  renderSemanticChoice() {
    const total = Number(this.graphChoices?.pagination?.total || 0);
    return `<fieldset class="full"><legend>Relazioni semantiche</legend><p class="note">I contenuti della raccolta e il grafo sono indipendenti. Puoi iniziare una nuova struttura semantica oppure riusare il lavoro già curato in altre raccolte con le stesse Regole editoriali.</p><div class="asset-grid"><label class="asset owned"><header><span class="asset-icon">${icon("plus", { size: 18 })}</span><div><p class="badge">Nuovo</p><h3>Crea un nuovo grafo</h3></div><input type="radio" name="graphMode" value="new" ${this.graphMode === "new" ? "checked" : ""}></header><div class="asset-copy"><p>La raccolta partirà con un grafo vuoto, che potrà essere riusato successivamente da altre raccolte.</p></div></label><label class="asset owned"><header><span class="asset-icon">${icon("link", { size: 18 })}</span><div><p class="badge">Condiviso</p><h3>Riusa un grafo esistente</h3></div><input type="radio" name="graphMode" value="reuse" ${this.graphMode === "reuse" ? "checked" : ""} ${!total && !this.graphQuery ? "disabled" : ""}></header><div class="asset-copy"><p>Le modifiche future alla bozza del grafo saranno condivise. Ogni Raccolta in revisione o pubblicata continuerà però a usare la revisione che ha congelato.</p><p class="muted">${total ? `${total} ${total === 1 ? "grafo compatibile" : "grafi compatibili"} disponibili.` : "Nessun grafo compatibile disponibile."}</p></div></label></div>${this.renderReusableGraphs()}</fieldset>`;
  }

  render() {
    if (this.busy && !this.preflight) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Preparazione della raccolta…</p></div></main>`; return; }
    if (this.error && !this.preflight) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Nuova raccolta</h1><p role="alert">${escapeHtml(this.error)}</p></div></main>`; return; }
    if (!this.preflight || !this.selectedSpace || !this.preflight.collection?.allowed) { this.innerHTML = `<main class="page workspace-page">${this.blocker()}</main>`; return; }
    const spaceId = id(this.selectedSpace);
    const namespaces = this.preflight.collection.usableNamespaces || [];
    const namespaceOptions = namespaces.map((namespace) => `<option value="${escapeHtml(id(namespace.id))}" ${id(namespace.id) === id(this.selectedNamespaceId) ? "selected" : ""}>${escapeHtml(namespace.name)}${namespace.source === "licensed" ? " · acquisito" : ""}</option>`).join("");
    this.innerHTML = `<main class="page workspace-page" aria-busy="${this.busy || this.graphBusy}"><nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">Libreria</a><span aria-hidden="true">/</span><a data-route href="/workspace/editorial-spaces">Spazi editoriali</a><span aria-hidden="true">/</span><a data-route href="/workspace/editorial-space?contentSpaceId=${encodeURIComponent(spaceId)}">${escapeHtml(this.selectedSpace.name)}</a><span aria-hidden="true">/</span><span>Nuova raccolta</span></nav><header class="page-header"><div><span class="eyebrow">Nuova raccolta editoriale</span><h1>Crea una raccolta in ${escapeHtml(this.selectedSpace.name)}</h1><p>La raccolta seleziona contenuti dello spazio, applica Regole editoriali e utilizza una struttura semantica revisionata. I contenuti verranno scelti nello Studio dopo la creazione.</p></div></header>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}<form class="panel form-grid" data-create-collection><label>Nome della raccolta<input name="displayName" required maxlength="160" placeholder="Rinascimento italiano" value="${escapeHtml(this.draft.displayName)}"></label><label>Descrizione breve<input name="shortDescription" maxlength="240" placeholder="Facoltativa" value="${escapeHtml(this.draft.shortDescription)}"></label><label class="full">Descrizione<textarea name="description" rows="4" placeholder="Obiettivo, pubblico o criterio curatoriale">${escapeHtml(this.draft.description)}</textarea></label><label class="full">Regole editoriali<select name="namespaceId" required>${namespaceOptions}</select><span class="note">Le regole definiscono classificazioni, relazioni e modalità di presentazione disponibili nella raccolta.</span></label>${this.renderSemanticChoice()}<div class="operations full"><button type="button" class="button-secondary" data-back-space>Annulla</button><button type="submit" ${this.busy || this.graphBusy ? "disabled" : ""}>Crea raccolta ${icon("chevron", { size: 15 })}</button></div></form></main>`;
  }
}
customElements.define("artaround-editorial-collection-create-view", ArtAroundEditorialCollectionCreateView);
