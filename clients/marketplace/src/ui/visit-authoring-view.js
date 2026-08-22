import { navigate } from "../application/router.js";
import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { marketplaceRepository } from "../infrastructure/http/marketplace-repository.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function id(value) { return String(value || ""); }
function hasOperation(projection, code) {
  return (projection?.availableOperations || []).some((operation) => operation.code === code);
}
function currentParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    visitId: params.get("visitId"),
    principalType: params.get("principalType") || "user",
    principalId: params.get("principalId"),
  };
}
function asNullableNumber(value) {
  const text = String(value ?? "").trim();
  return text === "" ? null : Number(text);
}

export class ArtAroundVisitAuthoringView extends HTMLElement {
  projection = null;
  content = null;
  venueTargets = null;
  busy = false;
  error = null;
  message = null;
  query = "";
  page = 1;
  selectedReleaseId = null;
  selectedVenueId = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("change", this.onChange);
    this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("change", this.onChange);
  }

  get visitId() { return currentParams().visitId; }
  get revision() { return this.projection?.visit?.revision || null; }
  get principal() { return this.projection?.principal || null; }
  get editable() { return hasOperation(this.projection, "visit.edit"); }

  sourceChoices() {
    const values = new Map();
    for (const source of this.projection?.editorialSources || []) {
      values.set(id(source.editorialReleaseId), source);
    }
    for (const source of this.revision?.editorialSources || []) {
      const key = id(source.editorialReleaseId);
      if (!values.has(key)) values.set(key, {
        editorialContextId: source.editorialContextId,
        editorialReleaseId: source.editorialReleaseId,
        name: source.name,
        summary: "Source già collegata alla visita",
        ownership: "current_visit",
        versionMode: "pinned",
      });
    }
    return [...values.values()];
  }

  venueChoices() {
    return (this.projection?.venueSelector?.organizations || []).flatMap((organization) =>
      (organization.venues || []).map((venue) => ({ ...venue, organizationName: organization.name }))
    );
  }

  async load() {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      const params = currentParams();
      this.projection = await authoringRepository.visitProjection(params);
      const sources = this.sourceChoices();
      if (!sources.some((source) => id(source.editorialReleaseId) === id(this.selectedReleaseId))) {
        this.selectedReleaseId = id(this.revision?.editorialSources?.[0]?.editorialReleaseId || sources[0]?.editorialReleaseId || "") || null;
        this.page = 1;
      }
      const venues = this.venueChoices();
      if (!venues.some((venue) => id(venue.id) === id(this.selectedVenueId))) {
        this.selectedVenueId = id(this.revision?.anchors?.[0]?.venue?.id || venues[0]?.id || "") || null;
      }
      await Promise.all([this.loadVenueTargets(false), this.loadContent(false)]);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Editor visita non disponibile";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async reloadProjection() {
    const params = currentParams();
    this.projection = await authoringRepository.visitProjection(params);
  }

  async loadVenueTargets(render = true) {
    if (!this.selectedVenueId) { this.venueTargets = null; if (render) this.render(); return; }
    try {
      this.venueTargets = await authoringRepository.venueTargets(this.selectedVenueId);
    } catch (error) {
      this.venueTargets = null;
      if (render) this.error = error instanceof Error ? error.message : "Target della Venue non disponibili";
    }
    if (render) this.render();
  }

  async loadContent(render = true) {
    if (!this.selectedReleaseId || !this.principal || !this.visitId) {
      this.content = null;
      if (render) this.render();
      return;
    }
    try {
      this.content = await authoringRepository.searchVisitContent({
        editorialReleaseId: this.selectedReleaseId,
        principalType: this.principal.type,
        principalId: this.principal.id,
        q: this.query,
        page: this.page,
        limit: 20,
      });
    } catch (error) {
      this.content = null;
      if (render) this.error = error instanceof Error ? error.message : "Contenuti della source non disponibili";
    }
    if (render) this.render();
  }

  serializeSources() {
    return (this.revision?.editorialSources || []).map((source) => ({
      _id: source.id,
      editorialReleaseId: source.editorialReleaseId,
    }));
  }

  serializeAnchors() {
    return (this.revision?.anchors || []).map((anchor) => ({
      _id: anchor.id,
      venueTargetId: anchor.venueTargetId,
    }));
  }

  serializeEntries(entries = this.revision?.entries || []) {
    return entries.map((entry) => ({
      _id: entry.id,
      editorialSourceId: entry.editorialSourceId,
      itemId: entry.itemId,
      itemEditionId: entry.itemEditionId,
      itemRevisionId: entry.itemRevisionId,
      deliveryAnchorId: entry.deliveryAnchorId || null,
      role: entry.role || "recommended",
    }));
  }

  sourceForRelease(releaseId) {
    return (this.revision?.editorialSources || []).find((source) => id(source.editorialReleaseId) === id(releaseId)) || null;
  }

  anchorForTarget(targetId) {
    return (this.revision?.anchors || []).find((anchor) => id(anchor.venueTargetId) === id(targetId)) || null;
  }

  matchingTarget(result) {
    if (!this.selectedVenueId || !result?.primarySubjectId) return null;
    return (this.venueTargets?.targets || []).find((target) => id(target.subject?.id) === id(result.primarySubjectId)) || null;
  }

  async ensureReferences(result, target) {
    let changed = false;
    const payload = {};
    if (!this.sourceForRelease(this.selectedReleaseId)) {
      payload.editorialSources = [...this.serializeSources(), { editorialReleaseId: this.selectedReleaseId }];
      changed = true;
    }
    if (target && !this.anchorForTarget(target.id)) {
      payload.visitAnchors = [...this.serializeAnchors(), { venueTargetId: target.id }];
      changed = true;
    }
    if (changed) {
      await authoringRepository.updateVisit(this.visitId, payload);
      await this.reloadProjection();
    }
    const source = this.sourceForRelease(this.selectedReleaseId);
    const anchor = target ? this.anchorForTarget(target.id) : null;
    if (!source) throw new Error("La source editoriale non è stata collegata alla visita");
    return { source, anchor };
  }

  async execute(callback, successMessage, { refreshContent = false } = {}) {
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      await callback();
      this.message = successMessage;
      await this.reloadProjection();
      if (refreshContent) await this.loadContent(false);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Operazione non riuscita";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  onSubmit = async (event) => {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;

    if (form.matches("form[data-create-visit]")) {
      event.preventDefault();
      const data = new FormData(form);
      await this.execute(async () => {
        const response = await authoringRepository.createVisit({
          ownerType: this.principal.type,
          ownerId: this.principal.id,
          title: String(data.get("title") || "").trim(),
          description: String(data.get("description") || "").trim(),
        });
        navigate(`/workspace/visit-authoring?visitId=${encodeURIComponent(response.visit._id)}`);
      }, "Bozza visita creata");
      return;
    }

    if (form.matches("form[data-visit-metadata]")) {
      event.preventDefault();
      const data = new FormData(form);
      await this.execute(() => authoringRepository.updateVisit(this.visitId, {
        title: String(data.get("title") || "").trim(),
        description: String(data.get("description") || "").trim(),
        presentationBaseline: {
          depthPreference: asNullableNumber(data.get("depthPreference")),
          languageComplexityPreference: asNullableNumber(data.get("languageComplexityPreference")),
          locale: String(data.get("locale") || "").trim() || null,
        },
      }), "Dati della visita aggiornati");
      return;
    }

    if (form.matches("form[data-visit-search]")) {
      event.preventDefault();
      const data = new FormData(form);
      this.query = String(data.get("q") || "").trim();
      this.page = 1;
      this.busy = true;
      this.error = null;
      this.render();
      await this.loadContent(false);
      this.busy = false;
      this.render();
    }
  };

  onChange = async (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target) return;

    if (target.matches("select[data-new-principal]")) {
      const [principalType, principalId] = target.value.split(":");
      navigate(`/workspace/visit-authoring?principalType=${encodeURIComponent(principalType)}&principalId=${encodeURIComponent(principalId)}`);
      return;
    }
    if (target.matches("select[data-source]")) {
      this.selectedReleaseId = target.value || null;
      this.page = 1;
      this.busy = true; this.error = null; this.render();
      await this.loadContent(false);
      this.busy = false; this.render();
      return;
    }
    if (target.matches("select[data-venue]")) {
      this.selectedVenueId = target.value || null;
      this.busy = true; this.error = null; this.render();
      await this.loadVenueTargets(false);
      this.busy = false; this.render();
      return;
    }
    if (target.matches("select[data-entry-role]")) {
      const entryId = target.dataset.entryRole;
      const entries = (this.revision?.entries || []).map((entry) => id(entry.id) === id(entryId) ? { ...entry, role: target.value } : entry);
      await this.execute(() => authoringRepository.updateVisit(this.visitId, { contentEntries: this.serializeEntries(entries) }), "Ruolo del contenuto aggiornato");
    }
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const back = target?.closest("button[data-back]");
    if (back) { navigate("/workspace"); return; }

    const addButton = target?.closest("button[data-add-content]");
    if (addButton) {
      const result = (this.content?.results || []).find((entry) => id(entry.itemRevisionId) === id(addButton.dataset.addContent));
      if (!result) return;
      const card = addButton.closest("article");
      const role = card?.querySelector("select[data-add-role]")?.value || "recommended";
      const targetMatch = this.matchingTarget(result);
      await this.execute(async () => {
        const refs = await this.ensureReferences(result, targetMatch);
        const entries = this.serializeEntries();
        entries.push({
          editorialSourceId: refs.source.id,
          itemId: result.itemId,
          itemEditionId: result.itemEditionId,
          itemRevisionId: result.itemRevisionId,
          deliveryAnchorId: refs.anchor?.id || null,
          role,
        });
        await authoringRepository.updateVisit(this.visitId, { contentEntries: entries });
      }, targetMatch ? `Contenuto aggiunto alla tappa ${targetMatch.label}` : "Contenuto associato aggiunto senza tappa", { refreshContent: true });
      return;
    }

    const removeButton = target?.closest("button[data-remove-entry]");
    if (removeButton) {
      const remaining = (this.revision?.entries || []).filter((entry) => id(entry.id) !== id(removeButton.dataset.removeEntry));
      const usedAnchors = new Set(remaining.map((entry) => id(entry.deliveryAnchorId)).filter(Boolean));
      const anchors = this.serializeAnchors().filter((anchor) => usedAnchors.has(id(anchor._id)));
      await this.execute(() => authoringRepository.updateVisit(this.visitId, {
        contentEntries: this.serializeEntries(remaining),
        visitAnchors: anchors,
      }), "Contenuto rimosso dalla visita", { refreshContent: true });
      return;
    }

    const moveButton = target?.closest("button[data-move-entry]");
    if (moveButton) {
      const entryId = moveButton.dataset.moveEntry;
      const direction = Number(moveButton.dataset.direction) || 0;
      const entries = [...(this.revision?.entries || [])];
      const index = entries.findIndex((entry) => id(entry.id) === id(entryId));
      const next = index + direction;
      if (index < 0 || next < 0 || next >= entries.length) return;
      [entries[index], entries[next]] = [entries[next], entries[index]];
      await this.execute(() => authoringRepository.updateVisit(this.visitId, { contentEntries: this.serializeEntries(entries) }), "Ordine della visita aggiornato");
      return;
    }

    const pageButton = target?.closest("button[data-content-page]");
    if (pageButton) {
      this.page = Math.max(1, Number(pageButton.dataset.contentPage) || 1);
      this.busy = true; this.error = null; this.render();
      await this.loadContent(false);
      this.busy = false; this.render();
      return;
    }

    const workflow = target?.closest("button[data-workflow]");
    if (workflow) {
      const operationCode = workflow.dataset.workflow;
      const payload = {};
      if (workflow.dataset.requiresMessage === "true") {
        const message = window.prompt("Motivazione delle modifiche richieste:");
        if (message === null) return;
        if (!message.trim()) { this.error = "La motivazione è obbligatoria."; this.render(); return; }
        payload.message = message.trim();
      }
      await this.execute(() => marketplaceRepository.executeWorkspaceOperation({
        operationCode,
        sourceRef: { resourceType: "visit", resourceId: this.visitId },
        targetPrincipal: { type: this.principal.type, id: this.principal.id },
        payload,
      }), "Workflow visita aggiornato");
    }
  };

  renderPrincipalSelector() {
    const options = (this.projection?.availablePrincipals || []).map((principal) => {
      const value = `${principal.type}:${principal.id}`;
      const selected = principal.type === this.principal?.type && id(principal.id) === id(this.principal?.id);
      const role = principal.type === "organization" ? ` · ${principal.role}` : "";
      return `<option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(principal.name)}${escapeHtml(role)}</option>`;
    }).join("");
    return `<label>Proprietario della nuova visita <select data-new-principal>${options}</select></label>`;
  }

  renderCreate() {
    return `<main><button type="button" data-back>← Workspace</button><h1>Crea visita</h1>
      <p>La bozza viene creata nel dominio VisitV2. Source editoriali, contenuti e tappe vengono collegati successivamente usando gli stessi riferimenti che saranno pubblicati.</p>
      <form data-create-visit>${this.renderPrincipalSelector()}
        <label>Titolo <input name="title" required maxlength="160"></label>
        <label>Descrizione <textarea name="description" rows="4"></textarea></label>
        <button type="submit" ${this.busy ? "disabled" : ""}>Crea bozza</button>
      </form>${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}</main>`;
  }

  renderWorkflow() {
    const operations = (this.projection?.availableOperations || []).filter((operation) => operation.code.startsWith("workflow."));
    if (!operations.length) return "";
    return `<section><h2>Workflow editoriale</h2><p>Stato: <strong>${escapeHtml(this.revision?.status || "")}</strong> · integrità ${escapeHtml(this.revision?.integrity?.status || "")}</p><div class="actions">${operations.map((operation) => `<button type="button" data-workflow="${escapeHtml(operation.code)}" data-requires-message="${operation.requiresMessage ? "true" : "false"}" ${this.busy ? "disabled" : ""}>${escapeHtml(operation.label)}</button>`).join("")}</div>${(this.revision?.integrity?.issues || []).length ? `<ul class="issues">${this.revision.integrity.issues.map((issue) => `<li>${escapeHtml(issue.message || issue.code)}</li>`).join("")}</ul>` : ""}</section>`;
  }

  renderMetadata() {
    const baseline = this.revision?.presentationBaseline || {};
    if (!this.editable) return `<section><h2>Dati visita</h2><h3>${escapeHtml(this.revision?.title || "")}</h3><p>${escapeHtml(this.revision?.description || "")}</p><p>La revisione non è modificabile nello stato corrente.</p></section>`;
    return `<section><h2>Dati visita</h2><form data-visit-metadata class="metadata-grid">
      <label>Titolo <input name="title" required value="${escapeHtml(this.revision?.title || "")}"></label>
      <label>Descrizione <textarea name="description" rows="3">${escapeHtml(this.revision?.description || "")}</textarea></label>
      <label>Profondità di default (0–1) <input name="depthPreference" type="number" min="0" max="1" step="0.1" value="${escapeHtml(baseline.depthPreference ?? "")}"></label>
      <label>Complessità linguistica di default (0–1) <input name="languageComplexityPreference" type="number" min="0" max="1" step="0.1" value="${escapeHtml(baseline.languageComplexityPreference ?? "")}"></label>
      <label>Locale <input name="locale" value="${escapeHtml(baseline.locale || "it-IT")}" placeholder="it-IT"></label>
      <button type="submit" ${this.busy ? "disabled" : ""}>Salva dati visita</button>
    </form></section>`;
  }

  renderEntries() {
    const entries = this.revision?.entries || [];
    const rows = entries.map((entry, index) => `<li class="entry">
      <div><strong>${index + 1}. ${escapeHtml(entry.label)}</strong>${entry.deliveryTarget ? `<small>${escapeHtml(entry.deliveryTarget.venue?.name || "")} · ${escapeHtml(entry.deliveryTarget.label)}</small>` : `<small>Contenuto associato senza tappa fisica</small>`}<small>${escapeHtml((entry.authorCredits || []).join(", "))}${entry.license ? ` · ${escapeHtml(entry.license)}` : ""}</small></div>
      <label>Ruolo <select data-entry-role="${escapeHtml(entry.id)}" ${!this.editable || this.busy ? "disabled" : ""}><option value="core" ${entry.role === "core" ? "selected" : ""}>Core</option><option value="recommended" ${entry.role === "recommended" ? "selected" : ""}>Recommended</option><option value="optional" ${entry.role === "optional" ? "selected" : ""}>Optional</option></select></label>
      <div class="entry-actions"><button type="button" data-move-entry="${escapeHtml(entry.id)}" data-direction="-1" ${!this.editable || index === 0 || this.busy ? "disabled" : ""}>↑</button><button type="button" data-move-entry="${escapeHtml(entry.id)}" data-direction="1" ${!this.editable || index === entries.length - 1 || this.busy ? "disabled" : ""}>↓</button><button type="button" data-remove-entry="${escapeHtml(entry.id)}" ${!this.editable || this.busy ? "disabled" : ""}>Rimuovi</button></div>
    </li>`).join("");
    return `<section><h2>Sequenza della visita</h2><p>${entries.length} contenuti. L'ordine qui mostrato è l'ordine canonico di <code>contentEntries</code>.</p><ol class="entries">${rows || "<li>Nessun contenuto aggiunto.</li>"}</ol></section>`;
  }

  renderSourceAndVenueSelectors() {
    const sources = this.sourceChoices();
    const venues = this.venueChoices();
    const sourceOptions = sources.map((source) => `<option value="${escapeHtml(source.editorialReleaseId)}" ${id(source.editorialReleaseId) === id(this.selectedReleaseId) ? "selected" : ""}>${escapeHtml(source.name)} · ${escapeHtml(source.ownership)}</option>`).join("");
    const venueOptions = venues.map((venue) => `<option value="${escapeHtml(venue.id)}" ${id(venue.id) === id(this.selectedVenueId) ? "selected" : ""}>${escapeHtml(venue.name)} · ${escapeHtml(venue.organizationName)}</option>`).join("");
    return `<div class="selectors"><label>Source editoriale <select data-source ${!this.editable ? "disabled" : ""}>${sourceOptions || "<option value=''>Nessuna source disponibile</option>"}</select></label><label>Venue corrente <select data-venue ${!this.editable ? "disabled" : ""}>${venueOptions || "<option value=''>Nessuna Venue disponibile</option>"}</select></label></div>`;
  }

  renderContentSearch() {
    if (!this.editable) return "";
    if (!this.selectedReleaseId) return `<section><h2>Aggiungi contenuti</h2><p>Nessuna EditorialRelease con capability <code>context.compose_visit</code> è disponibile per questo principal.</p></section>`;
    const results = this.content?.results || [];
    const existingRevisions = new Set((this.revision?.entries || []).map((entry) => id(entry.itemRevisionId)));
    const cards = results.map((result) => {
      const target = this.matchingTarget(result);
      const alreadyAdded = existingRevisions.has(id(result.itemRevisionId));
      const profileCount = (result.presentationProfiles || []).length;
      const action = target ? `Aggiungi alla tappa ${target.label}` : "Aggiungi come contenuto associato";
      return `<article class="candidate"><div><h3>${escapeHtml(result.label)}</h3><p>${escapeHtml((result.authorCredits || []).join(", "))}${result.license ? ` · ${escapeHtml(result.license)}` : ""}</p><p>${profileCount} profili di presentazione disponibili${target ? ` · oggetto presente nella Venue: ${escapeHtml(target.label)}` : " · nessun target fisico corrispondente nella Venue corrente"}</p></div><label>Ruolo <select data-add-role><option value="core">Core</option><option value="recommended" selected>Recommended</option><option value="optional">Optional</option></select></label><button type="button" data-add-content="${escapeHtml(result.itemRevisionId)}" ${alreadyAdded || this.busy ? "disabled" : ""}>${alreadyAdded ? "Già presente" : escapeHtml(action)}</button></article>`;
    }).join("");
    const page = Number(this.content?.page) || 1;
    const limit = Number(this.content?.limit) || 20;
    const total = Number(this.content?.total) || 0;
    return `<section><h2>Aggiungi contenuti</h2>${this.renderSourceAndVenueSelectors()}<form data-visit-search role="search"><label>Cerca nella source <input name="q" value="${escapeHtml(this.query)}" placeholder="Titolo del contenuto"></label><button type="submit" ${this.busy ? "disabled" : ""}>Cerca</button></form><p>${total} contenuti disponibili nella source. I risultati sono paginati server-side.</p><div class="candidates">${cards || "<p>Nessun contenuto trovato.</p>"}</div><nav class="pagination" aria-label="Pagine contenuti"><button type="button" data-content-page="${page - 1}" ${page <= 1 || this.busy ? "disabled" : ""}>Precedente</button><span>Pagina ${page}</span><button type="button" data-content-page="${page + 1}" ${page * limit >= total || this.busy ? "disabled" : ""}>Successiva</button></nav></section>`;
  }

  render() {
    if (this.busy && !this.projection) { this.innerHTML = `<main><p>Caricamento editor visita…</p></main>`; return; }
    if (!this.projection) { this.innerHTML = `<main><p role="alert">${escapeHtml(this.error || "Editor visita non disponibile")}</p></main>`; return; }
    if (!this.visitId) { this.innerHTML = this.styles() + this.renderCreate(); return; }
    this.innerHTML = `${this.styles()}<main><button type="button" data-back>← Workspace</button><p class="eyebrow">Visit editor · ${escapeHtml(this.principal?.name || this.principal?.type || "")}</p><h1>${escapeHtml(this.revision?.title || "Visita")}</h1>${this.message ? `<p role="status">${escapeHtml(this.message)}</p>` : ""}${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderWorkflow()}${this.renderMetadata()}${this.renderEntries()}${this.renderContentSearch()}</main>`;
  }

  styles() {
    return `<style>main{max-width:72rem;margin:0 auto;padding:2rem 1rem}section{margin-block:2rem;padding-top:1rem;border-top:1px solid currentColor}form{display:grid;gap:.85rem}label{display:grid;gap:.3rem}.metadata-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.metadata-grid label:nth-child(-n+2){grid-column:1/-1}.selectors{display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-block:1rem}.actions,.entry-actions{display:flex;gap:.5rem;flex-wrap:wrap}.entries{display:grid;gap:.75rem;padding-left:1.4rem}.entry,.candidate{padding:1rem;border:1px solid currentColor}.entry{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:1rem;align-items:center}.entry small{display:block;margin-top:.25rem;opacity:.75}.candidates{display:grid;gap:.75rem}.candidate{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:1rem;align-items:end}.candidate h3{margin-top:0}.issues{padding-left:1.2rem}.pagination{display:flex;justify-content:space-between;align-items:center;margin-top:1rem}.eyebrow{text-transform:uppercase;font-size:.8rem;letter-spacing:.05em}button,input,select,textarea{font:inherit;padding:.55rem .7rem}code{font-size:.9em}@media(max-width:50rem){.metadata-grid,.selectors,.entry,.candidate{grid-template-columns:1fr}.metadata-grid label:nth-child(-n+2){grid-column:auto}}</style>`;
  }
}

customElements.define("artaround-visit-authoring-view", ArtAroundVisitAuthoringView);
