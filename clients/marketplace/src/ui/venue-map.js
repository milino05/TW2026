import { icon } from "./icons.js";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function id(value) { return String(value?._id || value?.id || value || ""); }
function pct(value) { return Math.max(0, Math.min(100, Number(value ?? .5) * 100)); }
function labelPlacement(point) {
  if (Number(point?.y) < .16) return "below";
  if (Number(point?.y) > .84) return "above";
  if (Number(point?.x) < .12) return "right";
  if (Number(point?.x) > .88) return "left";
  return "above";
}

export class ArtAroundVenueMap extends HTMLElement {
  _data = null;
  _focusTargetId = "";
  activeFloorId = "";
  selectedPlaceId = "";

  connectedCallback() {
    this.addEventListener("change", this.onChange);
    this.addEventListener("click", this.onClick);
    this.syncFocus();
    this.render();
  }
  disconnectedCallback() {
    this.removeEventListener("change", this.onChange);
    this.removeEventListener("click", this.onClick);
  }

  set data(value) {
    this._data = value || null;
    this.syncFocus();
    this.render();
  }
  get data() { return this._data; }

  set focusTargetId(value) {
    this._focusTargetId = id(value);
    this.syncFocus({ preferFocus: true });
    this.render();
  }
  get focusTargetId() { return this._focusTargetId; }

  floors() { return this._data?.map?.floors || []; }
  places() { return this._data?.map?.places || []; }
  slots() { return this._data?.map?.exhibitSlots || []; }
  targets() { return this._data?.targets || []; }

  focusContext() {
    const targetId = id(this._focusTargetId);
    if (!targetId) return null;
    const target = this.targets().find((entry) => id(entry.id) === targetId);
    if (!target) return null;
    const slot = this.slots().find((entry) => id(entry.assignedVenueTargetId) === targetId || id(entry.id) === id(target.exhibitSlotId));
    if (!slot) return { target, slot: null, place: null, floor: null };
    const place = this.places().find((entry) => id(entry.id) === id(slot.placeId)) || null;
    const floor = place ? this.floors().find((entry) => id(entry.id) === id(place.floorId)) || null : null;
    return { target, slot, place, floor };
  }

  syncFocus({ preferFocus = false } = {}) {
    const floors = this.floors();
    const floorIds = new Set(floors.map((entry) => id(entry.id)));
    const focused = this.focusContext();
    if (focused?.floor && (preferFocus || !floorIds.has(id(this.activeFloorId)))) {
      this.activeFloorId = id(focused.floor.id);
      this.selectedPlaceId = id(focused.place?.id);
      return;
    }
    if (!floorIds.has(id(this.activeFloorId))) this.activeFloorId = id(floors[0]?.id);
  }

  onChange = (event) => {
    const select = event.target instanceof HTMLSelectElement ? event.target.closest("select[data-map-floor]") : null;
    if (!select) return;
    this.activeFloorId = select.value;
    this.selectedPlaceId = "";
    this.render();
  };

  onClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const place = target?.closest("button[data-map-place]");
    if (!place) return;
    this.selectedPlaceId = place.dataset.mapPlace || "";
    this.render();
  };

  targetForSlot(slot) {
    return this.targets().find((entry) => id(entry.id) === id(slot.assignedVenueTargetId)) || null;
  }

  targetsForPlace(placeId) {
    return this.slots()
      .filter((slot) => id(slot.placeId) === id(placeId) && slot.assignedVenueTargetId)
      .map((slot) => ({ slot, target: this.targetForSlot(slot) }))
      .filter((entry) => entry.target);
  }

  renderPlaceDetail(place) {
    if (!place) return `<aside class="venue-map-detail"><span class="eyebrow">Mappa</span><h3>Seleziona un luogo</h3><p>Scegli un punto sulla planimetria per vedere le entità pubblicamente esposte in quel luogo.</p></aside>`;
    const entries = this.targetsForPlace(place.id);
    const focusedId = id(this._focusTargetId);
    const cards = entries.map(({ slot, target }) => `<article data-focused="${id(target.id) === focusedId}"><div><strong>${escapeHtml(target.label || "Entità")}</strong><small>${escapeHtml(slot.label || place.label || "Collocazione pubblicata")}</small></div>${target.recognitionMedia?.[0]?.url ? `<img src="${escapeHtml(target.recognitionMedia[0].url)}" alt="${escapeHtml(target.recognitionMedia[0].altText || target.label || "")}" loading="lazy">` : ""}</article>`).join("");
    return `<aside class="venue-map-detail"><span class="eyebrow">Luogo</span><h3>${escapeHtml(place.label || "Luogo")}</h3>${cards ? `<div class="venue-map-detail-targets">${cards}</div>` : `<p>Nessuna entità pubblicamente esposta in questo luogo.</p>`}</aside>`;
  }

  render() {
    const map = this._data?.map;
    if (!map) {
      this.innerHTML = `<div class="empty-state compact"><p>Mappa pubblica non disponibile.</p></div>`;
      return;
    }
    const floors = this.floors();
    if (!floors.length) {
      this.innerHTML = `<div class="empty-state compact"><p>La configurazione pubblicata non contiene piani.</p></div>`;
      return;
    }
    this.syncFocus();
    const floor = floors.find((entry) => id(entry.id) === id(this.activeFloorId)) || floors[0];
    const floorId = id(floor.id);
    const places = this.places().filter((entry) => id(entry.floorId) === floorId);
    const placeById = new Map(places.map((entry) => [id(entry.id), entry]));
    const connections = (map.connections || []).filter((entry) => placeById.has(id(entry.fromPlaceId)) && placeById.has(id(entry.toPlaceId)));
    const focused = this.focusContext();
    const focusedPlaceId = focused?.floor && id(focused.floor.id) === floorId ? id(focused.place?.id) : "";
    const selectedPlace = placeById.get(id(this.selectedPlaceId || focusedPlaceId)) || null;
    const floorOptions = floors.map((entry) => `<option value="${escapeHtml(id(entry.id))}" ${id(entry.id) === floorId ? "selected" : ""}>${escapeHtml(entry.label || "Piano")}</option>`).join("");
    const lines = connections.map((connection) => {
      const from = placeById.get(id(connection.fromPlaceId));
      const to = placeById.get(id(connection.toPlaceId));
      const points = connection.geometry?.points?.length ? connection.geometry.points : [from.position, to.position];
      return `<polyline class="connection-line" points="${points.map((point) => `${pct(point.x)},${pct(point.y)}`).join(" ")}" vector-effect="non-scaling-stroke"></polyline>`;
    }).join("");
    const nodes = places.map((place, index) => {
      const entries = this.targetsForPlace(place.id);
      const selected = id(selectedPlace?.id) === id(place.id);
      const focus = focusedPlaceId === id(place.id);
      const label = place.label || `Luogo ${index + 1}`;
      return `<button type="button" class="map-place-node venue-map-node--readonly${selected ? " selected" : ""}${focus ? " focused" : ""}" data-map-place="${escapeHtml(id(place.id))}" data-label-placement="${labelPlacement(place.position)}" style="left:${pct(place.position?.x)}%;top:${pct(place.position?.y)}%" aria-label="${escapeHtml(`${label}${entries.length ? `, ${entries.length} entità esposte` : ""}`)}" aria-pressed="${selected}"><span class="map-object-label map-place-label" aria-hidden="true">${escapeHtml(label)}</span>${entries.length ? `<small>${entries.length}</small>` : ""}</button>`;
    }).join("");
    const ratio = floor.mapAsset?.width && floor.mapAsset?.height ? `${floor.mapAsset.width}/${floor.mapAsset.height}` : "10/7";
    const focusBanner = focused?.target
      ? `<div class="venue-map-focus" role="status">${icon("pin", { size: 16 })}<span><small>In evidenza</small><strong>${escapeHtml(focused.target.label || "Entità")}</strong>${focused.place ? `<em>${escapeHtml(`${focused.floor?.label || "Piano"} · ${focused.place.label || "Luogo"}`)}</em>` : `<em>Collocazione non disponibile</em>`}</span></div>`
      : "";
    this.innerHTML = `<style>
      :host{display:block}.venue-map-shell{display:grid;gap:1rem}.venue-map-toolbar{display:flex;align-items:end;justify-content:space-between;gap:.8rem;flex-wrap:wrap}.venue-map-toolbar label{display:grid;gap:.3rem;min-width:12rem}.venue-map-toolbar small{color:var(--sage-600)}
      .venue-map-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(15rem,20rem);gap:1rem;align-items:start}.venue-map-canvas.map-canvas--authoring{min-height:22rem;cursor:default;background-color:var(--sage-100)}.venue-map-canvas.map-canvas--authoring>img{object-fit:fill}.venue-map-canvas.map-canvas--authoring>svg{pointer-events:none}.venue-map-canvas.map-canvas--authoring .connection-line{fill:none;stroke:var(--ink-800);stroke-width:1.15;opacity:.72}.venue-map-placeholder{position:absolute;inset:0;display:grid;place-items:center;padding:2rem;color:var(--sage-600);text-align:center;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:2rem 2rem}
      .venue-map-node--readonly{cursor:pointer}.venue-map-node--readonly.focused{outline:.25rem solid var(--amber-300);outline-offset:.18rem}.venue-map-node--readonly.focused .map-place-label{opacity:1}.venue-map-node--readonly[aria-pressed="true"]{box-shadow:0 0 0 .22rem var(--sage-300),0 .18rem .7rem rgba(0,0,0,.28)}
      .venue-map-detail{display:grid;gap:.6rem;padding:1rem;border:1px solid var(--line);border-radius:var(--radius-lg);background:var(--surface)}.venue-map-detail h3,.venue-map-detail p{margin:0}.venue-map-detail-targets{display:grid;gap:.55rem}.venue-map-detail-targets article{display:grid;grid-template-columns:minmax(0,1fr) 3.5rem;gap:.6rem;align-items:center;padding:.65rem;border:1px solid var(--line);border-radius:var(--radius-sm);background:var(--sage-50)}.venue-map-detail-targets article[data-focused="true"]{border-color:var(--amber-400);background:var(--amber-100)}.venue-map-detail-targets article>div{display:grid;gap:.15rem}.venue-map-detail-targets small{color:var(--sage-600)}.venue-map-detail-targets img{width:3.5rem;height:3.5rem;border-radius:.45rem;object-fit:cover}
      .venue-map-focus{display:flex;align-items:center;gap:.6rem;padding:.7rem .8rem;border:1px solid var(--amber-300);border-radius:var(--radius-md);background:var(--amber-100)}.venue-map-focus>span{display:grid}.venue-map-focus small,.venue-map-focus em{color:var(--sage-700);font-size:.75rem;font-style:normal}
      @media(max-width:48rem){.venue-map-layout{grid-template-columns:1fr}.venue-map-canvas.map-canvas--authoring{min-height:18rem}}
      @media(prefers-reduced-motion:reduce){.venue-map-node--readonly{transition:none!important}}
    </style><div class="venue-map-shell">${focusBanner}<div class="venue-map-toolbar"><label>Piano<select data-map-floor>${floorOptions}</select></label><small>Mostra esclusivamente la configurazione fisica pubblicata.</small></div><div class="venue-map-layout"><div class="map-canvas map-canvas--authoring venue-map-canvas" data-map-surface data-readonly="true" style="--map-ratio:${ratio}">${floor.mapAsset?.url ? `<img src="${escapeHtml(floor.mapAsset.url)}" alt="Planimetria ${escapeHtml(floor.label || "piano")}" loading="lazy" draggable="false">` : `<div class="venue-map-placeholder">Nessuna planimetria pubblicata per questo piano.</div>`}<svg viewBox="0 0 100 100" preserveAspectRatio="none">${lines}</svg>${nodes}</div>${this.renderPlaceDetail(selectedPlace)}</div></div>`;
  }
}

customElements.define("artaround-venue-map", ArtAroundVenueMap);
