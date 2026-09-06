import { currentRoute, navigate } from "../application/router.js";
import { confirmNavigationLoss } from "../application/navigation-loss-guard.js";
import { contextKindLabel, OPERATING_CONTEXT_CHANGED, readOperatingContext } from "../application/operating-context.js";
import {
  EDITORIAL_SPACE_CHANGED,
  resolveEditorialSpacePreference,
  setEditorialSpacePreference,
} from "../application/editorial-space-preference.js";
import { editorialRepository } from "../infrastructure/http/editorial-repository.js";
import { icon } from "./icons.js";

const RELOAD_IN_PLACE_ROUTES = new Set(["/workspace", "/create"]);
const LEAVE_RESOURCE_ON_SWITCH_ROUTES = new Set([
  "/workspace/item-authoring",
  "/workspace/editorial-collection-new",
  "/workspace/editorial-studio",
  "/workspace/semantic-graph",
]);

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function id(value) { return String(value?._id || value?.id || value || ""); }
function principal(context) {
  if (!context?.type || !context?.id) return null;
  return { principalType: context.type, principalId: context.id };
}
function currentLogicalUrl() {
  return `${currentRoute()}${window.location.search || ""}${window.location.hash || ""}`;
}

export class ArtAroundEditorialContextSwitcher extends HTMLElement {
  context = readOperatingContext();
  spaces = [];
  currentSpace = null;
  open = false;
  busy = false;
  error = null;
  loadGeneration = 0;

  connectedCallback() {
    this.addEventListener("click", this.onClick);
    document.addEventListener("pointerdown", this.onDocumentPointerDown, true);
    document.addEventListener("keydown", this.onDocumentKeyDown);
    window.addEventListener(OPERATING_CONTEXT_CHANGED, this.onOperatingContextChanged);
    window.addEventListener(EDITORIAL_SPACE_CHANGED, this.onEditorialSpaceChanged);
    void this.load();
  }

  disconnectedCallback() {
    this.loadGeneration += 1;
    this.removeEventListener("click", this.onClick);
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, true);
    document.removeEventListener("keydown", this.onDocumentKeyDown);
    window.removeEventListener(OPERATING_CONTEXT_CHANGED, this.onOperatingContextChanged);
    window.removeEventListener(EDITORIAL_SPACE_CHANGED, this.onEditorialSpaceChanged);
  }

  onOperatingContextChanged = (event) => {
    this.context = event.detail || readOperatingContext();
    this.open = false;
    void this.load();
  };

  onEditorialSpaceChanged = () => {
    this.open = false;
    void this.load();
  };

  onDocumentPointerDown = (event) => {
    if (!this.open || this.contains(event.target)) return;
    this.open = false;
    this.render();
  };

  onDocumentKeyDown = (event) => {
    if (event.key !== "Escape" || !this.open) return;
    this.open = false;
    this.render();
    this.querySelector("[data-editorial-context-toggle]")?.focus();
  };

  async load() {
    const generation = ++this.loadGeneration;
    const context = this.context || readOperatingContext();
    this.context = context;
    if (!context) {
      this.spaces = [];
      this.currentSpace = null;
      this.busy = false;
      this.error = null;
      this.render();
      return;
    }

    this.busy = true;
    this.error = null;
    this.render();
    try {
      const spaces = await editorialRepository.spaceSummaries({ ownerType: context.type, ownerId: context.id });
      if (generation !== this.loadGeneration || !this.isConnected) return;
      this.spaces = Array.isArray(spaces) ? spaces : [];
      this.currentSpace = resolveEditorialSpacePreference(principal(context), this.spaces);
    } catch (error) {
      if (generation !== this.loadGeneration || !this.isConnected) return;
      this.spaces = [];
      this.currentSpace = null;
      this.error = error instanceof Error ? error.message : "Spazi editoriali non disponibili";
    } finally {
      if (generation !== this.loadGeneration || !this.isConnected) return;
      this.busy = false;
      this.render();
    }
  }

  refreshRouteAfterSwitch() {
    const route = currentRoute();
    if (RELOAD_IN_PLACE_ROUTES.has(route)) {
      navigate(currentLogicalUrl());
      return;
    }
    if (LEAVE_RESOURCE_ON_SWITCH_ROUTES.has(route)) navigate("/workspace");
  }

  async chooseSpace(spaceId) {
    const next = this.spaces.find((space) => id(space) === String(spaceId || "")) || null;
    if (!next || id(next) === id(this.currentSpace)) {
      this.open = false;
      this.render();
      return;
    }

    const confirmed = await confirmNavigationLoss({
      kind: "editorial-space",
      from: currentLogicalUrl(),
      fromContentSpaceId: id(this.currentSpace) || null,
      toContentSpaceId: id(next),
    });
    if (!confirmed) return;

    setEditorialSpacePreference(principal(this.context), id(next));
    this.currentSpace = next;
    this.open = false;
    this.render();
    this.refreshRouteAfterSwitch();
  }

  onClick = async (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    if (target.closest("[data-change-operating-context]")) {
      this.open = false;
      await navigate("/context");
      return;
    }
    if (target.closest("[data-editorial-context-toggle]")) {
      this.open = !this.open;
      this.render();
      return;
    }
    const choice = target.closest("[data-editorial-space-id]");
    if (choice) {
      await this.chooseSpace(choice.dataset.editorialSpaceId);
      return;
    }
    if (target.closest("[data-editorial-context-library]")) {
      this.open = false;
      await navigate("/workspace");
    }
  };

  renderSpaceChoice(space) {
    const stats = space.stats || {};
    const selected = id(space) === id(this.currentSpace);
    const meta = [
      `${Number(stats.collectionCount || 0)} raccolte`,
      `${Number(stats.itemCount || 0)} contenuti`,
    ].join(" · ");
    return `<button type="button" class="context-space-choice" data-editorial-space-id="${escapeHtml(id(space))}" aria-current="${selected ? "true" : "false"}"><span><strong>${escapeHtml(space.name || "Spazio editoriale")}</strong><small>${escapeHtml(space.description || meta)}</small></span><span class="context-space-choice__meta">${escapeHtml(meta)}${selected ? " · attivo" : ""}</span></button>`;
  }

  renderPopover() {
    if (!this.open) return "";
    const ownerName = this.context?.name || "Area di lavoro";
    const body = this.busy
      ? `<div class="context-space-state"><span class="skeleton skeleton-line"></span><small>Caricamento degli spazi…</small></div>`
      : this.error
        ? `<div class="context-space-state" role="alert"><strong>Spazi non disponibili</strong><small>${escapeHtml(this.error)}</small></div>`
        : this.spaces.length
          ? `<div class="context-space-list">${this.spaces.map((space) => this.renderSpaceChoice(space)).join("")}</div>`
          : `<div class="context-space-state"><strong>Nessuno spazio editoriale</strong><small>Crea il primo spazio dalla Libreria quando vuoi iniziare a organizzare contenuti e raccolte.</small></div>`;
    return `<section class="context-space-popover" aria-label="Cambia spazio editoriale"><header><span class="eyebrow">Spazi editoriali</span><strong>${escapeHtml(ownerName)}</strong><p>Definisce il corpus di lavoro per contenuti e raccolte.</p></header>${body}<footer><button type="button" class="button-secondary small" data-editorial-context-library>${this.spaces.length ? "Gestisci spazi in Libreria" : "Apri la Libreria"}</button></footer></section>`;
  }

  render() {
    const context = this.context || readOperatingContext();
    if (!context) { this.innerHTML = ""; return; }
    const contextName = context.name || (context.type === "organization" ? "Organizzazione" : "Area personale");
    const spaceName = this.busy && !this.currentSpace
      ? "Caricamento…"
      : this.currentSpace?.name || "Nessuno spazio editoriale";
    this.innerHTML = `<div class="context-identity" data-editorial-open="${this.open}"><span class="context-identity__icon" aria-hidden="true">${icon(context.type === "organization" ? "building" : "user", { size: 16 })}</span><div class="context-identity__levels"><button type="button" class="context-identity__level context-identity__owner" data-change-operating-context title="Cambia area di lavoro"><span><small>${escapeHtml(contextKindLabel(context))}</small><strong>${escapeHtml(contextName)}</strong></span>${icon("chevron", { size: 13 })}</button><button type="button" class="context-identity__level context-identity__space" data-editorial-context-toggle aria-expanded="${this.open}" title="Cambia spazio editoriale"><span><small>Spazio editoriale</small><strong>${escapeHtml(spaceName)}</strong></span>${icon("chevron", { size: 13 })}</button></div>${this.renderPopover()}</div>`;
  }
}

customElements.define("artaround-editorial-context-switcher", ArtAroundEditorialContextSwitcher);
