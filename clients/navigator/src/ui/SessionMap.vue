<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { MapProjection, NavigationProjection, SelectableLocationProjection } from "../infrastructure/http/navigationRepository";
import type { AvailableAction } from "../infrastructure/http/sessionRepository";

const props = withDefaults(defineProps<{
  map: MapProjection;
  navigation: NavigationProjection | null;
  currentVisitAnchorId: string | null;
  availableActions?: AvailableAction[];
  locationSelectionMode?: "confirm" | "correct" | null;
  selectionBusy?: boolean;
}>(), {
  availableActions: () => [],
  locationSelectionMode: null,
  selectionBusy: false,
});

const emit = defineEmits<{
  selectLocation: [location: SelectableLocationProjection["locationRef"]];
  selectAction: [action: AvailableAction];
}>();

const venueIndex = ref(0);
const selectedFloorId = ref<string | null>(null);
const zoom = ref(1);
const venue = computed(() => props.map.venues[venueIndex.value] || null);
const indoorActiveNavigation = computed(() => props.map.activeNavigation?.type === "indoor" ? props.map.activeNavigation : null);
const interVenueActiveNavigation = computed(() => props.map.activeNavigation?.type === "inter_venue" ? props.map.activeNavigation : null);
const effectiveNavigation = computed<NavigationProjection | null>(() => indoorActiveNavigation.value || props.navigation || null);
const physicalProgressAction = computed(() => props.availableActions.find((action) => action.type === "PHYSICAL_PROGRESS_NEXT") || null);
const correctLocationAction = computed(() => props.availableActions.find((action) => action.type === "LOCATION_CORRECT") || null);

function focusVenue(venueId: string | null | undefined) {
  if (!venueId) return;
  const index = props.map.venues.findIndex((candidate) => candidate.id === venueId);
  if (index >= 0) venueIndex.value = index;
}

watch(() => [
  props.map.knownLocation?.venueId || "",
  props.map.activeNavigation?.destination?.venueId || "",
  props.currentVisitAnchorId || "",
  props.locationSelectionMode || "",
].join("|"), () => {
  if (props.locationSelectionMode && props.map.knownLocation?.venueId) {
    focusVenue(props.map.knownLocation.venueId);
    return;
  }
  if (props.map.activeNavigation?.destination?.venueId) {
    focusVenue(props.map.activeNavigation.destination.venueId);
    return;
  }
  if (props.map.knownLocation?.venueId) {
    focusVenue(props.map.knownLocation.venueId);
    return;
  }
  if (props.currentVisitAnchorId) {
    const index = props.map.venues.findIndex((candidate) =>
      candidate.stops.some((stop) => stop.visitAnchorId === props.currentVisitAnchorId));
    if (index >= 0) venueIndex.value = index;
  }
}, { immediate: true });

watch([venue, () => props.currentVisitAnchorId, () => props.map.knownLocation?.floorId, () => props.locationSelectionMode, effectiveNavigation], ([value]) => {
  if (!value) { selectedFloorId.value = null; return; }
  if (props.locationSelectionMode && props.map.knownLocation?.venueId === value.id && props.map.knownLocation.floorId) {
    selectedFloorId.value = props.map.knownLocation.floorId;
    return;
  }
  const destination = effectiveNavigation.value?.destination;
  if (destination?.venueId === value.id && destination.floorId) {
    selectedFloorId.value = destination.floorId;
    return;
  }
  if (props.map.knownLocation?.venueId === value.id && props.map.knownLocation.floorId) {
    selectedFloorId.value = props.map.knownLocation.floorId;
    return;
  }
  const currentStop = value.stops.find((stop) => stop.visitAnchorId === props.currentVisitAnchorId);
  selectedFloorId.value = currentStop?.floorId || value.floors[0]?.id || null;
}, { immediate: true });

const floor = computed(() => venue.value?.floors.find((entry) => entry.id === selectedFloorId.value) || null);
const selectableLocations = computed(() => props.map.selectableLocations.filter((entry) => entry.venueId === venue.value?.id && entry.floorId === selectedFloorId.value));
const visiblePlaces = computed(() => selectableLocations.value.filter((location, index, locations) =>
  locations.findIndex((candidate) => candidate.placeId === location.placeId) === index));
const knownLocation = computed(() => props.map.knownLocation?.venueId === venue.value?.id && props.map.knownLocation.floorId === selectedFloorId.value ? props.map.knownLocation : null);
const navigationOverlays = computed(() => {
  const navigation = effectiveNavigation.value;
  if (!venue.value || navigation?.destination.venueId !== venue.value.id) return [];
  return navigation.route.overlays.filter((entry) => entry.floorId === selectedFloorId.value);
});

function placeAction(location: SelectableLocationProjection) {
  if (props.locationSelectionMode) return null;
  return props.availableActions.find((action) => action.actionId === `navigation.destination.${location.placeId}`) || null;
}

function setZoom(value: number) {
  zoom.value = Math.min(3, Math.max(1, Math.round(value * 4) / 4));
}

function zoomWithWheel(event: WheelEvent) {
  setZoom(zoom.value + (event.deltaY < 0 ? .25 : -.25));
}

watch([venueIndex, selectedFloorId], () => { zoom.value = 1; });

function pointStyle(point: { x: number; y: number }) {
  return { left: `${point.x * 100}%`, top: `${point.y * 100}%` };
}
</script>

<template>
  <section v-if="venue" class="session-map" aria-labelledby="map-heading">
    <header class="map-heading">
      <div><p class="eyebrow">Orientamento</p><h2 id="map-heading">Mappa</h2></div>
      <span v-if="map.knownLocation" class="location-status">Posizione confermata</span>
    </header>

    <aside v-if="locationSelectionMode" class="location-prompt" role="status">
      <strong>{{ locationSelectionMode === 'confirm' ? 'Dove ti trovi?' : 'Aggiorna la posizione' }}</strong>
      <span>Tocca un punto disponibile sulla planimetria. È una posizione confermata manualmente, non una rilevazione GPS.</span>
    </aside>

    <div v-if="map.venues.length > 1" class="map-tabs venue-tabs" aria-label="Sede">
      <button v-for="(candidate, index) in map.venues" :key="candidate.id" type="button" :aria-pressed="venueIndex === index" @click="venueIndex = index">{{ candidate.name }}</button>
    </div>
    <div class="map-tabs" aria-label="Piano">
      <button v-for="candidate in venue.floors" :key="candidate.id" type="button" :aria-pressed="selectedFloorId === candidate.id" @click="selectedFloorId = candidate.id">{{ candidate.label }}</button>
    </div>

    <div v-if="floor?.map.available && floor.map.imageUrl" class="map-zoom-region">
      <div class="map-zoom-controls" aria-label="Zoom della mappa">
        <button type="button" aria-label="Riduci la mappa" :disabled="zoom <= 1" @click="setZoom(zoom - .25)">−</button>
        <output aria-live="polite">{{ Math.round(zoom * 100) }}%</output>
        <button type="button" aria-label="Ingrandisci la mappa" :disabled="zoom >= 3" @click="setZoom(zoom + .25)">+</button>
        <button type="button" :disabled="zoom === 1" @click="setZoom(1)">Ripristina</button>
      </div>
      <div class="map-viewport" @wheel.ctrl.prevent="zoomWithWheel" @dblclick="setZoom(zoom < 2 ? zoom + .5 : 1)">
        <div class="map-canvas" :style="{ width: `${zoom * 100}%` }">
          <img :src="floor.map.imageUrl" :alt="`Mappa ${floor.label} — ${venue.name}`">
          <svg class="map-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <polyline v-for="(overlay, index) in navigationOverlays" :key="`navigation-${index}`" :points="overlay.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')" fill="none" vector-effect="non-scaling-stroke" class="navigation-route" />
          </svg>

          <template v-for="location in visiblePlaces" :key="`place-${location.placeId}`">
            <button v-if="placeAction(location)" type="button" class="map-marker place-marker place-action" :style="pointStyle(location.position)" :title="`Vai a ${location.label}`" :aria-label="`Vai a ${location.label}`" :disabled="selectionBusy || Boolean(locationSelectionMode)" @click="emit('selectAction', placeAction(location)!)">•</button>
            <span v-else class="map-marker place-marker" :style="pointStyle(location.position)" :title="`${location.category}: ${location.label}`" :aria-label="location.label">•</span>
          </template>

          <span v-if="knownLocation && !locationSelectionMode" class="map-marker known-location-marker" :style="pointStyle(knownLocation.position)" title="Ultima posizione confermata" aria-label="Ultima posizione confermata"></span>
          <span v-if="!locationSelectionMode && effectiveNavigation && effectiveNavigation.destination.venueId === venue.id && effectiveNavigation.destination.floorId === selectedFloorId" class="map-marker destination-marker" :style="pointStyle(effectiveNavigation.destination.position)" :title="effectiveNavigation.destination.label">◎</span>

          <button v-for="location in locationSelectionMode ? selectableLocations : []" :key="`select-${location.kind}-${location.placeId}-${location.visitAnchorId || ''}`" type="button" class="selectable-location-marker" :style="pointStyle(location.position)" :title="`Conferma: ${location.label}`" :aria-label="`Conferma posizione: ${location.label}`" :disabled="selectionBusy" @click="emit('selectLocation', location.locationRef)">⌖</button>
        </div>
      </div>
    </div>
    <p v-else role="status">Per questo piano non è disponibile un asset cartografico.</p>

    <p v-if="map.knownLocation" class="logical-position-note">Il punto pieno mostra l'ultima posizione confermata. Il percorso evidenziato è soltanto quello ancora da percorrere verso la destinazione corrente.</p>

    <article v-if="interVenueActiveNavigation" class="destination-summary">
      <span class="destination-mark" aria-hidden="true">⇢</span>
      <div><small>Trasferimento</small><strong>{{ interVenueActiveNavigation.route.transferInstruction || 'Raggiungi la sede successiva' }}</strong><span>circa {{ interVenueActiveNavigation.route.estimatedSeconds }} s</span></div>
    </article>
    <article v-else-if="effectiveNavigation && effectiveNavigation.destination.venueId === venue.id" class="destination-summary">
      <span class="destination-mark" aria-hidden="true">◎</span>
      <div><small>{{ map.activeNavigation?.intent === 'physical_detour' ? 'Deviazione' : 'Destinazione corrente' }}</small><strong>{{ effectiveNavigation.destination.label }}</strong><span>{{ effectiveNavigation.route.distanceMeters }} m · circa {{ effectiveNavigation.route.estimatedSeconds }} s</span></div>
    </article>

    <section v-if="!locationSelectionMode" class="map-actions" aria-label="Azioni sulla mappa">
      <div class="action-row map-primary-actions">
        <button v-if="physicalProgressAction" type="button" class="physical-progress-action" :disabled="selectionBusy" @click="emit('selectAction', physicalProgressAction)">{{ physicalProgressAction.label }}</button>
        <button v-if="correctLocationAction" type="button" :disabled="selectionBusy" @click="emit('selectAction', correctLocationAction)">{{ correctLocationAction.label }}</button>
      </div>
    </section>

    <ol v-if="effectiveNavigation?.route.instructions.length" class="route-instructions" aria-label="Indicazioni correnti">
      <li v-for="(instruction, index) in effectiveNavigation.route.instructions" :key="`${instruction}-${index}`">{{ instruction }}</li>
    </ol>
    <ul v-if="venue.warnings.length" class="map-warnings"><li v-for="warning in venue.warnings" :key="`${warning.code}-${warning.message}`">{{ warning.message }}</li></ul>
  </section>
</template>

<style scoped>
.session-map { --navigator-route-active:#7b2334; padding-bottom:1rem; }
.map-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; margin-bottom:.8rem; }
.map-heading p,.map-heading h2 { margin:0; }
.map-heading h2 { margin-top:.15rem; font-family:Georgia,"Times New Roman",serif; font-size:clamp(1.8rem,7vw,2.4rem); font-weight:500; }
.eyebrow { color:var(--navigator-primary); font-size:.68rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
.location-status,.logical-position-note { color:var(--navigator-muted); font-size:.72rem; }
.location-prompt { display:grid; gap:.2rem; margin:.7rem 0; padding:.75rem .85rem; border:1px solid color-mix(in srgb,var(--navigator-primary) 35%,var(--navigator-border)); border-radius:.9rem; background:color-mix(in srgb,var(--navigator-primary) 7%,var(--navigator-surface-raised)); }
.location-prompt span { color:var(--navigator-muted); font-size:.75rem; line-height:1.45; }
.map-tabs { display:flex; gap:.45rem; flex-wrap:wrap; margin-block:.55rem; }
.map-tabs button,.map-actions button { min-height:38px; padding:.45rem .7rem; border:1px solid var(--navigator-border); border-radius:.65rem; color:var(--navigator-ink); background:var(--navigator-surface-raised); font:inherit; font-size:.78rem; font-weight:720; }
.map-tabs button[aria-pressed="true"] { border-color:var(--navigator-primary); color:var(--navigator-primary); background:color-mix(in srgb,var(--navigator-primary) 9%,var(--navigator-surface-raised)); }
.venue-tabs { overflow-x:auto; flex-wrap:nowrap; }
.map-zoom-region { margin-top:.8rem; }
.map-zoom-controls { display:flex; justify-content:flex-end; align-items:center; gap:.35rem; margin-bottom:.45rem; }
.map-zoom-controls button { min-width:2.5rem; min-height:2.5rem; padding:.35rem .55rem; border:1px solid var(--navigator-border); border-radius:.65rem; background:var(--navigator-surface-raised); color:var(--navigator-ink); font-weight:800; }
.map-zoom-controls output { min-width:3.2rem; color:var(--navigator-muted); font-size:.75rem; font-weight:750; text-align:center; }
.map-viewport { max-height:65dvh; overflow:auto; border:1px solid var(--navigator-border); border-radius:1.2rem; overscroll-behavior:contain; touch-action:pan-x pan-y; background:var(--navigator-surface-raised); }
.map-canvas { position:relative; min-width:100%; overflow:hidden; background:var(--navigator-surface-raised); }
.map-canvas img { display:block; width:100%; height:auto; }
.map-overlay { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.navigation-route { stroke:var(--navigator-route-active); stroke-width:2.5; stroke-linecap:round; stroke-linejoin:round; filter:drop-shadow(0 1px 1px color-mix(in srgb,var(--navigator-route-active) 35%,transparent)); }
.map-marker,.selectable-location-marker { position:absolute; transform:translate(-50%,-50%); z-index:2; }
.place-marker { display:grid; place-items:center; width:1.65rem; height:1.65rem; padding:0; border:2px solid color-mix(in srgb,var(--navigator-primary) 62%,transparent); border-radius:50%; color:color-mix(in srgb,var(--navigator-primary) 78%,transparent); background:color-mix(in srgb,var(--navigator-surface-raised) 58%,transparent); box-shadow:0 2px 7px rgba(0,0,0,.14); opacity:.72; font-size:.8rem; font-weight:900; }
.place-action { cursor:pointer; font:inherit; }
.place-action:hover,.place-action:focus-visible { opacity:1; }
.place-action:disabled { cursor:default; opacity:.4; }
.known-location-marker { width:1rem; height:1rem; border:3px solid var(--navigator-surface-raised); border-radius:50%; background:var(--navigator-ink); box-shadow:0 0 0 2px var(--navigator-primary); }
.destination-marker { display:grid; place-items:center; width:1.9rem; height:1.9rem; border:2px solid var(--navigator-route-active); border-radius:50%; color:var(--navigator-route-active); background:var(--navigator-surface-raised); font-weight:900; }
.selectable-location-marker { width:2rem; height:2rem; border:2px solid var(--navigator-primary); border-radius:50%; color:var(--navigator-primary); background:var(--navigator-surface-raised); font-weight:900; }
.logical-position-note { margin:.6rem 0 0; line-height:1.45; }
.destination-summary { display:flex; gap:.65rem; align-items:center; margin-top:.85rem; padding:.8rem; border:1px solid var(--navigator-border); border-radius:.9rem; background:var(--navigator-surface-raised); }
.destination-summary div { display:grid; gap:.15rem; }
.destination-summary small,.destination-summary span { color:var(--navigator-muted); }
.destination-mark { color:var(--navigator-route-active); font-size:1.35rem; font-weight:900; }
.map-actions { display:grid; gap:.8rem; margin-top:.9rem; }
.action-row { display:flex; flex-wrap:wrap; gap:.45rem; }
.map-primary-actions { padding-top:.7rem; border-top:1px solid var(--navigator-border); }
.map-actions .physical-progress-action { border-color:var(--navigator-route-active); color:#fff; background:var(--navigator-route-active); }
.route-instructions { display:grid; gap:.45rem; margin:.9rem 0 0; padding-left:1.35rem; color:var(--navigator-muted); font-size:.82rem; line-height:1.45; }
.map-warnings { color:var(--navigator-muted); font-size:.78rem; }
</style>
