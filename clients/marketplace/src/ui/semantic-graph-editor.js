import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";
import "./semantic-subject-source-browser.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function classIds(entry) { return (entry?.subjectClassDefinitionIds || []).map(String); }

export class ArtAroundSemanticGraphEditor extends HTMLElement {
  editorialContextId = null;
  relationTypes = [];
  subjectClasses = [];
  editable = false;
  locked = false;
  data = null;
  focusSubjectId = null;
  selected = null;
  pickerMode = null;
  inventoryData = null;
  inventoryQuery = "";
  inventoryPage = 1;
  inventoryPageSize = 12;
  inventoryBusy = false;
  relationDraft = null;
  visibleNeighborLimit = 18;
  busy = false;
  error = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("dblclick", this.onDoubleClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onChange);
    this.addEventListener("keydown", this.onKeyDown);
    this.addEventListener("subject-selected", this.onSubjectSelected);
    void this.load();
  }

  disconnectedCallback() {
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("dblclick", this.onDoubleClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("keydown", this.onKeyDown);
    this.removeEventListener("subject-selected", this.onSubjectSelected);
  }

  configure({ editorialContextId, relationTypes = [], subjectClasses = [], editable = false, locked = false } = {}) {
    const changed = this.editorialContextId && editorialContextId && this.editorialContextId !== editorialContextId;
    this.editorialContextId = editorialContextId || null;
    this.relationTypes = relationTypes || [];
    this.subjectClasses = subjectClasses || [];
    this.editable = editable === true;
    this.locked = locked === true;
    if (changed) this.resetWorkspace();
    if (this.isConnected) void this.load();
  }

  resetWorkspace() {
    this.focusSubjectId = null;
    this.selected = null;
    this.pickerMode = null;
    this.inventoryData = null;
    this.inventoryQuery = "";
    this.inventoryPage = 1;
    this.relationDraft = null;
    this.visibleNeighborLimit = 18;
  }

  async fetchNeighborhood() {
    this.data = await editorialRepository.graphNeighborhood(this.editorialContextId, {
      view: "working",
      focusSubjectId: this.focusSubjectId,
      limit: this.visibleNeighborLimit,
    });
  }

  async load() {
    if (!this.editorialContextId) { this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await this.fetchNeighborhood();
      if (this.focusSubjectId && !this.subjectEntry(this.focusSubjectId)) {
        this.focusSubjectId = null;
        this.selected = null;
        await this.fetchNeighborhood();
      }
      if (this.selected?.kind === "subject" && !this.subjectEntry(this.selected.id)) this.selected = null;
      if (this.selected?.kind === "edge" && !this.edgeById(this.selected.id)) this.selected = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è possibile caricare il grafo semantico";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async loadInventory() {
    if (!this.editorialContextId || !["focus", "target"].includes(this.pickerMode)) return;
    this.inventoryBusy = true;
    this.error = null;
    this.render();
    try {
      this.inventoryData = await editorialRepository.graphSubjectCandidates(this.editorialContextId, {
        scope: "graph",
        q: this.inventoryQuery,
        page: this.inventoryPage,
        limit: this.inventoryPageSize,
      });
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Inventario semantico non disponibile";
    } finally {
      this.inventoryBusy = false;
      this.render();
    }
  }

  graphSubjects() { return this.data?.subjects || []; }
  subjectEntry(subjectId) { return this.graphSubjects().find((entry) => id(entry.subject) === id(subjectId)) || null; }
  subject(subjectId) { return this.subjectEntry(subjectId)?.subject || null; }
  edgeById(edgeId) { return (this.data?.edges || []).find((edge) => id(edge.id) === id(edgeId)) || null; }
  relationById(definitionId) { return (this.relationTypes || []).find((entry) => String(entry.definitionId) === String(definitionId)) || null; }
  classById(definitionId) { return (this.subjectClasses || []).find((entry) => String(entry.definitionId) === String(definitionId)) || null; }
  relationCount(subjectId) {
    const entry = this.subjectEntry(subjectId);
    if (Number.isFinite(Number(entry?.relationCount))) return Number(entry.relationCount);
    return (this.data?.edges || []).filter((edge) => id(edge.sourceSubjectId) === id(subjectId) || id(edge.targetSubjectId) === id(subjectId)).length;
  }

  focusNeighborhood() {
    if (!this.focusSubjectId) return { edges: [], neighbors: [], totalNeighbors: 0, hiddenNeighbors: 0 };
    const edges = this.data?.edges || [];
    const neighbors = this.graphSubjects().filter((entry) => id(entry.subject) !== id(this.focusSubjectId)).map((entry) => {
      const relevant = edges.filter((edge) => id(edge.sourceSubjectId) === id(entry.subject) || id(edge.targetSubjectId) === id(entry.subject));
      const directions = new Set(relevant.map((edge) => id(edge.sourceSubjectId) === id(this.focusSubjectId) ? "outgoing" : "incoming"));
      return { ...entry, direction: directions.size > 1 ? "mixed" : [...directions][0] || "mixed" };
    });
    return {
      neighbors,
      edges,
      totalNeighbors: Number(this.data?.neighborhood?.totalNeighbors || neighbors.length),
      hiddenNeighbors: Number(this.data?.neighborhood?.hiddenNeighbors || 0),
    };
  }

  layoutNeighborhood(neighborhood) {
    const width = 900, height = 520;
    const positions = new Map([[id(this.focusSubjectId), { x: 450, y: 260 }]]);
    const groups = {
      incoming: neighborhood.neighbors.filter((entry) => entry.direction === "incoming"),
      outgoing: neighborhood.neighbors.filter((entry) => entry.direction === "outgoing"),
      mixed: neighborhood.neighbors.filter((entry) => entry.direction === "mixed"),
    };
    const placeVertical = (entries, x) => entries.forEach((entry, index) => {
      const step = height / (entries.length + 1);
      positions.set(id(entry.subject), { x, y: step * (index + 1) });
    });
    placeVertical(groups.incoming, 175);
    placeVertical(groups.outgoing, 725);
    groups.mixed.forEach((entry, index) => {
      const upper = index % 2 === 0;
      const row = Math.floor(index / 2);
      positions.set(id(entry.subject), { x: 450 + (row % 2 ? 120 : -120), y: upper ? 95 : 425 });
    });
    return positions;
  }

  async setFocus(subjectId) {
    const nextId = id(subjectId);
    if (!nextId) return;
    this.focusSubjectId = nextId;
    this.selected = null;
    this.pickerMode = null;
    this.inventoryData = null;
    this.inventoryQuery = "";
    this.inventoryPage = 1;
    this.relationDraft = null;
    this.visibleNeighborLimit = 18;
    await this.load();
    if (this.subjectEntry(nextId)) {
      this.selected = { kind: "subject", id: nextId };
      this.render();
    }
  }

  openInventory(mode) {
    this.pickerMode = mode;
    this.selected = null;
    this.relationDraft = null;
    this.inventoryData = null;
    this.inventoryQuery = "";
    this.inventoryPage = 1;
    this.render();
    void this.loadInventory();
  }

  closeInspector() {
    this.selected = null;
    this.pickerMode = null;
    this.inventoryData = null;
    this.inventoryQuery = "";
    this.inventoryPage = 1;
    this.relationDraft = null;
    this.render();
  }

  onInput = (event) => {
    const target = (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) ? event.target : null;
    if (!target || !this.relationDraft || !target.form?.matches("[data-relation-composer]")) return;
    if (target.name === "note") this.relationDraft.note = target.value;
    if (target.name === "weight") this.relationDraft.weight = target.value;
  };

  onChange = (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target || !this.relationDraft || !target.form?.matches("[data-relation-composer]")) return;
    if (target.name === "relationTypeDefinitionId") {
      this.relationDraft.relationTypeDefinitionId = target.value;
      this.render();
    }
  };

  onKeyDown = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const node = target?.closest("[data-graph-subject]");
    if (node && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      this.selected = { kind: "subject", id: node.dataset.graphSubject };
      this.render();
      return;
    }
    const edge = target?.closest("[data-graph-edge]");
    if (edge && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      this.openEdgeInspector(edge.dataset.graphEdge);
      return;
    }
    if (event.key === "Escape" && (this.selected || this.pickerMode || this.relationDraft)) {
      event.preventDefault();
      this.closeInspector();
    }
  };

  onDoubleClick = (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-graph-subject]") : null;
    if (!target) return;
    event.preventDefault();
    void this.setFocus(target.dataset.graphSubject);
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-close-graph-inspector]")) { this.closeInspector(); return; }
    if (target.closest("[data-choose-focus]")) { this.openInventory("focus"); return; }
    if (target.closest("[data-add-graph-subject]")) { this.pickerMode = "add-focus"; this.selected = null; this.relationDraft = null; this.render(); return; }
    if (target.closest("[data-start-relation]")) { this.openInventory("target"); return; }
    if (target.closest("[data-add-target-subject]")) { this.pickerMode = "add-target"; this.inventoryData = null; this.render(); return; }
    const inventorySubject = target.closest("[data-use-inventory-subject]");
    if (inventorySubject) {
      const row = (this.inventoryData?.results || []).find((entry) => id(entry.subject) === id(inventorySubject.dataset.useInventorySubject));
      if (!row?.subject) return;
      if (this.pickerMode === "target") this.startRelationTo(row.subject);
      else await this.setFocus(row.subject._id);
      return;
    }
    const inventoryPage = target.closest("[data-semantic-inventory-page]");
    if (inventoryPage) {
      this.inventoryPage = Math.max(1, Number(inventoryPage.dataset.semanticInventoryPage) || 1);
      await this.loadInventory();
      return;
    }
    const graphNode = target.closest("[data-graph-subject]");
    if (graphNode) { this.selected = { kind: "subject", id: graphNode.dataset.graphSubject }; this.pickerMode = null; this.relationDraft = null; this.render(); return; }
    const graphEdge = target.closest("[data-graph-edge]");
    if (graphEdge) { this.openEdgeInspector(graphEdge.dataset.graphEdge); return; }
    if (target.closest("[data-semantic-graph-canvas]")) { this.selected = null; this.render(); return; }
    const recenter = target.closest("[data-recenter-subject]");
    if (recenter) { await this.setFocus(recenter.dataset.recenterSubject); return; }
    if (target.closest("[data-show-more-neighbors]")) { this.visibleNeighborLimit = Math.min(100, this.visibleNeighborLimit + 18); await this.load(); return; }
    const removeSubject = target.closest("[data-remove-graph-subject]");
    if (removeSubject && this.editable && !this.locked) {
      const subject = this.subject(removeSubject.dataset.removeGraphSubject);
      const confirmed = await openActionDialog({
        title: `Rimuovere “${subject?.preferredLabel || "questo soggetto"}” dal grafo?`,
        message: "Il Subject globale e gli eventuali contenuti resteranno invariati. Il soggetto può essere rimosso solo se non è usato da relazioni.",
        confirmLabel: "Rimuovi dal grafo",
        tone: "danger",
      });
      if (confirmed) await this.mutate(() => editorialRepository.removeGraphSubject(this.editorialContextId, removeSubject.dataset.removeGraphSubject), { clearSelection: true, resetFocus: id(removeSubject.dataset.removeGraphSubject) === id(this.focusSubjectId) });
      return;
    }
    const removeEdge = target.closest("[data-remove-edge]");
    if (removeEdge && this.editable && !this.locked) {
      const confirmed = await openActionDialog({
        title: "Rimuovere questa relazione?",
        message: "La modifica produrrà una nuova revisione del grafo condiviso. Le raccolte già in revisione o pubblicate resteranno pinzate alla revisione precedente.",
        confirmLabel: "Rimuovi relazione",
        tone: "danger",
      });
      if (confirmed) await this.mutate(() => editorialRepository.removeGraphEdge(this.editorialContextId, removeEdge.dataset.removeEdge), { clearSelection: true });
    }
  };

  onSubjectSelected = async (event) => {
    if (!event.detail?.subject || !["add-focus", "add-target"].includes(this.pickerMode)) return;
    event.stopPropagation();
    const subject = event.detail.subject;
    if (this.pickerMode === "add-target") this.startRelationTo(subject);
    else await this.addSubjectAndFocus(subject);
  };

  async addSubjectAndFocus(subject) {
    const subjectId = id(subject);
    if (!subjectId) return;
    await this.mutate(() => editorialRepository.addGraphSubject(this.editorialContextId, subjectId), {
      beforeReload: () => { this.focusSubjectId = subjectId; },
      after: () => { this.selected = { kind: "subject", id: subjectId }; this.pickerMode = null; },
    });
  }

  startRelationTo(subject) {
    const targetSubjectId = id(subject);
    if (!this.focusSubjectId || !targetSubjectId || id(this.focusSubjectId) === targetSubjectId) return;
    this.pickerMode = null;
    this.inventoryData = null;
    this.selected = null;
    this.relationDraft = {
      mode: "create",
      sourceSubjectId: id(this.focusSubjectId),
      targetSubjectId,
      targetSubject: subject,
      relationTypeDefinitionId: String(this.relationTypes?.[0]?.definitionId || ""),
      note: "",
      weight: "1",
    };
    this.render();
  }

  openEdgeInspector(edgeId) {
    const edge = this.edgeById(edgeId);
    if (!edge) return;
    this.selected = { kind: "edge", id: id(edge.id) };
    this.pickerMode = null;
    this.relationDraft = {
      mode: "edit",
      edgeId: id(edge.id),
      sourceSubjectId: id(edge.sourceSubjectId),
      targetSubjectId: id(edge.targetSubjectId),
      relationTypeDefinitionId: String(edge.relationTypeDefinitionId || ""),
      note: String(edge.metadata?.note || ""),
      weight: String(edge.weight ?? 1),
    };
    this.render();
  }

  async onSubmit(event) {
    const form = event.target instanceof HTMLFormElement ? event.target : null;
    if (!form) return;
    if (form.matches("[data-semantic-inventory-search]")) {
      event.preventDefault();
      this.inventoryQuery = String(new FormData(form).get("q") || "").trim();
      this.inventoryPage = 1;
      await this.loadInventory();
      return;
    }
    if (!this.editable || this.locked) return;
    if (form.matches("[data-classes-form]")) {
      event.preventDefault();
      const data = new FormData(form);
      await this.mutate(() => editorialRepository.setSubjectClasses(this.editorialContextId, form.dataset.subjectId, data.getAll("subjectClassDefinitionIds").map(String)));
      return;
    }
    if (!form.matches("[data-relation-composer]")) return;
    event.preventDefault();
    const data = new FormData(form);
    const relationTypeDefinitionId = String(data.get("relationTypeDefinitionId") || "");
    const note = String(data.get("note") || "").trim();
    const assignments = this.classAssignmentsForForm(data, relationTypeDefinitionId, this.relationDraft.sourceSubjectId, this.relationDraft.targetSubjectId);
    const payload = {
      relationTypeDefinitionId,
      weight: Number(data.get("weight") || 1),
      metadata: note ? { note } : null,
      subjectClassAssignments: assignments,
    };
    if (this.relationDraft.mode === "create") {
      payload.sourceSubjectId = this.relationDraft.sourceSubjectId;
      payload.targetSubjectId = this.relationDraft.targetSubjectId;
      await this.mutate(() => editorialRepository.addGraphEdge(this.editorialContextId, payload), { clearSelection: true });
    } else {
      await this.mutate(() => editorialRepository.updateGraphEdge(this.editorialContextId, this.relationDraft.edgeId, payload), { clearSelection: true });
    }
  }

  classAssignmentsForForm(data, relationTypeDefinitionId, sourceSubjectId, targetSubjectId) {
    const relation = this.relationById(relationTypeDefinitionId);
    if (!relation) return [];
    const result = [];
    for (const [role, subjectId, allowed] of [
      ["source", sourceSubjectId, relation.domainDefinitionIds || []],
      ["target", targetSubjectId, relation.rangeDefinitionIds || []],
    ]) {
      const existing = classIds(this.subjectEntry(subjectId));
      if (!allowed.length || allowed.some((definitionId) => existing.includes(String(definitionId)))) continue;
      const chosen = String(data.get(`${role}RequiredClass`) || "");
      if (!chosen) continue;
      result.push({ subjectId, subjectClassDefinitionIds: [...new Set([...existing, chosen])] });
    }
    return result;
  }

  async mutate(operation, { beforeReload = null, after = null, clearSelection = false, resetFocus = false } = {}) {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await operation();
      if (resetFocus) this.focusSubjectId = null;
      beforeReload?.();
      await this.fetchNeighborhood();
      if (clearSelection) {
        this.selected = null;
        this.pickerMode = null;
        this.inventoryData = null;
        this.relationDraft = null;
      }
      after?.();
      this.dispatchEvent(new CustomEvent("editorial-graph-changed", { bubbles: true }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Modifica del grafo non completata";
    } finally {
      this.busy = false;
      this.render();
    }
  }

  renderCanvas() {
    if (!this.focusSubjectId) {
      const totalSubjects = Number(this.data?.neighborhood?.totalSubjects || 0);
      return `<div class="semantic-graph-empty" data-semantic-graph-canvas><div><span class="eyebrow">Grafo semantico</span><h3>Nessun soggetto di contesto</h3><p>${totalSubjects ? `Il grafo contiene ${totalSubjects} soggetti. Scegline uno per visualizzare soltanto i suoi collegamenti diretti.` : "Aggiungi o scegli un soggetto per iniziare a costruire le relazioni."}</p><div class="button-row"><button type="button" data-choose-focus>${icon("search", { size: 16 })} Scegli soggetto</button>${this.editable && !this.locked ? `<button type="button" class="button-secondary" data-add-graph-subject>${icon("plus", { size: 16 })} Aggiungi soggetto</button>` : ""}</div></div></div>`;
    }
    const focus = this.subject(this.focusSubjectId);
    if (!focus) return `<div class="empty-state"><p>Il soggetto di contesto non è più disponibile.</p></div>`;
    const neighborhood = this.focusNeighborhood();
    const positions = this.layoutNeighborhood(neighborhood);
    const focusPosition = positions.get(id(this.focusSubjectId));
    const edgeMarkup = neighborhood.edges.map((edge) => {
      const from = positions.get(id(edge.sourceSubjectId));
      const to = positions.get(id(edge.targetSubjectId));
      if (!from || !to) return "";
      const relation = this.relationById(edge.relationTypeDefinitionId);
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const selected = this.selected?.kind === "edge" && id(this.selected.id) === id(edge.id);
      return `<g class="semantic-edge${selected ? " selected" : ""}" data-graph-edge="${escapeHtml(id(edge.id))}" tabindex="0" role="button" aria-label="${escapeHtml(relation?.label || "Relazione")}"><line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" marker-end="url(#semantic-arrow)"></line><text x="${mx}" y="${my - 9}" text-anchor="middle">${escapeHtml(relation?.label || edge.relationTypeDefinitionId)}</text></g>`;
    }).join("");
    const nodeMarkup = neighborhood.neighbors.map((entry) => {
      const subjectId = id(entry.subject);
      const position = positions.get(subjectId);
      const selected = this.selected?.kind === "subject" && id(this.selected.id) === subjectId;
      const label = String(entry.subject?.preferredLabel || "Soggetto");
      const short = label.length > 24 ? `${label.slice(0, 22)}…` : label;
      return `<g class="semantic-node${selected ? " selected" : ""}" data-graph-subject="${escapeHtml(subjectId)}" tabindex="0" role="button" aria-label="${escapeHtml(label)}"><circle cx="${position.x}" cy="${position.y}" r="49"></circle><text x="${position.x}" y="${position.y + 4}" text-anchor="middle">${escapeHtml(short)}</text></g>`;
    }).join("");
    const focusSelected = this.selected?.kind === "subject" && id(this.selected.id) === id(this.focusSubjectId);
    const focusMarkup = `<g class="semantic-node semantic-node--focus${focusSelected ? " selected" : ""}" data-graph-subject="${escapeHtml(id(this.focusSubjectId))}" tabindex="0" role="button" aria-label="${escapeHtml(focus.preferredLabel || "Soggetto di contesto")}"><circle cx="${focusPosition.x}" cy="${focusPosition.y}" r="62"></circle><text x="${focusPosition.x}" y="${focusPosition.y + 4}" text-anchor="middle">${escapeHtml(String(focus.preferredLabel || "Soggetto").slice(0, 28))}</text></g>`;
    return `<div class="semantic-graph-canvas" data-semantic-graph-canvas><svg viewBox="0 0 900 520" role="img" aria-label="Relazioni dirette di ${escapeHtml(focus.preferredLabel || "soggetto")}"><defs><marker id="semantic-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z"></path></marker></defs>${edgeMarkup}${nodeMarkup}${focusMarkup}</svg>${neighborhood.hiddenNeighbors ? `<div class="semantic-graph-more"><span>${neighborhood.neighbors.length} di ${neighborhood.totalNeighbors} soggetti collegati mostrati</span><button type="button" class="button-secondary small" data-show-more-neighbors ${this.visibleNeighborLimit >= 100 ? "disabled" : ""}>Mostra altri</button></div>` : ""}</div>`;
  }

  renderToolbar() {
    if (!this.focusSubjectId) return "";
    const focus = this.subject(this.focusSubjectId);
    return `<div class="semantic-graph-toolbar"><div><span class="eyebrow">Soggetto di contesto</span><strong>${escapeHtml(focus?.preferredLabel || "Soggetto")}</strong></div><div class="button-row"><button type="button" class="button-secondary" data-choose-focus>${icon("search", { size: 15 })} Cambia soggetto</button>${this.editable && !this.locked ? `<button type="button" data-start-relation>${icon("link", { size: 15 })} Aggiungi relazione</button>` : ""}</div></div>`;
  }

  renderCoverage(entry) {
    const coverage = entry?.presentationCoverage || {};
    const collection = Number(coverage.collectionItemCount || 0);
    const space = Number(coverage.contentSpaceItemCount || 0);
    const artaround = Number(coverage.artaroundItemCount || 0);
    if (collection) return `<span class="status" data-tone="success">${collection} ${collection === 1 ? "contenuto nella raccolta" : "contenuti nella raccolta"}</span>`;
    if (space) return `<span class="status">${space} ${space === 1 ? "contenuto nello spazio" : "contenuti nello spazio"}</span>`;
    if (artaround) return `<span class="status">${artaround} ${artaround === 1 ? "contenuto in ArtAround" : "contenuti in ArtAround"}</span>`;
    return `<span class="status" data-tone="warning">Nessun contenuto disponibile</span>`;
  }

  renderInventoryPagination() {
    const pagination = this.inventoryData?.pagination || {};
    const page = Number(pagination.page || this.inventoryPage || 1);
    const totalPages = Number(pagination.totalPages || 0);
    if (totalPages <= 1) return "";
    return `<nav class="pagination" aria-label="Pagine dell'inventario semantico"><button type="button" data-semantic-inventory-page="${page - 1}" ${page <= 1 || this.inventoryBusy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page} di ${totalPages}</span><button type="button" data-semantic-inventory-page="${page + 1}" ${page >= totalPages || this.inventoryBusy ? "disabled" : ""}>Successiva →</button></nav>`;
  }

  renderInventoryPicker() {
    const targetMode = this.pickerMode === "target";
    const subjects = (this.inventoryData?.results || []).filter((entry) => !targetMode || id(entry.subject) !== id(this.focusSubjectId));
    return `<div class="context-workspace-inspector-layer"><aside class="context-workspace-inspector semantic-inventory-inspector" aria-label="Inventario semantico"><div class="section-heading"><div><span class="eyebrow">Inventario semantico</span><h2>${targetMode ? "Scegli il soggetto da collegare" : "Scegli il soggetto di contesto"}</h2></div><button type="button" class="button-secondary small" data-close-graph-inspector aria-label="Chiudi">×</button></div><form data-semantic-inventory-search role="search"><label>Cerca nel grafo<input name="q" value="${escapeHtml(this.inventoryQuery)}" placeholder="Nome del soggetto"></label><button type="submit" class="button-secondary" ${this.inventoryBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form><div class="semantic-inventory-list">${subjects.length ? subjects.map((entry) => `<button type="button" class="semantic-inventory-card" data-use-inventory-subject="${escapeHtml(id(entry.subject))}"><span><strong>${escapeHtml(entry.subject?.preferredLabel || "Soggetto")}</strong><small>${escapeHtml(entry.subject?.description || "")}</small></span><span class="semantic-inventory-meta">${Number(entry.relationCount || 0)} relazioni</span>${this.renderCoverage(entry)}</button>`).join("") : `<div class="empty-state compact"><p>${this.inventoryBusy ? "Ricerca in corso…" : this.inventoryQuery ? "Nessun soggetto corrispondente nel grafo." : "Il grafo non contiene ancora soggetti."}</p></div>`}</div>${this.renderInventoryPagination()}${this.editable && !this.locked ? `<div class="semantic-inventory-footer"><p>${targetMode ? "Il soggetto non è ancora nel grafo? Cercalo nei contenuti della raccolta, nello spazio editoriale o nell'identità semantica globale." : "Aggiungi un nuovo soggetto al grafo semantico."}</p><button type="button" class="button-secondary" ${targetMode ? "data-add-target-subject" : "data-add-graph-subject"}>${icon("plus", { size: 15 })} Aggiungi soggetto</button></div>` : ""}</aside></div>`;
  }

  renderAddSubjectPicker() {
    const targetMode = this.pickerMode === "add-target";
    return `<div class="context-workspace-inspector-layer"><aside class="context-workspace-inspector semantic-inventory-inspector" aria-label="Aggiungi soggetto"><div class="section-heading"><div><span class="eyebrow">Aggiungi soggetto</span><h2>${targetMode ? "Nuova destinazione" : "Nuovo soggetto nel grafo"}</h2></div><button type="button" class="button-secondary small" data-close-graph-inspector aria-label="Chiudi">×</button></div><artaround-semantic-subject-source-browser editorial-context-id="${escapeHtml(this.editorialContextId)}"></artaround-semantic-subject-source-browser></aside></div>`;
  }

  renderSubjectInspector() {
    const entry = this.subjectEntry(this.selected?.id);
    if (!entry) return "";
    const subject = entry.subject || {};
    const selectedClasses = new Set(classIds(entry));
    const relationCount = this.relationCount(subject._id);
    return `<div class="context-workspace-inspector-layer"><aside class="context-workspace-inspector semantic-subject-inspector" aria-label="Dettagli soggetto"><div class="section-heading"><div><span class="eyebrow">Soggetto</span><h2>${escapeHtml(subject.preferredLabel || "Soggetto")}</h2></div><button type="button" class="button-secondary small" data-close-graph-inspector aria-label="Chiudi">×</button></div>${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : ""}<div class="button-row">${this.renderCoverage(entry)}<span class="status">${relationCount} ${relationCount === 1 ? "relazione" : "relazioni"}</span></div>${this.subjectClasses.length ? `<form data-classes-form data-subject-id="${escapeHtml(id(subject))}"><fieldset ${this.editable && !this.locked ? "" : "disabled"}><legend>Tipo nel grafo</legend>${this.subjectClasses.map((definition) => `<label class="check"><input type="checkbox" name="subjectClassDefinitionIds" value="${escapeHtml(definition.definitionId)}" ${selectedClasses.has(String(definition.definitionId)) ? "checked" : ""}><span><strong>${escapeHtml(definition.label)}</strong>${definition.description ? `<small>${escapeHtml(definition.description)}</small>` : ""}</span></label>`).join("")}</fieldset>${this.editable && !this.locked ? `<button type="submit" class="button-secondary">Salva tipi</button>` : ""}</form>` : `<p class="note">Le regole editoriali non definiscono tipi di soggetto.</p>`}<div class="operations">${id(subject) !== id(this.focusSubjectId) ? `<button type="button" data-recenter-subject="${escapeHtml(id(subject))}">Mostra i suoi collegamenti</button>` : ""}${this.editable && !this.locked ? `<button type="button" class="button-secondary danger" data-remove-graph-subject="${escapeHtml(id(subject))}">${icon("trash", { size: 15 })} Rimuovi dal grafo</button>` : ""}</div></aside></div>`;
  }

  renderClassRequirement(subjectId, allowedDefinitionIds, role) {
    if (!allowedDefinitionIds?.length) return "";
    const entry = this.subjectEntry(subjectId);
    const existing = classIds(entry);
    const compatible = allowedDefinitionIds.find((definitionId) => existing.includes(String(definitionId)));
    if (compatible) return `<p class="relation-requirement-ok">${role === "source" ? "Partenza" : "Destinazione"}: ${escapeHtml(this.classById(compatible)?.label || compatible)} ✓</p>`;
    const name = `${role}RequiredClass`;
    const subjectLabel = this.subject(subjectId)?.preferredLabel || this.relationDraft?.targetSubject?.preferredLabel || "soggetto";
    if (allowedDefinitionIds.length === 1) {
      const definitionId = String(allowedDefinitionIds[0]);
      return `<label class="relation-class-confirm"><input type="checkbox" name="${name}" value="${escapeHtml(definitionId)}" checked required><span>Assegna a <strong>${escapeHtml(subjectLabel)}</strong> il tipo <strong>${escapeHtml(this.classById(definitionId)?.label || definitionId)}</strong> per questa relazione.</span></label>`;
    }
    return `<label>Tipo richiesto per ${role === "source" ? "la partenza" : "la destinazione"}<select name="${name}" required><option value="">Scegli…</option>${allowedDefinitionIds.map((definitionId) => `<option value="${escapeHtml(definitionId)}">${escapeHtml(this.classById(definitionId)?.label || definitionId)}</option>`).join("")}</select></label>`;
  }

  renderRelationComposer() {
    if (!this.relationDraft) return "";
    const draft = this.relationDraft;
    const source = this.subject(draft.sourceSubjectId);
    const target = this.subject(draft.targetSubjectId) || draft.targetSubject || {};
    const relation = this.relationById(draft.relationTypeDefinitionId);
    const relationOptions = (this.relationTypes || []).map((definition) => `<option value="${escapeHtml(definition.definitionId)}" ${String(definition.definitionId) === String(draft.relationTypeDefinitionId) ? "selected" : ""}>${escapeHtml(definition.label)}</option>`).join("");
    return `<div class="context-workspace-inspector-layer"><aside class="context-workspace-inspector semantic-relation-inspector" aria-label="${draft.mode === "create" ? "Nuova relazione" : "Modifica relazione"}"><div class="section-heading"><div><span class="eyebrow">${draft.mode === "create" ? "Nuova relazione" : "Relazione"}</span><h2>${escapeHtml(source?.preferredLabel || "Soggetto")} → ${escapeHtml(target?.preferredLabel || "Soggetto")}</h2></div><button type="button" class="button-secondary small" data-close-graph-inspector aria-label="Chiudi">×</button></div>${relationOptions ? `<form data-relation-composer><label>Tipo di relazione<select name="relationTypeDefinitionId" required>${relationOptions}</select></label>${relation ? `<section class="relation-requirements"><span class="eyebrow">Tipi richiesti dalle regole</span>${this.renderClassRequirement(draft.sourceSubjectId, relation.domainDefinitionIds || [], "source")}${this.renderClassRequirement(draft.targetSubjectId, relation.rangeDefinitionIds || [], "target")}</section>` : ""}<label>Nota<input name="note" maxlength="500" value="${escapeHtml(draft.note || "")}" placeholder="Facoltativa"></label><details><summary>Opzioni avanzate</summary><label>Peso della relazione<input name="weight" type="number" min="0" max="10" step=".5" value="${escapeHtml(draft.weight ?? 1)}"></label></details><div class="button-row"><button type="submit">${icon("check", { size: 15 })} ${draft.mode === "create" ? "Crea relazione" : "Salva relazione"}</button>${draft.mode === "edit" ? `<button type="button" class="button-secondary danger" data-remove-edge="${escapeHtml(draft.edgeId)}">${icon("trash", { size: 15 })} Rimuovi</button>` : ""}</div></form>` : `<div class="empty-state compact"><h3>Nessun tipo di relazione</h3><p>Le Regole editoriali non definiscono ancora relazioni utilizzabili.</p></div>`}</aside></div>`;
  }

  renderInspector() {
    if (this.relationDraft) return this.renderRelationComposer();
    if (["focus", "target"].includes(this.pickerMode)) return this.renderInventoryPicker();
    if (["add-focus", "add-target"].includes(this.pickerMode)) return this.renderAddSubjectPicker();
    if (this.selected?.kind === "subject") return this.renderSubjectInspector();
    return "";
  }

  render() {
    if (!this.editorialContextId) { this.innerHTML = `<div class="empty-state"><p>Preparazione del grafo…</p></div>`; return; }
    this.innerHTML = `<section class="semantic-graph-workspace" aria-busy="${this.busy}">${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderToolbar()}${this.renderCanvas()}</section>${this.renderInspector()}`;
  }
}

customElements.define("artaround-semantic-graph-editor", ArtAroundSemanticGraphEditor);
