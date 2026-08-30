import { venueTargetsMixin } from "./venue-editor-targets-mixin.js";

function normalized(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("it")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function searchableTargetText(target) {
  return normalized([
    target?.label,
    target?.displayLabelOverride,
    target?.inventoryNote,
    target?.subject?.label,
    target?.subject?.preferredLabel,
    target?.subject?.description,
    target?.exhibitSlot?.label,
  ].filter(Boolean).join(" "));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const venueInventorySearchMixin = {
  async handleTargetMediaSubmit(form, data) {
    if (form.matches("[data-inventory-search-form]")) {
      this.inventorySearchQuery = String(data.get("inventoryQuery") || "").trim();
      this.selectedVenueTargetId = null;
      this.render();
      return true;
    }
    return venueTargetsMixin.handleTargetMediaSubmit.call(this, form, data);
  },

  async handleTargetMediaClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-clear-inventory-search]")) {
      this.inventorySearchQuery = "";
      this.selectedVenueTargetId = null;
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-inventory-search-form] input")?.focus());
      return true;
    }
    return venueTargetsMixin.handleTargetMediaClick.call(this, event);
  },

  renderTargets(editable) {
    const allTargets = this.data.targets || [];
    const query = normalized(this.inventorySearchQuery);
    const searchMatches = query
      ? allTargets.filter((target) => searchableTargetText(target).includes(query))
      : allTargets;
    this.data.targets = searchMatches;
    let body;
    try {
      body = venueTargetsMixin.renderTargets.call(this, editable);
    } finally {
      this.data.targets = allTargets;
    }

    const visibleCount = searchMatches.filter((target) => this.inventoryFilter === "all" || target.configuration?.state === this.inventoryFilter).length;
    const search = `<form data-inventory-search-form class="venue-inventory-search" role="search"><label>Cerca nell’inventario<input name="inventoryQuery" value="${escapeHtml(this.inventorySearchQuery || "")}" placeholder="Es. Gioconda, Leonardo, Sala 2"></label><button class="button-secondary" type="submit">Cerca</button>${this.inventorySearchQuery ? `<button class="button-secondary" type="button" data-clear-inventory-search>Mostra tutte</button>` : ""}<span class="count">${visibleCount} entità</span></form>`;
    return `${search}${body}`;
  },
};
