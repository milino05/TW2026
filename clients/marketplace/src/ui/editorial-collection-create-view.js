import { navigate } from "../application/router.js";
import { operatingPrincipal, readOperatingContext } from "../application/operating-context.js";
import { setEditorialSpacePreference } from "../application/editorial-space-preference.js";
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
  step = 1;
  semanticSource = "new";
  reuseMode = "shared";
  selectedGraphId = "";
  graphQuery = "";
  graphPage = 1;
  graphChoices = null;
  graphBusy = false;
  busy = false;
  error = null;
  dirty = false;
  draft = {
    displayName: "",
    shortDescription: "",
    description: "",
    graphDisplayName: "",
    graphDescription: "",
  };

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
    for (const field of ["displayName", "shortDescription", "description", "graphDisplayName", "graphDescription"]) {
      if (form.elements.namedItem(field)) this.draft[field] = String(data.get(field) || "");
    }
  }

  onInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target?.form?.matches("[data-create-collection]")) return;
    if (!Object.prototype.hasOwnProperty.call(this.draft, target.name)) return;
    this.draft[target.name] = target.value;
    this.dirty = true;
  };

  async load() {
    const principal = operatingPrincipal(this.context);
    if (!principal) { this.error = "Area di lavoro non selezionata"; this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
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
      if (this.selectedSpace) setEditorialSpacePreference(principal, id(this.selectedSpace), { silent: true });
      const namespaces = this.preflight?.collection?.usableNamespaces || [];
      this.selectedNamespaceId = namespaces.some((entry) => id(entry.id) === id(this.selectedNamespaceId))
        ? this.selectedNamespaceId
        : id(namespaces[0]?.id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile preparare la nuova raccolta";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async loadGraphChoices({ render = true } = {}) {
    if (!this.selectedNamespaceId || !this.context || !this.selectedSpace) {
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
        contentSpaceId: id(this.selectedSpace),
        q: this.graphQuery,
        page: this.graphPage,
        limit: 12,
      });
      const results = this.graphChoices?.results || [];
      if (this.selectedGraphId && !results.some((graph) => id(graph.id) === id(this.selectedGraphId))) this.selectedGraphId = "";
      if (this.semanticSource === "existing" && !this.selectedGraphId && results.length) this.selectedGraphId = id(results[0].id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile cercare i grafi semantici disponibili";
    } finally {
      this.graphBusy = false;
      if (render) this.render();
    }
  }

  backHref() { return "/workspace"; }

  resetSemanticSelection() {
    this.semanticSource = "new";
    this.reuseMode = "shared";
    this.selectedGraphId = "";
    this.graphQuery = "";
    this.graphPage = 1;
    this.graphChoices = null;
    this.draft.graphDisplayName = "";
    this.draft.graphDescription = "";
  }

  onChange = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;
    if (target.matches("select[name='namespaceId']")) {
      this.captureDraft(target.form);
      this.dirty = true;
      this.selectedNamespaceId = target.value;
      this.resetSemanticSelection();
      return;
    }
    if (target.matches("input[name='semanticSource']")) {
      this.captureDraft(target.form);
      this.semanticSource = target.value === "existing" ? "existing" : "new";
      this.dirty = true;
      if (this.semanticSource === "existing" && !this.graphChoices) void this.loadGraphChoices();
      else this.render();
      return;
    }
    if (target.matches("input[name='reuseMode']")) {
      this.captureDraft(target.form);
      this.reuseMode = target.value === "fork" ? "fork" : "shared";
      this.dirty = true;
      this.render();
      return;
    }
    if (target.matches("input[name='semanticGraphId']")) {
      this.captureDraft(target.form);
      this.selectedGraphId = target.value;
      this.dirty = true;
      this.render();
    }
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-back-space]")) { navigate(this.backHref()); return; }
    if (target?.closest("[data-back-step]")) {
      this.captureDraft();
      this.step = 1;
      this.error = null;
      this.render();
      return;
    }
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

  async continueToSemanticStep(form) {
    this.captureDraft(form);
    if (!form.reportValidity()) return;
    this.step = 2;
    this.error = null;
    this.dirty = true;
    if (!this.graphChoices) await this.loadGraphChoices({ render: false });
    this.render();
  }

  async createCollection(form) {
    this.captureDraft(form);
    if (!form.reportValidity()) return;
    const graphMode = this.semanticSource === "new" ? "new" : this.reuseMode;
    if (this.semanticSource === "existing" && !this.selectedGraphId) {
      this.error = "Scegli un grafo semantico compatibile.";
      this.render();
      return;
    }
    if (["new", "fork"].includes(graphMode) && !this.draft.graphDisplayName.trim()) {
      this.error = "Indica il nome del nuovo grafo semantico.";
      this.render();
      return;
    }

    const payload = {
      ownerType: this.context.type,
      ownerId: this.context.id,
      contentSpaceId: id(this.selectedSpace),
      namespaceId: this.selectedNamespaceId,
      graphMode,
      ...(this.selectedGraphId && this.semanticSource === "existing" ? { semanticGraphId: this.selectedGraphId } : {}),
      ...(["new", "fork"].includes(graphMode) ? {
        graphDisplayName: this.draft.graphDisplayName.trim(),
        graphDescription: this.draft.graphDescription.trim() || null,
      } : {}),
      displayName: this.draft.displayName.trim(),
      shortDescription: this.draft.shortDescription.trim() || null,
      description: this.draft.description.trim() || null,
    };

    this.busy = true;
    this.error = null;
    this.render();
    try {
      const created = await editorialRepository.createCollection(payload);
      const editorialContextId = id(created?.editorialContext);
      if (!editorialContextId) throw new Error("La raccolta è stata creata ma non è stato restituito il suo identificatore");
      this.dirty = false;
      navigate(`/workspace/editorial-studio?editorialContextId=${encodeURIComponent(editorialContextId)}`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Creazione della raccolta non completata";
      this.busy = false;
      this.render();
    }
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form?.matches("[data-create-collection]")) return;
    event.preventDefault();
    if (!this.preflight?.collection?.allowed || !this.selectedSpace || this.busy) return;
    if (this.step === 1) await this.continueToSemanticStep(form);
    else await this.createCollection(form);
  };

  blocker() {
    if (!this.requestedContentSpaceId) {
      return `<div class="empty-state"><span>${icon("workspace", { size: 28 })}</span><h1>Scegli prima uno spazio editoriale</h1><p>Le raccolte appartengono allo spazio editoriale corrente della Libreria. Seleziona lo spazio e avvia la creazione dalla sezione Raccolte.</p><a class="button-link" data-route href="/workspace">Apri la Libreria</a></div>`;
    }
    if (!this.selectedSpace) {
      return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h1>Spazio non disponibile</h1><p>Lo spazio richiesto non appartiene all'area di lavoro corrente o non è più disponibile.</p><a class="button-link" data-route href="/workspace">Torna alla Libreria</a></div>`;
    }
    const blocker = this.preflight?.collection?.blockers?.[0];
    return `<div class="empty-state"><span>${icon("warning", { size: 28 })}</span><h1>La raccolta non può ancora essere creata</h1><p>${escapeHtml(blocker?.message || "Mancano i prerequisiti editoriali.")}</p><button type="button" class="button-secondary" data-back-space>Torna alla Libreria</button></div>`;
  }

  renderStepIndicator() {
    return `<div class="stats" aria-label="Avanzamento creazione raccolta"><span><strong>${this.step === 1 ? "1" : "✓"}</strong> Identità e regole</span><span><strong>${this.step === 2 ? "2" : ""}</strong> Struttura semantica</span></div>`;
  }

  renderIdentityStep() {
    const namespaces = this.preflight.collection.usableNamespaces || [];
    const namespaceOptions = namespaces.map((namespace) => `<option value="${escapeHtml(id(namespace.id))}" ${id(namespace.id) === id(this.selectedNamespaceId) ? "selected" : ""}>${escapeHtml(namespace.name)}${namespace.source === "licensed" ? " · acquisito" : ""}</option>`).join("");
    return `<form class="panel form-grid" data-create-collection>
      <div class="full panel"><span class="eyebrow">Spazio editoriale</span><h3>${escapeHtml(this.selectedSpace.name)}</h3><p class="note">La raccolta verrà creata nello spazio corrente. Lo spazio non può essere cambiato da questo wizard.</p></div>
      <label>Nome della raccolta<input name="displayName" required maxlength="160" placeholder="Rinascimento italiano" value="${escapeHtml(this.draft.displayName)}"></label>
      <label>Descrizione breve<input name="shortDescription" maxlength="240" placeholder="Facoltativa" value="${escapeHtml(this.draft.shortDescription)}"></label>
      <label class="full">Descrizione<textarea name="description" rows="4" placeholder="Obiettivo, pubblico o criterio curatoriale">${escapeHtml(this.draft.description)}</textarea></label>
      <label class="full">Regole editoriali<select name="namespaceId" required>${namespaceOptions}</select><span class="note">Le regole definiscono classificazioni, relazioni e modalità di presentazione disponibili nella raccolta. Dopo la creazione non verranno sostituite.</span></label>
      <div class="operations full"><button type="button" class="button-secondary" data-back-space>Annulla</button><button type="submit">Continua ${icon("chevron", { size: 15 })}</button></div>
    </form>`;
  }

  renderGraphChoice(graph) {
    const graphId = id(graph.id);
    const checked = this.selectedGraphId === graphId;
    const usage = Number(graph.collectionUsageCount || 0);
    const subjects = Number(graph.subjectCount || 0);
    const relations = Number(graph.relationCount || 0);
    const coverage = graph.currentSpaceCoverage || null;
    const covered = Number(coverage?.coveredSubjectCount || 0);
    const total = Number(coverage?.totalSubjectCount || subjects);
    return `<label class="asset owned">
      <header><span class="asset-icon">${icon("link", { size: 18 })}</span><div><p class="badge">${graph.usedInCurrentSpace ? "Già usato in questo spazio" : "Compatibile"}</p><h3>${escapeHtml(graph.name || "Grafo semantico")}</h3></div><input type="radio" name="semanticGraphId" value="${escapeHtml(graphId)}" ${checked ? "checked" : ""}></header>
      <div class="asset-copy">${graph.description ? `<p>${escapeHtml(graph.description)}</p>` : `<p class="muted">Grafo semantico autonomo e riusabile.</p>`}
        <div class="stats"><span><strong>${subjects}</strong> soggetti</span><span><strong>${relations}</strong> relazioni</span><span><strong>${usage}</strong> ${usage === 1 ? "raccolta" : "raccolte"}</span></div>
        ${coverage ? `<p class="note">Coverage nello spazio: <strong>${covered}/${total}</strong> soggetti del grafo hanno contenuti diretti disponibili.</p>` : ""}
      </div>
    </label>`;
  }

  renderGraphGroup(title, graphs) {
    if (!graphs.length) return "";
    return `<section class="full"><header class="section-heading"><div><span class="eyebrow">${escapeHtml(title)}</span></div></header><div class="asset-grid">${graphs.map((graph) => this.renderGraphChoice(graph)).join("")}</div></section>`;
  }

  renderExistingGraphPicker() {
    if (this.semanticSource !== "existing") return "";
    const results = this.graphChoices?.results || [];
    const inSpace = results.filter((graph) => graph.usedInCurrentSpace);
    const other = results.filter((graph) => !graph.usedInCurrentSpace);
    const pagination = this.graphChoices?.pagination || { page: this.graphPage, total: 0, totalPages: 0 };
    return `<div class="full">
      <div class="panel inline-form"><label>Cerca un grafo<input type="search" data-graph-query value="${escapeHtml(this.graphQuery)}" placeholder="Nome o descrizione"></label><button type="button" class="button-secondary" data-search-graphs ${this.graphBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></div>
      ${this.graphBusy && !this.graphChoices ? `<div class="skeleton skeleton-card"></div>` : results.length
        ? `${this.renderGraphGroup("Grafi già usati in questo spazio", inSpace)}${this.renderGraphGroup("Altri grafi compatibili", other)}`
        : `<div class="empty-state compact"><h3>Nessun grafo compatibile</h3><p>${this.graphQuery ? "Prova con un'altra ricerca oppure crea un nuovo grafo." : "Non esistono ancora grafi compatibili con queste Regole editoriali."}</p></div>`}
      ${Number(pagination.totalPages || 0) > 1 ? `<nav class="pagination" aria-label="Pagine dei grafi"><button type="button" data-graph-page="${Number(pagination.page || 1) - 1}" ${Number(pagination.page || 1) <= 1 || this.graphBusy ? "disabled" : ""}>← Precedente</button><span>Pagina ${Number(pagination.page || 1)} di ${Number(pagination.totalPages || 1)}</span><button type="button" data-graph-page="${Number(pagination.page || 1) + 1}" ${Number(pagination.page || 1) >= Number(pagination.totalPages || 0) || this.graphBusy ? "disabled" : ""}>Successiva →</button></nav>` : ""}
    </div>`;
  }

  renderNewGraphFields({ fork = false } = {}) {
    if (this.semanticSource === "new" || (this.semanticSource === "existing" && this.reuseMode === "fork")) {
      return `<div class="full panel form-grid"><div class="full"><span class="eyebrow">${fork ? "Nuova lineage indipendente" : "Nuovo grafo"}</span><p class="note">${fork ? "La copia parte dalla revisione di lavoro attuale del grafo selezionato. Le modifiche successive non saranno condivise." : "Il grafo nasce vuoto e resta una risorsa autonoma, riusabile da altre raccolte compatibili."}</p></div><label>Nome del grafo<input name="graphDisplayName" required maxlength="160" placeholder="Relazioni sul Rinascimento" value="${escapeHtml(this.draft.graphDisplayName)}"></label><label class="full">Descrizione del grafo<textarea name="graphDescription" rows="3" placeholder="Ambito e criterio semantico">${escapeHtml(this.draft.graphDescription)}</textarea></label></div>`;
    }
    return "";
  }

  renderSemanticStep() {
    const total = Number(this.graphChoices?.pagination?.total || 0);
    return `<form class="panel form-grid" data-create-collection>
      <div class="full panel"><span class="eyebrow">Raccolta</span><h3>${escapeHtml(this.draft.displayName)}</h3><p class="note">${escapeHtml(this.selectedSpace.name)} · le Regole editoriali selezionate determinano quali grafi sono compatibili.</p></div>
      <fieldset class="full"><legend>Struttura semantica</legend><p class="note">Il grafo non contiene i contenuti della raccolta: contiene Subject, classificazioni e relazioni. Può quindi essere condiviso tra raccolte e spazi diversi dello stesso proprietario, purché usino le stesse Regole editoriali.</p>
        <div class="asset-grid">
          <label class="asset owned"><header><span class="asset-icon">${icon("plus", { size: 18 })}</span><div><p class="badge">Nuovo</p><h3>Crea un nuovo grafo</h3></div><input type="radio" name="semanticSource" value="new" ${this.semanticSource === "new" ? "checked" : ""}></header><div class="asset-copy"><p>Avvia una struttura semantica indipendente e vuota.</p></div></label>
          <label class="asset owned"><header><span class="asset-icon">${icon("link", { size: 18 })}</span><div><p class="badge">Esistente</p><h3>Usa un grafo compatibile</h3></div><input type="radio" name="semanticSource" value="existing" ${this.semanticSource === "existing" ? "checked" : ""} ${!total && !this.graphQuery && this.graphChoices ? "disabled" : ""}></header><div class="asset-copy"><p>Riusa la conoscenza già curata senza spostare o copiare contenuti tra spazi.</p></div></label>
        </div>
      </fieldset>
      ${this.semanticSource === "new" ? this.renderNewGraphFields() : `${this.renderExistingGraphPicker()}${this.selectedGraphId ? `<fieldset class="full"><legend>Come vuoi usare il grafo selezionato?</legend><div class="asset-grid"><label class="asset owned"><header><span class="asset-icon">${icon("link", { size: 18 })}</span><div><p class="badge">Condiviso</p><h3>Usa come grafo condiviso</h3></div><input type="radio" name="reuseMode" value="shared" ${this.reuseMode === "shared" ? "checked" : ""}></header><div class="asset-copy"><p>La raccolta userà la stessa lineage. Le future modifiche alla working revision saranno condivise, mentre review e release già congelate resteranno immutabili.</p></div></label><label class="asset owned"><header><span class="asset-icon">${icon("copy", { size: 18 })}</span><div><p class="badge">Indipendente</p><h3>Crea una copia indipendente</h3></div><input type="radio" name="reuseMode" value="fork" ${this.reuseMode === "fork" ? "checked" : ""}></header><div class="asset-copy"><p>Copia la revisione di lavoro attuale in una nuova lineage. Da quel momento i due grafi evolveranno separatamente.</p></div></label></div></fieldset>${this.reuseMode === "fork" ? this.renderNewGraphFields({ fork: true }) : ""}` : ""}`}
      <div class="operations full"><button type="button" class="button-secondary" data-back-step>← Indietro</button><button type="submit" ${this.busy || this.graphBusy ? "disabled" : ""}>Crea raccolta ${icon("chevron", { size: 15 })}</button></div>
    </form>`;
  }

  render() {
    if (this.busy && !this.preflight) { this.innerHTML = `<main class="page"><div class="empty-state"><p>Preparazione della raccolta…</p></div></main>`; return; }
    if (this.error && !this.preflight) { this.innerHTML = `<main class="page"><div class="empty-state"><h1>Nuova raccolta</h1><p role="alert">${escapeHtml(this.error)}</p></div></main>`; return; }
    if (!this.preflight || !this.selectedSpace || !this.preflight.collection?.allowed) { this.innerHTML = `<main class="page workspace-page">${this.blocker()}</main>`; return; }
    this.innerHTML = `<main class="page workspace-page" aria-busy="${this.busy || this.graphBusy}">
      <nav class="breadcrumb" aria-label="Percorso"><a data-route href="/workspace">Libreria</a><span aria-hidden="true">/</span><span>${escapeHtml(this.selectedSpace.name)}</span><span aria-hidden="true">/</span><span>Nuova raccolta</span></nav>
      <header class="page-header"><div><span class="eyebrow">Nuova raccolta editoriale</span><h1>Crea una raccolta in ${escapeHtml(this.selectedSpace.name)}</h1><p>Definisci prima identità e Regole editoriali, poi scegli la struttura semantica. Nessuna risorsa viene creata finché non completi il secondo passaggio.</p>${this.renderStepIndicator()}</div></header>
      ${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}
      ${this.step === 1 ? this.renderIdentityStep() : this.renderSemanticStep()}
    </main>`;
  }
}

customElements.define("artaround-editorial-collection-create-view", ArtAroundEditorialCollectionCreateView);
