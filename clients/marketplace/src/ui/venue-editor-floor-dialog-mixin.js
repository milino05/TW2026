import { managementRepository } from "../infrastructure/http/management-repository.js";
import { venueMapInspectorMixin } from "./venue-editor-map-inspector-mixin.js";

function id(value) { return String(value?._id || value?.id || value || ""); }
function escapeHtml(value = "") { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

export const venueFloorDialogMixin = {
  async handleMapAuthoringClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;

    if (target.closest("[data-add-floor-shortcut]")) {
      this.floorDialog = { type: "create" };
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-floor-dialog-create] input")?.focus());
      return true;
    }

    if (target.closest("[data-floor-settings-shortcut]")) {
      const floor = this.activeFloor?.();
      if (!floor) return true;
      this.floorDialog = { type: "settings", floorId: id(floor._id) };
      this.render();
      requestAnimationFrame(() => this.querySelector("[data-floor-dialog-settings] input[name=label]")?.focus());
      return true;
    }

    if (target.closest("[data-close-floor-dialog]")) {
      this.floorDialog = null;
      this.render();
      return true;
    }

    if (target.closest("[data-floor-dialog-remove]")) {
      this.floorDialog = null;
      return false;
    }

    return venueMapInspectorMixin.handleMapAuthoringClick.call(this, event);
  },

  async handleMapAuthoringSubmit(form, data) {
    if (form.matches("[data-floor-dialog-create]")) {
      const label = String(data.get("label") || "").trim();
      const success = await this.execute(() => managementRepository.addVenueFloor(this.id, { label }), "Piano aggiunto.");
      if (success) {
        const floors = this.data.layout?.floors || [];
        this.selectedFloorId = id(floors[floors.length - 1]?._id) || this.selectedFloorId;
        this.floorDialog = null;
        this.activeSpatialTab = "map";
        this.render();
      }
      return true;
    }

    if (form.matches("[data-floor-dialog-settings]")) {
      const floorId = form.dataset.floorDialogSettings;
      const label = String(data.get("label") || "").trim();
      const success = await this.execute(() => managementRepository.updateVenueFloor(this.id, floorId, { label }), "Impostazioni del piano aggiornate.");
      if (success) {
        this.floorDialog = null;
        this.render();
      }
      return true;
    }

    return venueMapInspectorMixin.handleMapAuthoringSubmit.call(this, form, data);
  },

  renderFloorDialog(editable) {
    if (!editable || !this.floorDialog) return "";
    if (this.floorDialog.type === "create") {
      return `<div class="venue-modal-backdrop" role="presentation"><section class="venue-modal-card" role="dialog" aria-modal="true" aria-labelledby="venue-floor-create-title"><header><div><span class="eyebrow">Nuovo piano</span><h3 id="venue-floor-create-title">Aggiungi un piano alla sede</h3></div><button class="button-secondary small" type="button" data-close-floor-dialog aria-label="Chiudi">×</button></header><p>Definisci il nome del piano. Planimetria e calibrazione si configurano subito dopo dalle impostazioni del piano.</p><form data-floor-dialog-create class="venue-inline-form"><label>Nome del piano<input name="label" required placeholder="Es. Piano terra"></label><div class="button-row"><button type="submit">Crea piano</button><button class="button-secondary" type="button" data-close-floor-dialog>Annulla</button></div></form></section></div>`;
    }

    const floor = (this.data.layout?.floors || []).find((entry) => id(entry._id) === id(this.floorDialog.floorId));
    if (!floor) return "";
    const floorPlaces = (this.data.layout?.places || []).filter((place) => id(place.floorId) === id(floor._id));
    const placeCount = floorPlaces.length;
    const slotPlaceIds = new Set(floorPlaces.map((place) => id(place._id)));
    const slotCount = (this.data.layout?.exhibitSlots || []).filter((slot) => slotPlaceIds.has(id(slot.placeId))).length;
    return `<div class="venue-modal-backdrop" role="presentation"><section class="venue-modal-card venue-floor-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="venue-floor-settings-title"><header><div><span class="eyebrow">Impostazioni piano</span><h3 id="venue-floor-settings-title">${escapeHtml(floor.label || "Piano")}</h3></div><button class="button-secondary small" type="button" data-close-floor-dialog aria-label="Chiudi">×</button></header><div class="venue-floor-dialog-summary"><span><strong>${placeCount}</strong> luoghi</span><span><strong>${slotCount}</strong> slot</span><span><strong>${floor.calibration ? "Calibrata" : "Non calibrata"}</strong> scala</span></div><form data-floor-dialog-settings="${escapeHtml(id(floor._id))}" class="venue-inline-form"><label>Nome del piano<input name="label" value="${escapeHtml(floor.label || "")}" required></label><button type="submit">Salva nome</button></form><section class="venue-floor-dialog-plan"><div><strong>Planimetria</strong><small>${floor.mapAsset ? `${floor.mapAsset.originalName || "Immagine caricata"} · ${floor.mapAsset.width}×${floor.mapAsset.height}px` : "Nessuna planimetria caricata"}</small></div><label class="venue-floor-plan-upload"><span>${floor.mapAsset ? "Sostituisci planimetria" : "Carica planimetria"}</span><small>JPEG, PNG o WebP · massimo 4 MB.</small><input type="file" accept="image/jpeg,image/png,image/webp" data-floor-plan-input data-floor-id="${escapeHtml(id(floor._id))}"></label>${floor.mapAsset ? `<p class="note">La sostituzione della planimetria invalida la calibrazione corrente; ArtAround richiederà una nuova scala prima delle metriche geometriche.</p>` : ""}</section><section class="venue-floor-dialog-danger"><div><strong>Rimuovi piano</strong><p>Prima della conferma ArtAround mostrerà l’impatto su luoghi, collegamenti, slot ed entità collocate.</p></div><button class="danger" type="button" data-floor-dialog-remove data-remove-floor="${escapeHtml(id(floor._id))}">Rimuovi piano</button></section></section></div>`;
  },
};