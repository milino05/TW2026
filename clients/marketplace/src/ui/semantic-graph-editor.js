import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { mountModalInteraction } from "../application/modal-interaction.js";
import { openActionDialog } from "./feedback-primitives.js";
import { icon } from "./icons.js";
import {
  canonicalEndpoints,
  classesNeeded,
  compatibleRelationViews,
  edgeViewForFocus,
  relationViews,
} from "./semantic-relation-views.js";
import "./semantic-entity-picker.js";
import "./semantic-subject-source-browser.js";

function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function id(value) { return String(value?._id || value?.id || value || ""); }
function classIds(entry) { return (entry?.subjectClassDefinitionIds || []).map(String); }
function intersects(left = [], right = []) { const wanted = new Set((right || []).map(String)); return (left || []).map(String).some((value) => wanted.has(value)); }

export class ArtAroundSemanticGraphEditor extends HTMLElement {
  editorialContextId = null;
  semanticGraphId = null;
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
  browserMode = null;
  browserSource = "collection";
  relationFlow = null;
  relationQuery = "";
  classificationPromptSubjectId = null;
  skippedClassification = new Set();
  visibleNeighborLimit = 18;
  renderedFocusSubjectId = null;
  subjectClickTimer = null;
  busy = false;
  error = null;
  modalInteraction = null;
  modalLayer = null;
  modalListeners = null;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    this.addEventListener("dblclick", this.onDoubleClick);
    this.addEventListener("submit", this.onSubmit);
    this.addEventListener("input", this.onInput);
    this.addEventListener("change", this.onChange);
    this.addEventListener("keydown", this.onKeyDown);
    this.addEventListener("subject-selected", this.onSubjectSelected);
    this.addEventListener("subject-browser-action", this.onSubjectBrowserAction);
    void this.load();
  }

  disconnectedCallback() {
    this.clearSubjectClickTimer();
    this.releaseModalInteraction({ restoreFocus: false });
    this.removeEventListener("click", this.onClick);
    this.removeEventListener("dblclick", this.onDoubleClick);
    this.removeEventListener("submit", this.onSubmit);
    this.removeEventListener("input", this.onInput);
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("keydown", this.onKeyDown);
    this.removeEventListener("subject-selected", this.onSubjectSelected);
    this.removeEventListener("subject-browser-action", this.onSubjectBrowserAction);
  }

  configure({ editorialContextId = null, semanticGraphId = null, relationTypes: types = [], subjectClasses: classes = [], editable = false, locked = false, initialFocusSubjectId = null } = {}) {
    const nextContextId = editorialContextId || null;
    const nextGraphId = semanticGraphId || null;
    if (nextContextId && nextGraphId) throw new Error("Il graph editor richiede editorialContextId oppure semanticGraphId, non entrambi");
    const changed = id(this.editorialContextId) !== id(nextContextId) || id(this.semanticGraphId) !== id(nextGraphId);
    this.editorialContextId = nextContextId;
    this.semanticGraphId = nextGraphId;
    this.relationTypes = types || [];
    this.subjectClasses = classes || [];
    this.editable = editable === true;
    this.locked = locked === true;
    if (changed) {
      this.resetWorkspace();
      if (initialFocusSubjectId) this.focusSubjectId = id(initialFocusSubjectId);
    } else if (initialFocusSubjectId && !this.focusSubjectId) this.focusSubjectId = id(initialFocusSubjectId);
    if (this.isConnected) void this.load();
  }

  standaloneMode() { return Boolean(this.semanticGraphId && !this.editorialContextId); }
  collectionMode() { return Boolean(this.editorialContextId && !this.semanticGraphId); }
  hasResource() { return Boolean(this.editorialContextId || this.semanticGraphId); }
  legacyRelationMode() { return Boolean(this.relationTypes.length) && this.relationTypes.every((entry) => !entry.directionality); }

  clearSubjectClickTimer() {
    if (this.subjectClickTimer === null) return;
    window.clearTimeout(this.subjectClickTimer);
    this.subjectClickTimer = null;
  }

  resetWorkspace() {
    this.clearSubjectClickTimer();
    this.data = null;
    this.focusSubjectId = null;
    this.selected = null;
    this.pickerMode = null;
    this.inventoryData = null;
    this.inventoryQuery = "";
    this.inventoryPage = 1;
    this.browserMode = null;
    this.relationFlow = null;
    this.relationQuery = "";
    this.classificationPromptSubjectId = null;
    this.skippedClassification = new Set();
    this.visibleNeighborLimit = 18;
    this.renderedFocusSubjectId = null;
  }

  fetchNeighborhood() {
    return this.standaloneMode()
      ? editorialRepository.semanticGraphNeighborhood(this.semanticGraphId, { focusSubjectId: this.focusSubjectId, limit: this.visibleNeighborLimit })
      : editorialRepository.graphNeighborhood(this.editorialContextId, { view: "working", focusSubjectId: this.focusSubjectId, limit: this.visibleNeighborLimit });
  }

  // Legacy inventory remains as graceful degradation for old relation definitions and is also
  // the canonical target browser for standalone graphs, which have no Collection subject scope.
  fetchInventory() {
    if (this.standaloneMode()) {
      return editorialRepository.semanticGraphSubjects(this.semanticGraphId, {
        q: this.inventoryQuery,
        page: this.inventoryPage,
        limit: this.inventoryPageSize,
      });
    }
    return editorialRepository.graphSubjectCandidates(this.editorialContextId, {
      scope: this.pickerMode === "target" ? "space" : "collection",
      q: this.inventoryQuery,
      page: this.inventoryPage,
      limit: this.inventoryPageSize,
    });
  }

  addSubject(subjectId) {
    return this.standaloneMode()
      ? editorialRepository.addStandaloneGraphSubject(this.semanticGraphId, subjectId)
      : editorialRepository.addGraphSubject(this.editorialContextId, subjectId);
  }

  removeSubject(subjectId) {
    return this.standaloneMode()
      ? editorialRepository.removeStandaloneGraphSubject(this.semanticGraphId, subjectId)
      : editorialRepository.removeGraphSubject(this.editorialContextId, subjectId);
  }

  setSubjectClasses(subjectId, subjectClassDefinitionIds) {
    return this.standaloneMode()
      ? editorialRepository.setStandaloneGraphSubjectClasses(this.semanticGraphId, subjectId, subjectClassDefinitionIds)
      : editorialRepository.setSubjectClasses(this.editorialContextId, subjectId, subjectClassDefinitionIds);
  }

  addEdge(payload) {
    return this.standaloneMode()
      ? editorialRepository.addStandaloneGraphEdge(this.semanticGraphId, payload)
      : editorialRepository.addGraphEdge(this.editorialContextId, payload);
  }

  updateEdge(edgeId, payload) {
    return this.standaloneMode()
      ? editorialRepository.updateStandaloneGraphEdge(this.semanticGraphId, edgeId, payload)
      : editorialRepository.updateGraphEdge(this.editorialContextId, edgeId, payload);
  }

  removeEdge(edgeId) {
    return this.standaloneMode()
      ? editorialRepository.removeStandaloneGraphEdge(this.semanticGraphId, edgeId)
      : editorialRepository.removeGraphEdge(this.editorialContextId, edgeId);
  }

  async load() {
    if (!this.hasResource()) { this.render(); return; }
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.data = await this.fetchNeighborhood();
      if (this.focusSubjectId && !this.subjectEntry(this.focusSubjectId)) {
        this.focusSubjectId = null;
        this.dispatchFocusChanged();
        this.selected = null;
        this.data = await this.fetchNeighborhood();
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
    if (!this.hasResource() || !["focus", "target", "relation-target"].includes(this.pickerMode)) return;
    this.inventoryBusy = true;
    this.error = null;
    this.render();
    try { this.inventoryData = await this.fetchInventory(); }
    catch (error) { this.error = error instanceof Error ? error.message : "Inventario semantico non disponibile"; }
    finally { this.inventoryBusy = false; this.render(); }
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

  dispatchFocusChanged() {
    this.dispatchEvent(new CustomEvent("semantic-graph-focus-changed", {
      detail: { focusSubjectId: this.focusSubjectId || null },
      bubbles: true,
      composed: true,
    }));
  }

  async setFocus(subjectId, { offerClassification = false } = {}) {
    const nextId = id(subjectId);
    if (!nextId) return;
    this.focusSubjectId = nextId;
    this.selected = null;
    this.pickerMode = null;
    this.browserMode = null;
    this.inventoryData = null;
    this.inventoryQuery = "";
    this.inventoryPage = 1;
    this.relationFlow = null;
    this.relationQuery = "";
    this.classificationPromptSubjectId = null;
    this.visibleNeighborLimit = 18;
    this.dispatchFocusChanged();
    await this.load();
    const entry = this.subjectEntry(nextId);
    if (offerClassification && entry && !classIds(entry).length && this.subjectClasses.length && this.editable && !this.locked && !this.skippedClassification.has(nextId)) {
      this.classificationPromptSubjectId = nextId;
      this.render();
    }
  }

  focusNeighborhood() {
    if (!this.focusSubjectId) return { edges: [], neighbors: [], totalNeighbors: 0, hiddenNeighbors: 0 };
    return {
      neighbors: this.graphSubjects().filter((entry) => id(entry.subject) !== id(this.focusSubjectId)),
      edges: this.data?.edges || [],
      totalNeighbors: Number(this.data?.neighborhood?.totalNeighbors || Math.max(0, this.graphSubjects().length - 1)),
      hiddenNeighbors: Number(this.data?.neighborhood?.hiddenNeighbors || 0),
    };
  }

  layoutNeighborhood(neighborhood) {
    const positions = new Map([[id(this.focusSubjectId), { x: 450, y: 260 }]]);
    const count = neighborhood.neighbors.length;
    neighborhood.neighbors.forEach((entry, index) => {
      const angle = count <= 1 ? 0 : (-Math.PI / 2) + (Math.PI * 2 * index / count);
      positions.set(id(entry.subject), {
        x: 450 + Math.cos(angle) * 300,
        y: 260 + Math.sin(angle) * 185,
      });
    });
    return positions;
  }

  openSubjectEditor(subjectId) {
    if (!this.subjectEntry(subjectId)) return;
    this.selected = { kind: "subject", id: id(subjectId) };
    this.browserMode = null;
    this.relationFlow = null;
    this.classificationPromptSubjectId = null;
    this.render();
  }

  openInventory(mode) {
    if (this.collectionMode()) {
      if (mode === "focus") this.openSubjectBrowser("focus", { source: "collection" });
      else this.openSubjectBrowser("legacy-target", { source: "space" });
      return;
    }
    this.pickerMode = mode;
    this.selected = null;
    this.browserMode = null;
    this.relationFlow = null;
    this.inventoryData = null;
    this.inventoryQuery = "";
    this.inventoryPage = 1;
    this.render();
    void this.loadInventory();
  }

  openStandaloneRelationTarget() {
    if (!this.standaloneMode() || !this.relationFlow) return;
    this.pickerMode = "relation-target";
    this.browserMode = null;
    this.selected = null;
    this.inventoryData = null;
    this.inventoryQuery = "";
    this.inventoryPage = 1;
    this.render();
    void this.loadInventory();
  }

  openSubjectBrowser(mode, { source = "collection" } = {}) {
    this.browserMode = mode;
    this.browserSource = source;
    this.pickerMode = mode === "legacy-target" ? "target" : null;
    this.selected = null;
    this.classificationPromptSubjectId = null;
    this.render();
  }

  startRelationFirst() {
    if (!this.focusSubjectId || !this.editable || this.locked) return;
    if (this.legacyRelationMode()) {
      this.openSubjectBrowser("legacy-target", { source: "space" });
      return;
    }
    this.relationFlow = {
      mode: "create",
      entryMode: "relation-first",
      step: "relation",
      viewKey: null,
      otherRow: null,
      note: "",
      weight: "1",
    };
    this.browserMode = null;
    this.relationQuery = "";
    this.render();
  }

  startTargetFirst(row) {
    if (!this.focusSubjectId || !row?.subject || id(row.subject) === id(this.focusSubjectId)) return;
    this.relationFlow = {
      mode: "create",
      entryMode: "target-first",
      step: "relation",
      viewKey: null,
      otherRow: row,
      note: "",
      weight: "1",
    };
    this.browserMode = null;
    this.relationQuery = "";
    this.render();
  }

  startLegacyRelationTo(row) {
    const targetSubjectId = id(row?.subject);
    if (!this.focusSubjectId || !targetSubjectId || targetSubjectId === id(this.focusSubjectId)) return;
    const targetItemCandidates = Array.isArray(row?.itemCandidates) ? row.itemCandidates : [];
    const targetNeedsCollectionItem = this.collectionMode() && Number(row?.presentationCoverage?.collectionItemCount || 0) === 0;
    this.relationFlow = {
      legacy: true,
      mode: "create",
      entryMode: "legacy-target-first",
      step: "confirm",
      relationTypeDefinitionId: String(this.relationTypes?.[0]?.definitionId || ""),
      otherRow: row,
      targetNeedsCollectionItem,
      targetItemCandidates,
      targetItemId: targetNeedsCollectionItem && targetItemCandidates.length === 1 ? id(targetItemCandidates[0].itemId) : "",
      note: "",
      weight: "1",
    };
    this.browserMode = null;
    this.pickerMode = null;
    this.render();
  }

  currentRelationView() {
    if (!this.relationFlow || this.relationFlow.legacy) return null;
    if (this.relationFlow.view) return this.relationFlow.view;
    return relationViews(this.relationTypes).find((entry) => entry.viewKey === this.relationFlow.viewKey) || null;
  }

  chooseRelationView(viewKey) {
    if (!this.relationFlow) return;
    const view = relationViews(this.relationTypes).find((entry) => entry.viewKey === viewKey);
    if (!view) return;
    this.relationFlow.viewKey = view.viewKey;
    this.relationFlow.view = view;
    if (this.relationFlow.entryMode === "relation-first") {
      this.relationFlow.step = "target";
      if (this.collectionMode()) this.openSubjectBrowser("relation-target", { source: "collection" });
      else this.openStandaloneRelationTarget();
      return;
    }
    this.relationFlow.step = "confirm";
    this.render();
  }

  openEdgeEditor(edgeId) {
    const edge = this.edgeById(edgeId);
    if (!edge || !this.focusSubjectId) return;
    const relation = this.relationById(edge.relationTypeDefinitionId);
    const viewed = edgeViewForFocus(edge, relation, this.focusSubjectId);
    if (!viewed) return;
    const viewKey = viewed.direction === "reverse"
      ? `${String(relation?.key || relation?.definitionId || "")}:reverse`
      : String(relation?.key || relation?.definitionId || "");
    const knownView = relationViews(this.relationTypes).find((entry) => entry.viewKey === viewKey) || {
      viewKey,
      relationTypeDefinitionId: String(edge.relationTypeDefinitionId),
      direction: viewed.direction,
      label: viewed.label,
      description: "",
      focusDefinitionIds: viewed.direction === "reverse" ? (relation?.rangeDefinitionIds || []) : (relation?.domainDefinitionIds || []),
      otherDefinitionIds: viewed.direction === "reverse" ? (relation?.domainDefinitionIds || []) : (relation?.rangeDefinitionIds || []),
      relation,
    };
    const otherEntry = this.subjectEntry(viewed.otherSubjectId);
    this.selected = { kind: "edge", id: id(edge.id) };
    this.relationFlow = {
      mode: "edit",
      entryMode: "edit",
      step: "confirm",
      edgeId: id(edge.id),
      viewKey,
      view: knownView,
      otherRow: otherEntry || { subject: this.subject(viewed.otherSubjectId), subjectClassDefinitionIds: [] },
      note: String(edge.metadata?.note || ""),
      weight: String(edge.weight ?? 1),
    };
    this.browserMode = null;
    this.relationQuery = "";
    this.render();
  }

  closeModal({ restoreFocus = true } = {}) {
    this.selected = null;
    this.pickerMode = null;
    this.inventoryData = null;
    this.inventoryQuery = "";
    this.inventoryPage = 1;
    this.browserMode = null;
    this.relationFlow = null;
    this.relationQuery = "";
    this.classificationPromptSubjectId = null;
    this.releaseModalInteraction({ restoreFocus });
    this.render();
  }

  releaseModalInteraction({ restoreFocus = false } = {}) {
    const layer = this.modalLayer;
    const listeners = this.modalListeners;
    if (layer && listeners) {
      layer.removeEventListener("click", listeners.click);
      layer.removeEventListener("dblclick", listeners.dblclick);
      layer.removeEventListener("submit", listeners.submit);
      layer.removeEventListener("input", listeners.input);
      layer.removeEventListener("change", listeners.change);
      layer.removeEventListener("keydown", listeners.keydown);
      layer.removeEventListener("subject-selected", listeners.subjectSelected);
      layer.removeEventListener("subject-browser-action", listeners.subjectBrowserAction);
    }
    this.modalInteraction?.release({ restoreFocus });
    this.modalInteraction = null;
    this.modalLayer = null;
    this.modalListeners = null;
  }

  syncModalInteraction() {
    const layer = this.querySelector(".semantic-graph-modal-layer");
    if (!(layer instanceof HTMLElement)) return;
    const listeners = {
      click: (event) => { void this.onClick(event); },
      dblclick: (event) => this.onDoubleClick(event),
      submit: (event) => { void this.onSubmit(event); },
      input: (event) => this.onInput(event),
      change: (event) => this.onChange(event),
      keydown: (event) => this.onKeyDown(event),
      subjectSelected: (event) => { void this.onSubjectSelected(event); },
      subjectBrowserAction: (event) => { void this.onSubjectBrowserAction(event); },
    };
    layer.addEventListener("click", listeners.click);
    layer.addEventListener("dblclick", listeners.dblclick);
    layer.addEventListener("submit", listeners.submit);
    layer.addEventListener("input", listeners.input);
    layer.addEventListener("change", listeners.change);
    layer.addEventListener("keydown", listeners.keydown);
    layer.addEventListener("subject-selected", listeners.subjectSelected);
    layer.addEventListener("subject-browser-action", listeners.subjectBrowserAction);
    this.modalLayer = layer;
    this.modalListeners = listeners;
    this.modalInteraction = mountModalInteraction({
      layer,
      panel: () => layer.querySelector(".artaround-task-modal"),
      initialFocus: "[autofocus], input:not([type=hidden]), select, textarea, button:not([data-modal-dismiss])",
      canDismiss: () => !this.busy && !this.inventoryBusy,
      onRequestDismiss: () => {
        this.closeModal({ restoreFocus: true });
        return true;
      },
      lockScroll: true,
    });
  }

  onInput = (event) => {
    const target = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement ? event.target : null;
    if (!target) return;
    if (target.matches("[data-relation-search]")) {
      this.relationQuery = target.value;
      this.render();
      return;
    }
    if (!this.relationFlow || !target.form?.matches("[data-relation-composer]")) return;
    if (target.name === "note") this.relationFlow.note = target.value;
    if (target.name === "weight") this.relationFlow.weight = target.value;
  };

  onChange = (event) => {
    const target = event.target instanceof HTMLSelectElement ? event.target : null;
    if (!target || !this.relationFlow) return;
    if (target.name === "relationTypeDefinitionId" && this.relationFlow.legacy) {
      this.relationFlow.relationTypeDefinitionId = target.value;
      this.render();
    }
    if (target.name === "targetItemId") this.relationFlow.targetItemId = target.value;
  };

  onKeyDown = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const node = target?.closest("[data-graph-subject]");
    if (node && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      this.openSubjectEditor(node.dataset.graphSubject);
      return;
    }
    if (node && (event.key === "f" || event.key === "F")) {
      event.preventDefault();
      void this.setFocus(node.dataset.graphSubject, { offerClassification: false });
      return;
    }
    const edge = target?.closest("[data-graph-edge]");
    if (edge && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      this.openEdgeEditor(edge.dataset.graphEdge);
    }
  };

  onDoubleClick = (event) => {
    const node = event.target instanceof Element ? event.target.closest("[data-graph-subject]") : null;
    if (!node) return;
    event.preventDefault();
    this.clearSubjectClickTimer();
    void this.setFocus(node.dataset.graphSubject, { offerClassification: false });
  };

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-choose-focus]")) { this.openInventory("focus"); return; }
    if (target.closest("[data-browse-subjects]")) { this.openSubjectBrowser("browse", { source: "collection" }); return; }
    if (target.closest("[data-start-relation]")) { this.startRelationFirst(); return; }
    if (target.closest("[data-classify-focus]")) {
      if (!this.editable || this.locked) return;
      this.classificationPromptSubjectId = id(this.focusSubjectId);
      this.render();
      return;
    }
    if (target.closest("[data-skip-classification]")) {
      if (this.classificationPromptSubjectId) this.skippedClassification.add(id(this.classificationPromptSubjectId));
      this.classificationPromptSubjectId = null;
      this.render();
      return;
    }
    if (target.closest("[data-change-relation]")) {
      if (this.relationFlow) { this.relationFlow.step = "relation"; this.relationQuery = ""; this.pickerMode = null; this.inventoryData = null; this.render(); }
      return;
    }
    const relationCard = target.closest("[data-relation-view]");
    if (relationCard) { this.chooseRelationView(relationCard.dataset.relationView); return; }
    const backRelation = target.closest("[data-back-relation]");
    if (backRelation && this.relationFlow) {
      if (this.relationFlow.entryMode === "relation-first" && this.relationFlow.step === "target") this.relationFlow.step = "relation";
      else if (this.relationFlow.entryMode === "target-first") { this.relationFlow = null; this.openSubjectBrowser("browse", { source: "collection" }); return; }
      this.browserMode = null;
      this.pickerMode = null;
      this.inventoryData = null;
      this.render();
      return;
    }
    if (target.closest("[data-add-graph-subject]")) {
      if (!this.standaloneMode()) return;
      this.pickerMode = "add-focus";
      this.selected = null;
      this.relationFlow = null;
      this.render();
      return;
    }
    if (target.closest("artaround-semantic-subject-source-browser")) return;

    const inventorySubject = target.closest("[data-use-inventory-subject]");
    if (inventorySubject) {
      const row = (this.inventoryData?.results || []).find((entry) => id(entry.subject) === id(inventorySubject.dataset.useInventorySubject));
      if (!row?.subject) return;
      if (this.pickerMode === "relation-target" && this.relationFlow) {
        this.relationFlow.otherRow = row;
        this.relationFlow.step = "confirm";
        this.pickerMode = null;
        this.inventoryData = null;
        this.render();
        return;
      }
      await this.setFocus(row.subject._id, { offerClassification: true });
      return;
    }
    const inventoryPage = target.closest("button[data-semantic-inventory-page]");
    if (inventoryPage) {
      this.inventoryPage = Math.max(1, Number(inventoryPage.dataset.semanticInventoryPage) || 1);
      await this.loadInventory();
      return;
    }
    if (target.closest("[data-show-more-neighbors]")) {
      this.visibleNeighborLimit = Math.min(100, this.visibleNeighborLimit + 18);
      await this.load();
      return;
    }
    const recenter = target.closest("[data-recenter-subject]");
    if (recenter) { await this.setFocus(recenter.dataset.recenterSubject, { offerClassification: false }); return; }

    const graphNode = target.closest("[data-graph-subject]");
    if (graphNode) {
      const subjectId = graphNode.dataset.graphSubject;
      this.clearSubjectClickTimer();
      this.subjectClickTimer = window.setTimeout(() => {
        this.subjectClickTimer = null;
        this.openSubjectEditor(subjectId);
      }, 220);
      return;
    }
    const graphEdge = target.closest("[data-graph-edge]");
    if (graphEdge) { this.openEdgeEditor(graphEdge.dataset.graphEdge); return; }

    const removeSubject = target.closest("[data-remove-graph-subject]");
    if (removeSubject && this.editable && !this.locked) {
      const subject = this.subject(removeSubject.dataset.removeGraphSubject);
      const confirmed = await openActionDialog({
        title: `Rimuovere “${subject?.preferredLabel || "questo soggetto"}” dal grafo?`,
        message: this.collectionMode()
          ? "Il contenuto resta nella Raccolta. Il nodo può essere rimosso soltanto se non è usato da relazioni."
          : "Il Subject globale resta invariato. Il nodo può essere rimosso soltanto se non è usato da relazioni.",
        confirmLabel: "Rimuovi dal grafo",
        tone: "danger",
      });
      if (confirmed) await this.mutate(() => this.removeSubject(removeSubject.dataset.removeGraphSubject), {
        clearTransient: true,
        resetFocus: id(removeSubject.dataset.removeGraphSubject) === id(this.focusSubjectId),
      });
      return;
    }

    const removeEdge = target.closest("[data-remove-edge]");
    if (removeEdge && this.editable && !this.locked) {
      const confirmed = await openActionDialog({
        title: "Rimuovere questa relazione?",
        message: "La modifica produce una nuova revisione del grafo. Le versioni già congelate non cambiano.",
        confirmLabel: "Rimuovi relazione",
        tone: "danger",
      });
      if (confirmed) await this.mutate(() => this.removeEdge(removeEdge.dataset.removeEdge), { clearTransient: true });
    }
  };

  onSubjectSelected = async (event) => {
    const row = event.detail?.row || (event.detail?.subject ? { subject: event.detail.subject, subjectClassDefinitionIds: [] } : null);
    if (!row?.subject) return;
    if (this.pickerMode === "add-focus" && this.standaloneMode()) {
      event.stopPropagation();
      await this.addSubjectAndFocus(row.subject);
      return;
    }
    if (this.browserMode === "focus") {
      event.stopPropagation();
      await this.setFocus(row.subject._id, { offerClassification: true });
      return;
    }
    if (this.browserMode === "legacy-target") {
      event.stopPropagation();
      this.startLegacyRelationTo(row);
      return;
    }
    if (this.browserMode === "relation-target" && this.relationFlow) {
      event.stopPropagation();
      this.relationFlow.otherRow = row;
      this.relationFlow.step = "confirm";
      this.browserMode = null;
      this.render();
    }
  };

  onSubjectBrowserAction = async (event) => {
    const row = event.detail?.row;
    if (!row?.subject || this.browserMode !== "browse") return;
    event.stopPropagation();
    if (event.detail.action === "focus") {
      await this.setFocus(row.subject._id, { offerClassification: true });
      return;
    }
    if (event.detail.action === "connect") this.startTargetFirst(row);
  };

  async addSubjectAndFocus(subject) {
    const subjectId = id(subject);
    if (!subjectId || !this.standaloneMode()) return;
    await this.mutate(() => this.addSubject(subjectId), {
      beforeReload: () => {
        this.focusSubjectId = subjectId;
        this.dispatchFocusChanged();
      },
      clearTransient: true,
    });
    const entry = this.subjectEntry(subjectId);
    if (entry && !classIds(entry).length && this.subjectClasses.length) {
      this.classificationPromptSubjectId = subjectId;
      this.render();
    }
  }

  classAssignmentsForView(data, view, otherRow) {
    if (!view) return [];
    const result = [];
    const roles = [
      { subjectId: this.focusSubjectId, existing: classIds(this.subjectEntry(this.focusSubjectId)), allowed: view.focusDefinitionIds || [], field: "focusRequiredClass" },
      { subjectId: id(otherRow?.subject), existing: classIds(otherRow), allowed: view.otherDefinitionIds || [], field: "otherRequiredClass" },
    ];
    for (const role of roles) {
      const needed = classesNeeded(role.existing, role.allowed);
      if (!needed.length) continue;
      const chosen = String(data.get(role.field) || "");
      if (!chosen) continue;
      result.push({
        subjectId: role.subjectId,
        subjectClassDefinitionIds: [...new Set([...role.existing, chosen])],
      });
    }
    return result;
  }

  legacyClassAssignments(data, relation, otherRow) {
    if (!relation) return [];
    const result = [];
    for (const role of [
      { subjectId: this.focusSubjectId, existing: classIds(this.subjectEntry(this.focusSubjectId)), allowed: relation.domainDefinitionIds || [], field: "sourceRequiredClass" },
      { subjectId: id(otherRow?.subject), existing: classIds(otherRow), allowed: relation.rangeDefinitionIds || [], field: "targetRequiredClass" },
    ]) {
      if (!role.allowed.length || intersects(role.existing, role.allowed)) continue;
      const chosen = String(data.get(role.field) || "");
      if (!chosen) continue;
      result.push({ subjectId: role.subjectId, subjectClassDefinitionIds: [...new Set([...role.existing, chosen])] });
    }
    return result;
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

    if (form.matches("[data-classification-prompt]")) {
      event.preventDefault();
      const subjectId = form.dataset.subjectId;
      const data = new FormData(form);
      const definitions = data.getAll("subjectClassDefinitionIds").map(String);
      if (!definitions.length) return;
      await this.mutate(() => this.setSubjectClasses(subjectId, definitions), { clearTransient: true });
      return;
    }

    if (form.matches("[data-classes-form]")) {
      event.preventDefault();
      const data = new FormData(form);
      await this.mutate(() => this.setSubjectClasses(form.dataset.subjectId, data.getAll("subjectClassDefinitionIds").map(String)), { clearTransient: true });
      return;
    }

    if (!form.matches("[data-relation-composer]") || !this.relationFlow) return;
    event.preventDefault();
    const data = new FormData(form);
    const note = String(data.get("note") || "").trim();

    if (this.relationFlow.legacy) {
      const relationTypeDefinitionId = String(data.get("relationTypeDefinitionId") || this.relationFlow.relationTypeDefinitionId || "");
      const relation = this.relationById(relationTypeDefinitionId);
      const otherSubjectId = id(this.relationFlow.otherRow?.subject);
      const payload = {
        sourceSubjectId: this.focusSubjectId,
        targetSubjectId: otherSubjectId,
        relationTypeDefinitionId,
        weight: Number(data.get("weight") || 1),
        metadata: note ? { note } : null,
        subjectClassAssignments: this.legacyClassAssignments(data, relation, this.relationFlow.otherRow),
      };
      if (this.relationFlow.targetNeedsCollectionItem) payload.targetItemId = String(data.get("targetItemId") || this.relationFlow.targetItemId || "");
      await this.mutate(() => this.addEdge(payload), { clearTransient: true });
      return;
    }

    const view = this.currentRelationView();
    const otherRow = this.relationFlow.otherRow;
    const otherSubjectId = id(otherRow?.subject);
    if (!view || !otherSubjectId) return;
    const endpoints = canonicalEndpoints(view, this.focusSubjectId, otherSubjectId);
    const payload = {
      ...endpoints,
      relationTypeDefinitionId: view.relationTypeDefinitionId,
      weight: Number(data.get("weight") || 1),
      metadata: note ? { note } : null,
      subjectClassAssignments: this.classAssignmentsForView(data, view, otherRow),
    };
    const needsCollectionItem = this.collectionMode() && Number(otherRow?.presentationCoverage?.collectionItemCount || 0) === 0;
    if (needsCollectionItem) {
      const itemId = String(data.get("targetItemId") || "");
      if (itemId) payload.subjectItemSelections = [{ subjectId: otherSubjectId, itemId }];
    }
    if (this.relationFlow.mode === "edit") {
      await this.mutate(() => this.updateEdge(this.relationFlow.edgeId, payload), { clearTransient: true });
    } else {
      await this.mutate(() => this.addEdge(payload), { clearTransient: true });
    }
  }

  async mutate(operation, { beforeReload = null, clearTransient = false, resetFocus = false } = {}) {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      await operation();
      if (resetFocus) {
        this.focusSubjectId = null;
        this.dispatchFocusChanged();
      }
      beforeReload?.();
      this.data = await this.fetchNeighborhood();
      if (clearTransient) {
        this.selected = null;
        this.pickerMode = null;
        this.inventoryData = null;
        this.browserMode = null;
        this.relationFlow = null;
        this.relationQuery = "";
        this.classificationPromptSubjectId = null;
      }
      this.dispatchEvent(new CustomEvent("semantic-graph-changed", { bubbles: true, composed: true }));
      if (this.collectionMode()) this.dispatchEvent(new CustomEvent("editorial-graph-changed", { bubbles: true, composed: true }));
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
      const copy = this.collectionMode()
        ? "Scegli il Subject di un contenuto della Raccolta per esplorare o creare collegamenti."
        : totalSubjects
          ? `Il grafo contiene ${totalSubjects} soggetti. Scegline uno per visualizzare i collegamenti.`
          : "Aggiungi o scegli un soggetto per iniziare a costruire le relazioni.";
      return `<div class="semantic-graph-empty" data-semantic-graph-canvas><div><span class="eyebrow">Collegamenti</span><h3>Nessun soggetto di contesto</h3><p>${escapeHtml(copy)}</p><div class="button-row"><button type="button" data-choose-focus>${icon("search", { size: 16 })} Scegli soggetto</button>${this.standaloneMode() && this.editable && !this.locked ? `<button type="button" class="button-secondary" data-add-graph-subject>${icon("plus", { size: 16 })} Aggiungi soggetto</button>` : ""}</div></div></div>`;
    }
    const focusEntry = this.subjectEntry(this.focusSubjectId);
    const focus = focusEntry?.subject;
    if (!focus) return `<div class="empty-state"><p>Il soggetto di contesto non è più disponibile.</p></div>`;
    const neighborhood = this.focusNeighborhood();
    const positions = this.layoutNeighborhood(neighborhood);
    const focusPosition = positions.get(id(this.focusSubjectId));
    const edgeCounts = new Map();
    neighborhood.edges.forEach((edge) => {
      const otherId = id(edge.sourceSubjectId) === id(this.focusSubjectId) ? id(edge.targetSubjectId) : id(edge.sourceSubjectId);
      edgeCounts.set(otherId, (edgeCounts.get(otherId) || 0) + 1);
    });
    const edgeIndex = new Map();
    const edgeMarkup = neighborhood.edges.map((edge) => {
      const relation = this.relationById(edge.relationTypeDefinitionId);
      const viewed = edgeViewForFocus(edge, relation, this.focusSubjectId);
      if (!viewed) return "";
      const to = positions.get(id(viewed.otherSubjectId));
      if (!to || !focusPosition) return "";
      const otherId = id(viewed.otherSubjectId);
      const index = edgeIndex.get(otherId) || 0;
      edgeIndex.set(otherId, index + 1);
      const total = edgeCounts.get(otherId) || 1;
      const curve = (index - ((total - 1) / 2)) * 34;
      const dx = to.x - focusPosition.x;
      const dy = to.y - focusPosition.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const cx = (focusPosition.x + to.x) / 2 + (-dy / length) * curve;
      const cy = (focusPosition.y + to.y) / 2 + (dx / length) * curve;
      const tx = (focusPosition.x + (2 * cx) + to.x) / 4;
      const ty = (focusPosition.y + (2 * cy) + to.y) / 4 - 8;
      const marker = viewed.direction === "symmetric" ? "" : ` marker-end="url(#semantic-arrow)"`;
      return `<g class="semantic-edge semantic-edge--${escapeHtml(viewed.direction)}" data-graph-edge="${escapeHtml(id(edge.id))}" tabindex="0" role="button" aria-label="Modifica relazione ${escapeHtml(viewed.label)}"><path d="M ${focusPosition.x} ${focusPosition.y} Q ${cx} ${cy} ${to.x} ${to.y}"${marker}></path><text x="${tx}" y="${ty}" text-anchor="middle">${escapeHtml(viewed.label)}</text></g>`;
    }).join("");
    const nodeMarkup = neighborhood.neighbors.map((entry) => {
      const subjectId = id(entry.subject);
      const position = positions.get(subjectId);
      const label = String(entry.subject?.preferredLabel || "Soggetto");
      const short = label.length > 24 ? `${label.slice(0, 22)}…` : label;
      return `<g class="semantic-node" data-graph-subject="${escapeHtml(subjectId)}" tabindex="0" role="button" aria-label="${escapeHtml(label)}. Invio modifica, doppio click o F mostra i collegamenti"><circle cx="${position.x}" cy="${position.y}" r="49"></circle><text x="${position.x}" y="${position.y + 4}" text-anchor="middle">${escapeHtml(short)}</text></g>`;
    }).join("");
    const focusMarkup = `<g class="semantic-node semantic-node--focus" data-graph-subject="${escapeHtml(id(this.focusSubjectId))}" tabindex="0" role="button" aria-label="${escapeHtml(focus.preferredLabel || "Soggetto di contesto")}. Invio modifica"><circle cx="${focusPosition.x}" cy="${focusPosition.y}" r="62"></circle><text x="${focusPosition.x}" y="${focusPosition.y + 4}" text-anchor="middle">${escapeHtml(String(focus.preferredLabel || "Soggetto").slice(0, 28))}</text></g>`;
    return `<div class="semantic-graph-canvas" data-semantic-graph-canvas><svg viewBox="0 0 900 520" role="img" aria-label="Collegamenti di ${escapeHtml(focus.preferredLabel || "soggetto")}"><defs><marker id="semantic-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z"></path></marker></defs>${edgeMarkup}${nodeMarkup}${focusMarkup}</svg>${neighborhood.hiddenNeighbors ? `<div class="semantic-graph-more"><span>${neighborhood.neighbors.length} di ${neighborhood.totalNeighbors} soggetti collegati mostrati</span><button type="button" class="button-secondary small" data-show-more-neighbors ${this.visibleNeighborLimit >= 100 ? "disabled" : ""}>Mostra altri</button></div>` : ""}</div>`;
  }

  renderClassChips(entry) {
    const ids = classIds(entry);
    if (!ids.length) {
      if (!this.editable || this.locked) return `<span class="semantic-class-missing semantic-class-missing--readonly">Categoria non assegnata</span>`;
      return `<button type="button" class="semantic-class-missing" data-classify-focus>Categoria non assegnata · Aggiungi</button>`;
    }
    return `<span class="semantic-subject-class-list">${ids.map((definitionId) => `<span class="semantic-subject-class-chip">${escapeHtml(this.classById(definitionId)?.label || definitionId)}</span>`).join("")}</span>`;
  }

  renderToolbar() {
    if (!this.focusSubjectId) return "";
    const focus = this.subject(this.focusSubjectId);
    const entry = this.subjectEntry(this.focusSubjectId);
    return `<div class="semantic-graph-toolbar"><div><strong>${escapeHtml(focus?.preferredLabel || "Soggetto")}</strong>${this.renderClassChips(entry)}</div><div class="button-row">${this.collectionMode() ? `<button type="button" class="button-secondary" data-browse-subjects>${icon("search", { size: 15 })} Esplora soggetti</button>` : `<button type="button" class="button-secondary" data-choose-focus>${icon("search", { size: 15 })} Cambia soggetto</button>`}${this.editable && !this.locked ? `<button type="button" data-start-relation>${icon("link", { size: 15 })} Aggiungi collegamento</button>` : ""}</div></div>`;
  }

  renderCoverage(entry) {
    if (this.standaloneMode()) return `<span class="status">Nel grafo</span>`;
    const coverage = entry?.presentationCoverage || {};
    const collection = Number(coverage.collectionItemCount || 0);
    const space = Number(coverage.contentSpaceItemCount || 0);
    if (collection) return `<span class="status" data-tone="success">${collection} ${collection === 1 ? "contenuto nella Raccolta" : "contenuti nella Raccolta"}</span>`;
    if (space) return `<span class="status">${space} ${space === 1 ? "contenuto nello Spazio" : "contenuti nello Spazio"}</span>`;
    return `<span class="status" data-tone="warning">Nessun contenuto disponibile</span>`;
  }

  renderInventoryPagination() {
    const pagination = this.inventoryData?.pagination || {};
    const page = Number(pagination.page || this.inventoryPage || 1);
    const totalPages = Number(pagination.totalPages || 0);
    if (totalPages <= 1) return "";
    return `<nav class="pagination" aria-label="Pagine dell'inventario semantico"><button type="button" data-semantic-inventory-page="${page - 1}" ${page <= 1 || this.inventoryBusy ? "disabled" : ""}>← Precedente</button><span>Pagina ${page} di ${totalPages}</span><button type="button" data-semantic-inventory-page="${page + 1}" ${page >= totalPages || this.inventoryBusy ? "disabled" : ""}>Successiva →</button></nav>`;
  }

  modal(title, body, { eyebrow = "Grafo semantico", large = false } = {}) {
    return `<div class="artaround-modal-layer semantic-graph-modal-layer" data-modal-backdrop="true" role="presentation"><section class="artaround-task-modal${large ? " artaround-task-modal--large" : ""} semantic-graph-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}"><header class="artaround-task-modal__header task-modal-header"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2></div><button type="button" class="button-secondary small artaround-task-modal__close" data-modal-dismiss aria-label="Chiudi">×</button></header><div class="artaround-task-modal__body">${body}</div><footer class="artaround-task-modal__footer"><button type="button" class="button-secondary" data-modal-dismiss>Chiudi</button></footer></section></div>`;
  }

  renderStandaloneInventoryPicker() {
    const subjects = (this.inventoryData?.results || []).filter((entry) => id(entry.subject) !== id(this.focusSubjectId));
    const relationTarget = this.pickerMode === "relation-target";
    const title = relationTarget ? "Scegli il soggetto da collegare" : "Scegli il soggetto di contesto";
    const back = relationTarget ? `<button type="button" class="button-secondary small" data-back-relation>← Collegamento</button>` : "";
    const addSubject = !relationTarget && this.editable && !this.locked
      ? `<div class="semantic-inventory-footer"><button type="button" class="button-secondary" data-add-graph-subject>${icon("plus", { size: 15 })} Aggiungi un nuovo Subject al grafo</button></div>`
      : "";
    const body = `${back}<form data-semantic-inventory-search role="search"><label>Cerca nel grafo<input name="q" value="${escapeHtml(this.inventoryQuery)}" placeholder="Nome del soggetto"></label><button type="submit" class="button-secondary" ${this.inventoryBusy ? "disabled" : ""}>${icon("search", { size: 15 })} Cerca</button></form><div class="semantic-inventory-list">${subjects.length ? subjects.map((entry) => `<button type="button" class="semantic-inventory-card" data-use-inventory-subject="${escapeHtml(id(entry.subject))}"><span><strong>${escapeHtml(entry.subject?.preferredLabel || "Soggetto")}</strong><small>${escapeHtml(entry.subject?.description || "")}</small></span><span class="semantic-inventory-meta">${Number(entry.relationCount || 0)} relazioni</span></button>`).join("") : `<div class="empty-state compact"><p>${this.inventoryBusy ? "Ricerca in corso…" : "Nessun soggetto selezionabile."}</p></div>`}</div>${this.renderInventoryPagination()}${addSubject}`;
    return this.modal(title, body, { eyebrow: relationTarget ? "Collegamenti" : "Inventario del grafo", large: true });
  }

  renderSubjectBrowser() {
    const mode = this.browserMode;
    const title = mode === "focus" ? "Scegli il soggetto di contesto" : mode === "relation-target" || mode === "legacy-target" ? "Scegli il soggetto da collegare" : "Esplora soggetti";
    const legacyCopy = mode === "legacy-target" ? `<p class="note">Cerca tra i contenuti dello Spazio editoriale.</p>` : "";
    const back = mode === "relation-target" ? `<button type="button" class="button-secondary small" data-back-relation>← Collegamento</button>` : "";
    return this.modal(title, `${legacyCopy}${back}<artaround-semantic-subject-source-browser></artaround-semantic-subject-source-browser>`, { eyebrow: mode === "browse" ? "Soggetti" : "Collegamenti", large: true });
  }

  renderAddSubjectPicker() {
    const body = `<div class="semantic-source-explanation"><p>Cerca un Subject globale; se non esiste, il resolver può proseguire su fonti esterne o crearne uno.</p></div><artaround-semantic-entity-picker></artaround-semantic-entity-picker>`;
    return this.modal("Nuovo soggetto nel grafo", body, { eyebrow: "Aggiungi soggetto", large: true });
  }

  renderClassificationPrompt() {
    const entry = this.subjectEntry(this.classificationPromptSubjectId);
    if (!entry || !this.editable || this.locked) return "";
    const subject = entry.subject || {};
    const selectedClasses = new Set(classIds(entry));
    const body = `<p>La categoria permette ad ArtAround di proporti soltanto i collegamenti semanticamente compatibili. Puoi anche decidere di farlo più tardi.</p><form data-classification-prompt data-subject-id="${escapeHtml(id(subject))}"><fieldset><legend>Che tipo di soggetto è “${escapeHtml(subject.preferredLabel || "questo soggetto")}”?</legend>${this.subjectClasses.map((definition) => `<label class="check semantic-class-option"><input type="checkbox" name="subjectClassDefinitionIds" value="${escapeHtml(definition.definitionId)}" ${selectedClasses.has(String(definition.definitionId)) ? "checked" : ""}><span><strong>${escapeHtml(definition.label)}</strong>${definition.description ? `<small>${escapeHtml(definition.description)}</small>` : ""}</span></label>`).join("")}</fieldset><div class="button-row"><button type="submit">${icon("check", { size: 15 })} Conferma</button><button type="button" class="button-secondary" data-skip-classification>Non ora</button></div></form>`;
    return this.modal(`Classifica ${subject.preferredLabel || "soggetto"}`, body, { eyebrow: "Categoria del soggetto", large: true });
  }

  renderSubjectEditor() {
    const entry = this.subjectEntry(this.selected?.id);
    if (!entry) return "";
    const subject = entry.subject || {};
    const selectedClasses = new Set(classIds(entry));
    const relationCount = this.relationCount(subject._id);
    const classForm = this.subjectClasses.length
      ? `<form data-classes-form data-subject-id="${escapeHtml(id(subject))}"><fieldset ${this.editable && !this.locked ? "" : "disabled"}><legend>Categoria nel grafo</legend>${this.subjectClasses.map((definition) => `<label class="check"><input type="checkbox" name="subjectClassDefinitionIds" value="${escapeHtml(definition.definitionId)}" ${selectedClasses.has(String(definition.definitionId)) ? "checked" : ""}><span><strong>${escapeHtml(definition.label)}</strong>${definition.description ? `<small>${escapeHtml(definition.description)}</small>` : ""}</span></label>`).join("")}</fieldset>${this.editable && !this.locked ? `<button type="submit" class="button-secondary">Salva categorie</button>` : ""}</form>`
      : `<p class="note">Le Regole editoriali non definiscono categorie di soggetto.</p>`;
    const remove = this.editable && !this.locked && entry.inGraph !== false
      ? `<button type="button" class="button-secondary danger" data-remove-graph-subject="${escapeHtml(id(subject))}">${icon("trash", { size: 15 })} Rimuovi dal grafo</button>`
      : "";
    const body = `${subject.description ? `<p>${escapeHtml(subject.description)}</p>` : ""}<div class="button-row">${this.renderCoverage(entry)}<span class="status">${relationCount} ${relationCount === 1 ? "relazione" : "relazioni"}</span></div>${classForm}<div class="operations">${id(subject) !== id(this.focusSubjectId) ? `<button type="button" data-recenter-subject="${escapeHtml(id(subject))}">Mostra i suoi collegamenti</button>` : ""}${remove}</div>`;
    return this.modal(subject.preferredLabel || "Soggetto", body, { eyebrow: "Soggetto" });
  }

  relationCandidates() {
    if (!this.relationFlow) return [];
    const focusClasses = classIds(this.subjectEntry(this.focusSubjectId));
    const otherClasses = this.relationFlow.entryMode === "target-first" || this.relationFlow.entryMode === "edit"
      ? classIds(this.relationFlow.otherRow)
      : null;
    const query = this.relationQuery.trim().toLocaleLowerCase("it-IT");
    return compatibleRelationViews(this.relationTypes, focusClasses, otherClasses).filter((view) => (
      !query || `${view.label} ${view.description || ""}`.toLocaleLowerCase("it-IT").includes(query)
    ));
  }

  renderRelationPicker() {
    const focus = this.subject(this.focusSubjectId) || {};
    const other = this.relationFlow?.otherRow?.subject || null;
    const views = this.relationCandidates();
    const context = other
      ? `Come vuoi collegare “${focus.preferredLabel || "soggetto"}” a “${other.preferredLabel || "soggetto"}”?`
      : `Che cosa vuoi esprimere su “${focus.preferredLabel || "questo soggetto"}”?`;
    const body = `<p>${escapeHtml(context)}</p><label class="semantic-relation-search">Cerca collegamento<input data-relation-search value="${escapeHtml(this.relationQuery)}" placeholder="Es. ha creato, appartiene a…"></label><div class="semantic-relation-picker">${views.length ? views.map((view) => `<button type="button" class="semantic-relation-card" data-relation-view="${escapeHtml(view.viewKey)}"><span class="semantic-relation-direction" aria-hidden="true">${view.direction === "symmetric" ? "↔" : "→"}</span><span><strong>${escapeHtml(view.label)}</strong>${view.description ? `<small>${escapeHtml(view.description)}</small>` : ""}</span></button>`).join("") : `<div class="empty-state compact"><p>Nessun collegamento compatibile con le categorie attuali.</p></div>`}</div>${this.relationFlow?.entryMode === "target-first" ? `<div class="button-row"><button type="button" class="button-secondary" data-back-relation>← Torna ai soggetti</button></div>` : ""}`;
    return this.modal("Scegli il collegamento", body, { eyebrow: "Nuovo collegamento", large: true });
  }

  renderClassRequirement(subjectLabel, existing, allowedDefinitionIds, name) {
    if (!allowedDefinitionIds?.length) return "";
    const compatible = allowedDefinitionIds.find((definitionId) => existing.includes(String(definitionId)));
    if (compatible) return `<p class="relation-requirement-ok"><strong>${escapeHtml(subjectLabel)}</strong>: ${escapeHtml(this.classById(compatible)?.label || compatible)} ✓</p>`;
    if (allowedDefinitionIds.length === 1) {
      const definitionId = String(allowedDefinitionIds[0]);
      return `<label class="relation-class-confirm"><input type="checkbox" name="${name}" value="${escapeHtml(definitionId)}" checked required><span>Assegna a <strong>${escapeHtml(subjectLabel)}</strong> la categoria <strong>${escapeHtml(this.classById(definitionId)?.label || definitionId)}</strong>.</span></label>`;
    }
    return `<label>Categoria richiesta per ${escapeHtml(subjectLabel)}<select name="${name}" required><option value="">Scegli…</option>${allowedDefinitionIds.map((definitionId) => `<option value="${escapeHtml(definitionId)}">${escapeHtml(this.classById(definitionId)?.label || definitionId)}</option>`).join("")}</select></label>`;
  }

  renderTargetContentSelection(flow) {
    if (!this.collectionMode()) return "";
    const row = flow?.otherRow || {};
    const targetNeedsCollectionItem = Number(row?.presentationCoverage?.collectionItemCount || 0) === 0;
    if (!targetNeedsCollectionItem) return "";
    const targetItemCandidates = Array.isArray(row?.itemCandidates) ? row.itemCandidates : [];
    if (!targetItemCandidates.length) return `<artaround-callout tone="warning"><strong>Nessun contenuto utilizzabile.</strong> Questo soggetto non può ancora entrare nella Raccolta.</artaround-callout>`;
    if (targetItemCandidates.length === 1) {
      const candidate = targetItemCandidates[0];
      return `<artaround-callout tone="info"><strong>Il contenuto entrerà nella Raccolta.</strong> Per creare il collegamento verrà aggiunto “${escapeHtml(candidate.label || "Contenuto")}". Contenuto e relazione saranno salvati atomicamente.</artaround-callout><input type="hidden" name="targetItemId" value="${escapeHtml(id(candidate.itemId))}">`;
    }
    return `<artaround-callout tone="info"><strong>Il soggetto non è ancora nella Raccolta.</strong> Scegli quale contenuto usare: verrà aggiunto insieme al collegamento nella stessa operazione.</artaround-callout><label>Contenuto da aggiungere<select name="targetItemId" required><option value="">Scegli…</option>${targetItemCandidates.map((candidate) => `<option value="${escapeHtml(id(candidate.itemId))}">${escapeHtml(candidate.label || `Contenuto ${id(candidate.itemId).slice(-6)}`)}</option>`).join("")}</select></label>`;
  }

  renderRelationConfirmation() {
    const flow = this.relationFlow;
    const view = this.currentRelationView();
    const focusEntry = this.subjectEntry(this.focusSubjectId);
    const focus = focusEntry?.subject || {};
    const otherRow = flow?.otherRow || {};
    const other = otherRow.subject || {};
    if (!view || !other._id) return `<div class="empty-state compact"><p>Completa prima il collegamento e il soggetto da collegare.</p></div>`;
    const createLabel = this.collectionMode() && Number(otherRow.presentationCoverage?.collectionItemCount || 0) === 0
      ? "Aggiungi contenuto e crea relazione"
      : flow.mode === "edit" ? "Salva collegamento" : "Crea collegamento";
    const body = `<div class="semantic-relation-summary"><span><strong>${escapeHtml(focus.preferredLabel || "Soggetto")}</strong></span><span class="semantic-relation-summary-label">${escapeHtml(view.label)}</span><span><strong>${escapeHtml(other.preferredLabel || "Soggetto")}</strong></span></div><form data-relation-composer>${this.renderTargetContentSelection(flow)}<section class="relation-requirements"><span class="eyebrow">Categorie</span>${this.renderClassRequirement(focus.preferredLabel || "Soggetto", classIds(focusEntry), view.focusDefinitionIds || [], "focusRequiredClass")}${this.renderClassRequirement(other.preferredLabel || "Soggetto", classIds(otherRow), view.otherDefinitionIds || [], "otherRequiredClass")}</section><label>Nota<input name="note" maxlength="500" value="${escapeHtml(flow.note || "")}" placeholder="Facoltativa"></label><details><summary>Opzioni avanzate</summary><label>Peso della relazione<input name="weight" type="number" min="0" max="10" step=".5" value="${escapeHtml(flow.weight ?? 1)}"></label></details><div class="button-row"><button type="submit">${icon("check", { size: 15 })} ${createLabel}</button><button type="button" class="button-secondary" data-change-relation>Cambia collegamento</button>${flow.mode === "edit" && this.editable && !this.locked ? `<button type="button" class="button-secondary danger" data-remove-edge="${escapeHtml(flow.edgeId)}">${icon("trash", { size: 15 })} Rimuovi</button>` : ""}</div></form>`;
    return this.modal(`${focus.preferredLabel || "Soggetto"} · ${view.label} · ${other.preferredLabel || "Soggetto"}`, body, { eyebrow: flow.mode === "edit" ? "Modifica collegamento" : "Nuovo collegamento", large: true });
  }

  renderLegacyRelationEditor() {
    const flow = this.relationFlow;
    const source = this.subject(this.focusSubjectId) || {};
    const target = flow?.otherRow?.subject || {};
    const relation = this.relationById(flow?.relationTypeDefinitionId);
    const relationOptions = (this.relationTypes || []).map((definition) => `<option value="${escapeHtml(definition.definitionId)}" ${String(definition.definitionId) === String(flow.relationTypeDefinitionId) ? "selected" : ""}>${escapeHtml(definition.label)}</option>`).join("");
    const sourceExisting = classIds(this.subjectEntry(this.focusSubjectId));
    const targetExisting = classIds(flow.otherRow);
    const body = `<form data-relation-composer>${this.renderTargetContentSelection(flow)}<label>Tipo di relazione<select name="relationTypeDefinitionId" required>${relationOptions}</select></label>${relation ? `<section class="relation-requirements"><span class="eyebrow">Tipi richiesti dalle regole</span>${this.renderClassRequirement(source.preferredLabel || "Partenza", sourceExisting, relation.domainDefinitionIds || [], "sourceRequiredClass")}${this.renderClassRequirement(target.preferredLabel || "Destinazione", targetExisting, relation.rangeDefinitionIds || [], "targetRequiredClass")}</section>` : ""}<label>Nota<input name="note" maxlength="500" value="${escapeHtml(flow.note || "")}" placeholder="Facoltativa"></label><details><summary>Opzioni avanzate</summary><label>Peso della relazione<input name="weight" type="number" min="0" max="10" step=".5" value="${escapeHtml(flow.weight ?? 1)}"></label></details><div class="button-row"><button type="submit">${icon("check", { size: 15 })} ${flow.targetNeedsCollectionItem ? "Aggiungi contenuto e crea relazione" : "Crea relazione"}</button></div></form>`;
    return this.modal(`${source.preferredLabel || "Soggetto"} → ${target.preferredLabel || "Soggetto"}`, body, { eyebrow: "Nuova relazione" });
  }

  renderModal() {
    if (this.classificationPromptSubjectId) return this.renderClassificationPrompt();
    if (this.relationFlow?.legacy) return this.renderLegacyRelationEditor();
    if (this.relationFlow?.step === "relation") return this.renderRelationPicker();
    if (this.relationFlow?.step === "confirm") return this.renderRelationConfirmation();
    if (this.browserMode) return this.renderSubjectBrowser();
    if (["focus", "relation-target"].includes(this.pickerMode) && this.standaloneMode()) return this.renderStandaloneInventoryPicker();
    if (this.pickerMode === "add-focus") return this.renderAddSubjectPicker();
    if (this.selected?.kind === "subject") return this.renderSubjectEditor();
    return "";
  }

  configureBrowser() {
    const browser = this.modalLayer?.querySelector("artaround-semantic-subject-source-browser") || this.querySelector("artaround-semantic-subject-source-browser");
    if (!browser || !this.collectionMode() || !this.browserMode) return;
    const focus = this.subject(this.focusSubjectId);
    let requiredClassIds = [];
    if (this.browserMode === "relation-target") requiredClassIds = this.currentRelationView()?.otherDefinitionIds || [];
    const allowedSources = this.browserMode === "focus"
      ? ["collection"]
      : this.browserMode === "legacy-target"
        ? ["space"]
        : ["collection", "space"];
    browser.configure({
      editorialContextId: this.editorialContextId,
      source: this.browserSource,
      allowedSources,
      mode: this.browserMode === "browse" ? "browse" : "select",
      excludeSubjectIds: this.focusSubjectId ? [this.focusSubjectId] : [],
      requiredClassIds,
      subjectClasses: this.subjectClasses,
      focusSubjectId: this.focusSubjectId,
      focusLabel: focus?.preferredLabel || "soggetto corrente",
    });
  }

  centerFocusIfNeeded() {
    if (!this.focusSubjectId || id(this.renderedFocusSubjectId) === id(this.focusSubjectId)) return;
    const canvas = this.querySelector("[data-semantic-graph-canvas]");
    if (canvas) canvas.scrollLeft = Math.max(0, (canvas.scrollWidth - canvas.clientWidth) / 2);
    this.renderedFocusSubjectId = id(this.focusSubjectId);
  }

  render() {
    this.releaseModalInteraction({ restoreFocus: false });
    if (!this.hasResource()) { this.innerHTML = `<div class="empty-state"><p>Preparazione del grafo…</p></div>`; return; }
    this.innerHTML = `<div class="semantic-graph-workspace" aria-busy="${this.busy}">${this.error ? `<p role="alert">${escapeHtml(this.error)}</p>` : ""}${this.renderToolbar()}${this.renderCanvas()}${this.renderModal()}</div>`;
    this.syncModalInteraction();
    queueMicrotask(() => {
      this.configureBrowser();
      this.centerFocusIfNeeded();
    });
  }
}

customElements.define("artaround-semantic-graph-editor", ArtAroundSemanticGraphEditor);