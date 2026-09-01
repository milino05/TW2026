import { icon } from "./icons.js";
import { managementRepository } from "../infrastructure/http/management-repository.js";
import { venueActionMixin } from "./venue-editor-action-mixin.js";
import { venueInventorySearchMixin } from "./venue-editor-inventory-search-mixin.js";
import { venueMapRefinementMixin } from "./venue-editor-map-refinement-mixin.js";
import { venueSectionMixin } from "./venue-editor-section-mixin.js";
import { venueSpatialDetailMixin } from "./venue-editor-spatial-detail-mixin.js";
import { targetInspector } from "./venue-editor-targets-mixin.js";

function id(value) { return String(value?._id || value?.id || value || ""); }
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
function selected(value, current) { return id(value) === id(current) ? "selected" : ""; }
function normalized(value) { return String(value || "").trim().toLocaleLowerCase("it").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function searchableTargetText(target) {
  return normalized([target?.label, target?.displayLabelOverride, target?.inventoryNote, target?.subject?.preferredLabel, target?.subject?.label, target?.subject?.description, target?.exhibitSlot?.label].filter(Boolean).join(" "));
}
function targetSubjectId(target) { return id(target?.subject?.id || target?.subject?._id || target?.subjectId); }
function assignedTargetForSlot(targets, slotId) { return (targets || []).find((target) => id(target.exhibitSlot?.id || target.exhibitSlot?._id) === id(slotId)); }
function inventoryStatus(target) {
  if (target?.exhibitSlot || target?.configuration?.state === "exposed") return { label: "Già esposto", tone: "success" };
  if (target?.configuration?.state === "unavailable") return { label: "Non disponibile", tone: "warning" };
  return { label: "Non esposto", tone: "neutral" };
}
function detailTabs(entries, activeTab) {
  return `<nav class="venue-spatial-detail-tabs" role="tablist">${entries.map(([key, label, count]) => `<button type="button" role="tab" data-spatial-editor-tab="${escapeHtml(key)}" aria-selected="${activeTab === key}">${escapeHtml(label)}${Number.isFinite(count) ? ` <span class="count">${count}</span>` : ""}</button>`).join("")}</nav>`;
}
function detailShell({ eyebrow, title, subtitle, tabs, activeTab, panel, danger = "", breadcrumb = "" }) {
  return `<section class="venue-spatial-detail"><div class="venue-spatial-detail-topbar"><button class="button-secondary" type="button" data-close-spatial-editor>← Torna alla mappa</button>${breadcrumb}</div><header class="venue-spatial-detail-header"><div><span class="eyebrow">${escapeHtml(eyebrow)}</span><h2>${escapeHtml(title)}</h2><p>${subtitle}</p></div></header>${detailTabs(tabs, activeTab)}<div class="venue-spatial-detail-panel">${panel}</div>${danger}</section>`;
}
function inventoryCard(target, selectedTargetId) {
  const status = inventoryStatus(target);
  const subtitle = target.subject?.preferredLabel && target.subject.preferredLabel !== target.label ? target.subject.preferredLabel : target.subject?.description || "Entità della sede";
  const location = target.exhibitSlot?.label ? `Slot: ${target.exhibitSlot.label}` : "Nessuno slot assegnato";
  const active = id(target.id) === id(selectedTargetId);
  return `<button class="venue-inventory-browser-card${active ? " selected" : ""}" type="button" data-inventory-browser-target="${escapeHtml(id(target.id))}" aria-pressed="${active}"><span class="venue-inventory-browser-card-status" data-tone="${escapeHtml(status.tone)}">${escapeHtml(status.label)}</span><strong>${escapeHtml(target.label || "Entità")}</strong><small>${escapeHtml(subtitle)}</small><span class="venue-inventory-browser-card-location">${escapeHtml(location)}</span></button>`;
}

export const venueSlotInventoryMixin = {
  ensureGlobalEscapeHandler() {
    if (this._venueGlobalEscapeHandler) return;
    this._venueGlobalEscapeHandler = (event) => {
      if (!this.isConnected) {
        window.removeEventListener("keydown", this._venueGlobalEscapeHandler, true);
        this._venueGlobalEscapeHandler = null;
        return;
      }
      if (event.key !== "Escape" || this.busy) return;
      let handled = true;
      if (this.pendingDestructiveAction) {
        this.pendingDestructiveAction = null; this.error = null; this.render();
      } else if (this.inventorySubjectPickerOpen) {
        this.inventorySubjectPickerOpen = false; this.inventoryPendingSubject = null; this.render();
      } else if (this.pendingTargetRemovalId) {
        this.pendingTargetRemovalId = null; this.error = null; this.render();
      } else if (this.inventoryDetailTargetId) {
        this.inventoryDetailTargetId = null; this.render();
      } else if (this.inventoryBrowser) {
        this.inventoryBrowser = null; this.render();
      } else if (this.pendingVenueRemoval) {
        this.pendingVenueRemoval = false; this.error = null; this.render();
      } else if (this.pendingWorkflow) {
        this.pendingWorkflow = null; this.workflowMessage = ""; this.render();
      } else if (this.calibrationOverwritePrompt) {
        this.calibrationOverwritePrompt = null; this.render();
      } else if (this.mapCreationDialog) {
        this.closeMapCreationDialog?.(); this.render();
      } else if (this.floorDialog) {
        this.floorDialog = null; this.render();
      } else if (this.spatialEditor) {
        this.closeSpatialEditor?.();
      } else if (this.pendingMapAction || this.draggingPlace) {
        this.cancelMapAction?.();
      } else handled = false;
      if (handled) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener("keydown", this._venueGlobalEscapeHandler, true);
  },

  render() {
    this.ensureGlobalEscapeHandler();
    venueSectionMixin.render.call(this);
    if (!this.data || this.onboarding?.required) return;
    this.decorateMapRefinements?.();
  },

  openInventoryBrowserForSlot(exhibitSlotId) {
    const slot = (this.data.layout?.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === id(exhibitSlotId));
    if (!slot) return false;
    const assigned = assignedTargetForSlot(this.data.targets || [], exhibitSlotId);
    this.inventoryBrowser = { purpose: "assign_to_slot", exhibitSlotId: id(exhibitSlotId), query: "", filter: "all", selectedTargetId: assigned ? id(assigned.id) : null };
    this.inventorySubjectPickerOpen = false;
    this.inventoryPendingSubject = null;
    this.render();
    requestAnimationFrame(() => this.querySelector("[data-inventory-browser-backdrop] input[name=inventoryQuery]")?.focus());
    return true;
  },

  browserState() {
    return this.inventoryBrowser || { purpose: "standalone", exhibitSlotId: null, query: this.inventorySearchQuery || "", filter: this.inventoryFilter || "all", selectedTargetId: this.selectedVenueTargetId || null };
  },
  setBrowserSelection(targetId) { if (this.inventoryBrowser) this.inventoryBrowser = { ...this.inventoryBrowser, selectedTargetId: id(targetId) }; else this.selectedVenueTargetId = id(targetId); },
  setBrowserQuery(query) { if (this.inventoryBrowser) this.inventoryBrowser = { ...this.inventoryBrowser, query }; else this.inventorySearchQuery = query; },
  setBrowserFilter(filter) { if (this.inventoryBrowser) this.inventoryBrowser = { ...this.inventoryBrowser, filter }; else this.inventoryFilter = filter; },

  onSubjectSelected(event) {
    if (!this.inventorySubjectPickerOpen) return venueActionMixin.onSubjectSelected.call(this, event);
    const subject = event.detail?.subject;
    if (!subject) return;
    const subjectId = id(subject);
    const projectedTargetId = id(subject.inventory?.venueTargetId);
    const existing = (this.data.targets || []).find((target) => (projectedTargetId && id(target.id) === projectedTargetId) || (subjectId && targetSubjectId(target) === subjectId));
    if (existing) {
      this.setBrowserSelection(existing.id);
      this.inventorySubjectPickerOpen = false;
      this.inventoryPendingSubject = null;
      this.message = "Questa entità è già presente nell’inventario della sede.";
      this.render();
      return;
    }
    if (!subjectId) {
      this.error = "Il Subject selezionato non ha un identificatore ArtAround valido.";
      this.render();
      return;
    }
    this.inventoryPendingSubject = subject;
    this.error = null;
    this.render();
  },

  async addPendingSubjectToInventory() {
    if (this.busy) return false;
    const subjectId = id(this.inventoryPendingSubject);
    if (!subjectId) {
      this.error = "Seleziona prima un Subject valido.";
      this.render();
      return false;
    }
    this.busy = true;
    this.error = null;
    this.message = null;
    this.render();
    try {
      const createdTarget = await managementRepository.createVenueTarget(this.id, { subjectId, provenance: { origin: "human" } });
      await this.refreshServerState();
      const returnedTargetId = id(createdTarget);
      const target = (this.data.targets || []).find((entry) => returnedTargetId && id(entry.id) === returnedTargetId)
        || (this.data.targets || []).find((entry) => targetSubjectId(entry) === subjectId);
      if (!target) throw new Error("L’entità è stata salvata, ma non compare nell’inventario aggiornato.");
      this.setBrowserSelection(target.id);
      this.inventorySubjectPickerOpen = false;
      this.inventoryPendingSubject = null;
      this.message = "Entità aggiunta all’inventario della sede.";
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Non è stato possibile aggiungere l’entità all’inventario.";
      return false;
    } finally {
      this.busy = false;
      this.render();
    }
  },

  async handleTargetMediaClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    const openFromSlot = target.closest("[data-open-inventory-browser]");
    if (openFromSlot) return this.openInventoryBrowserForSlot(openFromSlot.dataset.openInventoryBrowser) || true;

    if (target.matches("[data-inventory-browser-backdrop]") || target.closest("[data-close-inventory-browser]")) {
      this.inventoryBrowser = null; this.render(); return true;
    }
    if (target.matches("[data-inventory-subject-backdrop]") || target.closest("[data-close-inventory-subject-picker]")) {
      this.inventorySubjectPickerOpen = false; this.inventoryPendingSubject = null; this.render(); return true;
    }

    const card = target.closest("[data-inventory-browser-target]");
    if (card) { this.setBrowserSelection(card.dataset.inventoryBrowserTarget); this.render(); return true; }
    const filter = target.closest("[data-inventory-browser-filter]");
    if (filter) { this.setBrowserFilter(filter.dataset.inventoryBrowserFilter || "all"); this.render(); return true; }

    if (target.closest("[data-open-inventory-subject-picker]")) {
      this.inventorySubjectPickerOpen = true; this.inventoryPendingSubject = null; this.error = null; this.render();
      requestAnimationFrame(() => this.querySelector(".venue-inventory-subject-dialog input")?.focus());
      return true;
    }
    if (target.closest("[data-reset-inventory-subject-picker]")) { this.inventoryPendingSubject = null; this.error = null; this.render(); return true; }
    if (target.closest("[data-add-pending-subject-to-inventory]")) {
      await this.addPendingSubjectToInventory();
      return true;
    }

    if (target.closest("[data-open-selected-inventory-detail]")) {
      const selectedTargetId = this.browserState().selectedTargetId;
      if (selectedTargetId) { this.inventoryDetailTargetId = id(selectedTargetId); this.render(); }
      return true;
    }
    if (this.inventoryDetailTargetId && target.closest("[data-close-inventory-inspector]")) {
      this.inventoryDetailTargetId = null; this.render(); return true;
    }
    const locate = target.closest("[data-locate-slot]");
    if (this.inventoryDetailTargetId && locate) {
      this.inventoryDetailTargetId = null;
      this.inventoryBrowser = null;
      this.locateExhibitSlot?.(locate.dataset.locateSlot);
      return true;
    }

    if (target.closest("[data-assign-selected-inventory-target]")) {
      const browser = this.inventoryBrowser;
      if (!browser?.exhibitSlotId || !browser.selectedTargetId) return true;
      const chosen = (this.data.targets || []).find((entry) => id(entry.id) === id(browser.selectedTargetId));
      const alreadyHere = id(chosen?.exhibitSlot?.id || chosen?.exhibitSlot?._id) === id(browser.exhibitSlotId);
      if (alreadyHere) return true;
      const relocating = Boolean(chosen?.exhibitSlot);
      const success = await this.execute(
        () => managementRepository.assignVenueTargetToExhibitSlot(this.id, browser.exhibitSlotId, browser.selectedTargetId),
        relocating ? "Entità ricollocata nello slot selezionato." : "Entità aggiunta allo slot selezionato.",
      );
      if (success) {
        this.inventoryBrowser = null;
        this.selectedVenueTargetId = id(browser.selectedTargetId);
        this.render();
      }
      return true;
    }

    const unassign = target.closest("[data-unassign-slot-current]");
    if (unassign) {
      await this.execute(() => managementRepository.unassignVenueTargetFromExhibitSlot(this.id, unassign.dataset.unassignSlotCurrent), "Slot liberato. L’entità resta nell’inventario della sede.");
      return true;
    }
    return venueInventorySearchMixin.handleTargetMediaClick.call(this, event);
  },

  async handleTargetMediaSubmit(form, data) {
    if (form.matches("[data-inventory-browser-search]")) {
      this.setBrowserQuery(String(data.get("inventoryQuery") || "").trim()); this.render(); return true;
    }
    if (form.matches("[data-add-subject-to-inventory]")) {
      await this.addPendingSubjectToInventory();
      return true;
    }
    return venueInventorySearchMixin.handleTargetMediaSubmit.call(this, form, data);
  },

  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;
    const createSlot = target.closest("[data-start-slot]");
    if (createSlot) {
      this.mapCreationDialog = { type: "slot", placeId: id(createSlot.dataset.placeId || createSlot.dataset.startSlotPlace || "") };
      this.error = null;
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-map-slot-dialog] input[name=label]")?.focus());
      return true;
    }
    return venueMapRefinementMixin.handleMapAuthoringClick.call(this, event);
  },

  async handleMapAuthoringSubmit(form, data) {
    if (form.matches("[data-map-slot-dialog]")) {
      const placeId = String(data.get("placeId") || "").trim();
      const label = String(data.get("label") || "").trim();
      const orderText = String(data.get("order") || "").trim();
      if (!placeId || !label) return true;
      const before = new Set((this.data.layout?.exhibitSlots || []).map((slot) => id(slot.exhibitSlotId)));
      const success = await this.execute(() => managementRepository.createExhibitSlot(this.id, { placeId, label, order: orderText ? Number(orderText) : null }), "Slot espositivo creato.");
      if (success) {
        const created = (this.data.layout?.exhibitSlots || []).find((slot) => !before.has(id(slot.exhibitSlotId)));
        this.mapCreationDialog = null;
        this.activeSpatialTab = "slots";
        if (created) this.openSpatialEditor?.("slot", created.exhibitSlotId); else this.render();
      }
      return true;
    }
    return venueMapRefinementMixin.handleMapAuthoringSubmit.call(this, form, data);
  },

  renderExhibitSlots(editable) {
    const layout = this.data.layout || {};
    const slots = layout.exhibitSlots || [];
    const targets = this.data.targets || [];
    const placeById = new Map((layout.places || []).map((place) => [id(place._id), place]));
    const floorById = new Map((layout.floors || []).map((floor) => [id(floor._id), floor]));
    const cards = slots.map((slot) => {
      const slotId = id(slot.exhibitSlotId);
      const place = placeById.get(id(slot.placeId));
      const assigned = assignedTargetForSlot(targets, slotId);
      return `<button class="venue-slot-grid-card" type="button" data-open-spatial-slot="${escapeHtml(slotId)}"><span class="venue-slot-grid-status" data-tone="${assigned ? "success" : "neutral"}">${assigned ? "Assegnato" : "Libero"}</span><strong>${escapeHtml(slot.label || "Slot espositivo")}</strong><span>${escapeHtml(assigned?.label || "Nessuna entità")}</span><small>${escapeHtml(place?.label || "Luogo mancante")} · ${escapeHtml(floorById.get(id(place?.floorId))?.label || "Piano")}</small></button>`;
    }).join("");
    const noPlaces = !(layout.places || []).length;
    const add = editable ? `<button class="venue-slot-grid-card venue-slot-grid-card--add" type="button" data-start-slot ${noPlaces ? "disabled title=\"Crea prima almeno un luogo\"" : ""}><span class="venue-slot-grid-plus">${icon("plus", { size: 28 })}</span><strong>Nuovo slot</strong>${noPlaces ? `<small>Crea prima un luogo</small>` : ""}</button>` : "";
    return `<section class="venue-command-block venue-slots-browser"><div class="section-heading compact"><div><h3>Slot espositivi</h3><p>Posizioni stabili dell’allestimento. Apri una card per configurare entità, indicazioni e proprietà dello slot.</p></div><span class="count">${slots.length}</span></div><div class="venue-slot-grid">${cards}${add}</div></section>`;
  },

  renderPlaceSpatialEditor(editable, editor) {
    if (editor.tab !== "slots") return venueSpatialDetailMixin.renderPlaceSpatialEditor.call(this, editable, editor);
    const layout = this.data.layout || {};
    const definitions = this.physicalDefinitions();
    const place = (layout.places || []).find((entry) => id(entry._id) === id(editor.id));
    if (!place) return venueSpatialDetailMixin.renderPlaceSpatialEditor.call(this, editable, editor);
    const floor = (layout.floors || []).find((entry) => id(entry._id) === id(place.floorId));
    const type = definitions.placeTypes.find((entry) => id(entry.definitionId) === id(place.placeTypeDefinitionId));
    const slots = (layout.exhibitSlots || []).filter((entry) => id(entry.placeId) === id(place._id));
    const cards = slots.map((slot) => {
      const assigned = assignedTargetForSlot(this.data.targets || [], slot.exhibitSlotId);
      return `<button class="venue-slot-grid-card" type="button" data-open-spatial-slot="${escapeHtml(id(slot.exhibitSlotId))}"><span class="venue-slot-grid-status" data-tone="${assigned ? "success" : "neutral"}">${assigned ? "Assegnato" : "Libero"}</span><strong>${escapeHtml(slot.label)}</strong><span>${escapeHtml(assigned?.label || "Nessuna entità")}</span><small>${escapeHtml(slot.approachGuidance?.defaultInstruction || "Nessuna indicazione predefinita")}</small></button>`;
    }).join("");
    const add = editable ? `<button class="venue-slot-grid-card venue-slot-grid-card--add" type="button" data-start-slot data-place-id="${escapeHtml(id(place._id))}"><span class="venue-slot-grid-plus">${icon("plus", { size: 28 })}</span><strong>Nuovo slot</strong><small>${escapeHtml(place.label || "Questo luogo")}</small></button>` : "";
    const panel = `<div class="venue-slot-grid venue-slot-grid--detail">${cards}${add}</div>`;
    const danger = editable ? `<section class="venue-detail-danger"><div><strong>Rimuovi luogo</strong><p>L’impatto su collegamenti e slot verrà mostrato prima della conferma.</p></div><button class="danger" type="button" data-remove-place="${escapeHtml(id(place._id))}" data-label="${escapeHtml(place.label || "questo luogo")}">Rimuovi luogo</button></section>` : "";
    return detailShell({ eyebrow: "Luogo", title: place.label || "Luogo senza nome", subtitle: `${escapeHtml(floor?.label || "Piano")} · ${escapeHtml(type?.label || "Tipo non disponibile")}`, tabs: [["general", "Generale"], ["attributes", "Caratteristiche"], ["slots", "Slot espositivi", slots.length]], activeTab: "slots", panel, danger });
  },

  renderSlotSpatialEditor(editable, editor) {
    if (editor.tab && editor.tab !== "entity") return venueSpatialDetailMixin.renderSlotSpatialEditor.call(this, editable, editor);
    const layout = this.data.layout || {};
    const slot = (layout.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === id(editor.id));
    const place = (layout.places || []).find((entry) => id(entry._id) === id(slot?.placeId));
    if (!slot || !place) return venueSpatialDetailMixin.renderSlotSpatialEditor.call(this, editable, editor);
    const floor = (layout.floors || []).find((entry) => id(entry._id) === id(place.floorId));
    const assigned = assignedTargetForSlot(this.data.targets || [], slot.exhibitSlotId);
    const current = assigned
      ? `<article class="venue-slot-current-entity"><span class="venue-inventory-browser-card-status" data-tone="success">Già esposto</span><h3>${escapeHtml(assigned.label || "Entità")}</h3><p>${escapeHtml(assigned.subject?.preferredLabel || assigned.subject?.description || "Entità dell’inventario")}</p><small>Collocazione: ${escapeHtml(assigned.exhibitSlot?.label || slot.label)}</small></article>`
      : `<div class="empty-state compact venue-slot-empty-entity"><h3>Slot libero</h3><p>Nessuna entità dell’inventario è assegnata a questa posizione.</p></div>`;
    const canCreateContent = Boolean(assigned && this.data.authoringPermissions?.canCreateContent);
    const physicalActions = editable
      ? `<button type="button" data-open-inventory-browser="${escapeHtml(id(slot.exhibitSlotId))}">${assigned ? "Cambia entità" : "Apri inventario"}</button>${assigned ? `<button class="button-secondary" type="button" data-unassign-slot-current="${escapeHtml(id(assigned.id))}">Libera slot</button>` : ""}`
      : "";
    const contentAction = canCreateContent
      ? `<a class="button-link secondary" data-route href="/workspace/item-authoring?venueTargetId=${encodeURIComponent(id(assigned.id))}">Crea contenuto</a>`
      : "";
    const actions = physicalActions || contentAction ? `<div class="button-row venue-slot-entity-actions">${physicalActions}${contentAction}</div>` : "";
    const panel = `<div class="venue-slot-entity-panel">${current}${actions}<p class="note">Aggiungere un’entità all’inventario non la colloca automaticamente: l’assegnazione a questo slot resta un gesto esplicito.</p></div>`;
    const breadcrumb = `<button class="button-link" type="button" data-open-spatial-place="${escapeHtml(id(place._id))}">‹ ${escapeHtml(place.label || "Luogo")}</button>`;
    const danger = editable ? `<section class="venue-detail-danger"><div><strong>Rimuovi slot</strong><p>L’entità eventualmente esposta resterà nell’inventario della sede.</p></div><button class="danger" type="button" data-remove-slot="${escapeHtml(id(slot.exhibitSlotId))}" data-label="${escapeHtml(slot.label)}">Rimuovi slot</button></section>` : "";
    return detailShell({ eyebrow: "Slot espositivo", title: slot.label, subtitle: `${escapeHtml(place.label || "Luogo")} · ${escapeHtml(floor?.label || "Piano")}`, tabs: [["entity", "Entità"], ["guidance", "Indicazioni"], ["advanced", "Avanzate"]], activeTab: "entity", panel, danger, breadcrumb });
  },

  renderInventoryBrowserSurface(editable, browser) {
    const query = normalized(browser.query);
    const filtered = (this.data.targets || []).filter((target) => {
      if (query && !searchableTargetText(target).includes(query)) return false;
      if (browser.filter === "exposed") return Boolean(target.exhibitSlot || target.configuration?.state === "exposed");
      if (browser.filter === "unplaced") return !target.exhibitSlot && target.configuration?.state !== "unavailable";
      if (browser.filter === "unavailable") return target.configuration?.state === "unavailable";
      return true;
    });
    const selectedTarget = (this.data.targets || []).find((entry) => id(entry.id) === id(browser.selectedTargetId));
    const filters = [["all", "Tutte"], ["exposed", "Già esposte"], ["unplaced", "Non esposte"], ["unavailable", "Non disponibili"]]
      .map(([value, label]) => `<button class="button-secondary small" type="button" data-inventory-browser-filter="${value}" aria-pressed="${browser.filter === value}">${label}</button>`).join("");
    let contextAction;
    if (browser.purpose === "assign_to_slot") {
      const slot = (this.data.layout?.exhibitSlots || []).find((entry) => id(entry.exhibitSlotId) === id(browser.exhibitSlotId));
      const alreadyHere = selectedTarget && id(selectedTarget.exhibitSlot?.id || selectedTarget.exhibitSlot?._id) === id(browser.exhibitSlotId);
      const relocating = selectedTarget && selectedTarget.exhibitSlot && !alreadyHere;
      const label = alreadyHere ? "Già in questo slot" : relocating ? "Ricolloca in questo slot" : "Aggiungi allo slot";
      contextAction = `<footer class="venue-inventory-browser-footer"><div><span class="eyebrow">Assegnazione allo slot</span><strong>${escapeHtml(slot?.label || "Slot selezionato")}</strong>${relocating ? `<small>L’entità è già esposta in “${escapeHtml(selectedTarget.exhibitSlot.label || "un altro slot")}” e verrà ricollocata.</small>` : ""}</div><button type="button" data-assign-selected-inventory-target ${!selectedTarget || alreadyHere ? "disabled" : ""}>${escapeHtml(label)}</button></footer>`;
    } else {
      contextAction = `<footer class="venue-inventory-browser-footer"><div><span class="eyebrow">Inventario standalone</span><strong>${selectedTarget ? escapeHtml(selectedTarget.label) : "Seleziona un’entità"}</strong><small>La collocazione parte sempre dall’editor di uno slot; qui gestisci l’inventario in modo indipendente.</small></div><button type="button" data-open-selected-inventory-detail ${selectedTarget ? "" : "disabled"}>Apri dettagli</button></footer>`;
    }
    const cards = filtered.map((target) => inventoryCard(target, browser.selectedTargetId)).join("");
    return `<div class="venue-inventory-browser"><header class="venue-inventory-browser-heading"><div><span class="eyebrow">Inventario della sede</span><h3>${browser.purpose === "assign_to_slot" ? "Scegli l’entità da esporre" : "Entità della Venue"}</h3></div><span class="count">${filtered.length}</span></header><form class="venue-inventory-browser-search" data-inventory-browser-search role="search"><label><span class="sr-only">Cerca nell’inventario</span><input name="inventoryQuery" value="${escapeHtml(browser.query || "")}" placeholder="Cerca nell’inventario"></label><button class="button-secondary" type="submit">Cerca</button>${editable ? `<button class="venue-inventory-add-button" type="button" data-open-inventory-subject-picker aria-label="Aggiungi entità all’inventario" title="Aggiungi entità all’inventario">${icon("plus", { size: 18 })}</button>` : ""}</form><div class="venue-inventory-browser-filters" role="group" aria-label="Filtra inventario">${filters}</div><div class="venue-inventory-browser-grid">${cards || `<div class="empty-state compact"><h4>Nessuna entità trovata</h4><p>Modifica la ricerca oppure aggiungi una nuova entità all’inventario.</p></div>`}</div>${contextAction}</div>`;
  },

  renderTargets(editable) { return this.renderInventoryBrowserSurface(editable, this.browserState()); },

  renderInventoryBrowserOverlay(editable) {
    if (!this.inventoryBrowser) return "";
    return `<div class="venue-modal-backdrop venue-inventory-browser-backdrop" data-inventory-browser-backdrop role="presentation"><section class="venue-modal-card venue-inventory-browser-dialog" role="dialog" aria-modal="true" aria-labelledby="venue-inventory-browser-title"><header><div><span class="eyebrow">Inventario</span><h3 id="venue-inventory-browser-title">Seleziona un’entità</h3></div><button class="button-secondary small" type="button" data-close-inventory-browser aria-label="Chiudi inventario">×</button></header>${this.renderInventoryBrowserSurface(editable, this.inventoryBrowser)}</section></div>`;
  },

  renderInventorySubjectPickerOverlay(editable) {
    if (!editable || !this.inventorySubjectPickerOpen) return "";
    const pending = this.inventoryPendingSubject;
    const body = pending
      ? `<article class="venue-inventory-subject-selected"><span class="eyebrow">Subject selezionato</span><h3>${escapeHtml(pending.preferredLabel || pending.label || "Subject")}</h3><p>${escapeHtml(pending.description || "Senza descrizione")}</p><div class="button-row"><button type="button" data-add-pending-subject-to-inventory ${this.busy ? "disabled" : ""}>${this.busy ? "Aggiunta…" : "Aggiungi all’inventario"}</button><button class="button-secondary" type="button" data-reset-inventory-subject-picker ${this.busy ? "disabled" : ""}>Cambia ricerca</button></div></article>`
      : `<p>Cerca tra i Subject ArtAround. Se non viene trovata una corrispondenza esatta, la ricerca prosegue automaticamente su Wikidata.</p><artaround-semantic-entity-picker mode="subject" entity-kind="item" venue-id="${escapeHtml(this.id)}"></artaround-semantic-entity-picker>`;
    return `<div class="venue-modal-backdrop venue-inventory-subject-backdrop" data-inventory-subject-backdrop role="presentation"><section class="venue-modal-card venue-inventory-subject-dialog" role="dialog" aria-modal="true" aria-labelledby="venue-inventory-subject-title"><header><div><span class="eyebrow">Nuova entità</span><h3 id="venue-inventory-subject-title">Aggiungi all’inventario</h3></div><button class="button-secondary small" type="button" data-close-inventory-subject-picker aria-label="Chiudi ricerca Subject" ${this.busy ? "disabled" : ""}>×</button></header>${body}</section></div>`;
  },

  renderInventoryDetailOverlay(editable) {
    if (!this.inventoryDetailTargetId) return "";
    const entry = (this.data.targets || []).find((target) => id(target.id) === id(this.inventoryDetailTargetId));
    if (!entry) return "";
    return `<div class="venue-modal-backdrop venue-inventory-detail-backdrop" role="presentation"><section class="venue-modal-card venue-inventory-detail-dialog" role="dialog" aria-modal="true" aria-label="Dettaglio inventario">${targetInspector(entry, { editable, canCreateContent: Boolean(this.data.authoringPermissions?.canCreateContent), pendingTargetRemovalId: this.pendingTargetRemovalId, busy: this.busy })}</section></div>`;
  },

  renderMapCreationDialog(editable) {
    let base;
    if (editable && this.mapCreationDialog?.type === "slot") {
      const places = this.data.layout?.places || [];
      const preferredPlaceId = id(this.mapCreationDialog.placeId);
      const options = places.map((place) => `<option value="${escapeHtml(id(place._id))}" ${selected(place._id, preferredPlaceId)}>${escapeHtml(place.label || "Luogo")}</option>`).join("");
      base = `<div class="venue-modal-backdrop venue-slot-create-backdrop" role="presentation"><section class="venue-modal-card venue-slot-create-dialog" role="dialog" aria-modal="true" aria-labelledby="venue-slot-create-title"><header><div><span class="eyebrow">Nuovo slot espositivo</span><h3 id="venue-slot-create-title">Crea una posizione espositiva</h3></div><button class="button-secondary small" type="button" data-close-map-creation-dialog aria-label="Chiudi">×</button></header><p>Uno slot è una posizione stabile dentro un luogo. Non richiede un punto geometrico separato sulla planimetria.</p><form data-map-slot-dialog class="venue-inline-form"><label>Etichetta<input name="label" required placeholder="Es. Parete destra · posizione 2"></label><label>Luogo<select name="placeId" required>${options}</select></label><label>Ordine facoltativo<input name="order" type="number" min="0"></label><div class="button-row"><button type="submit" ${places.length ? "" : "disabled"}>Crea slot</button><button class="button-secondary" type="button" data-close-map-creation-dialog>Annulla</button></div></form></section></div>`;
    } else base = venueMapRefinementMixin.renderMapCreationDialog.call(this, editable);
    return `${base || ""}${this.renderInventoryBrowserOverlay(editable)}${this.renderInventoryDetailOverlay(editable)}${this.renderInventorySubjectPickerOverlay(editable)}`;
  },
};