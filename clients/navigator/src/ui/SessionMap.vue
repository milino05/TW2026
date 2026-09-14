<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type {
  MapProjection,
  NavigationProjection,
  SelectableLocationProjection,
} from "../infrastructure/http/navigationRepository";

const props = withDefaults(defineProps<{
  map: MapProjection;
  navigation: NavigationProjection | null;
  currentVisitAnchorId: string | null;
  locationSelectionMode?: "confirm" | "correct" | null;
  selectionBusy?: boolean;
}>(), {
  locationSelectionMode: null,
  selectionBusy: false,
});

const emit = defineEmits<{
  selectLocation: [location: SelectableLocationProjection["locationRef"]];
}>();

const venueIndex = ref(0);
const selectedFloorId = ref<string | null>(null);
const venue = computed(() => props.map.venues[venueIndex.value] || null);
const indoorActiveNavigation = computed(() => props.map.activeNavigation?.type === "indoor" ? props.map.activeNavigation : null);
const interVenueActiveNavigation = computed(() => props.map.activeNavigation?.type === "inter_venue" ? props.map.activeNavigation : null);
const effectiveNavigation = computed<NavigationProjection | null>(() => indoorActiveNavigation.value || props.navigation || null);

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
  if (props.currentVisitAnchorId) {
    const index = props.map.venues.findIndex((candidate) =>
      candidate.stops.some((stop) => stop.visitAnchorId === props.currentVisitAnchorId));
    if (index >= 0) venueIndex.value = index;
  }
}, { immediate: true });

watch([venue, () => props.currentVisitAnchorId, () => props.map.knownLocation?.floorId, () => props.locationSelectionMode], ([value]) => {
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
  const currentStop = value.stops.find((stop) => stop.visitAnchorId === props.currentVisitAnchorId);
  selectedFloorId.value = currentStop?.floorId || value.floors[0]?.id || null;
}, { immediate: true });

const floor = computed(() => venue.value?.floors.find((entry) => entry.id === selectedFloorId.value) || null);
const stops = computed(() => venue.value?.stops.filter((entry) => entry.floorId === selectedFloorId.value) || []);
const facilities = computed(() => venue.value?.facilities.filter((entry) => entry.floorId === selectedFloorId.value) || []);
const selectableLocations = computed(() => props.map.selectableLocations.filter((entry) =>
  entry.venueId === venue.value?.id && entry.floorId === selectedFloorId.value));
const knownLocation = computed(() => props.map.knownLocation?.venueId === venue.value?.id
  && props.map.knownLocation.floorId === selectedFloorId.value
  ? props.map.knownLocation
  : null);
const orderedStops = computed(() => props.map.venues
  .flatMap((candidate) => candidate.stops.map((stop) => ({
    ...stop,
    venueName: candidate.name,
    floorLabel: candidate.floors.find((candidateFloor) => candidateFloor.id === stop.floorId)?.label || stop.floorId,
  })))
  .sort((left, right) => left.order - right.order));
const currentStop = computed(() => orderedStops.value.find((stop) => stop.visitAnchorId === props.currentVisitAnchorId) || null);
const nextStop = computed(() => currentStop.value
  ? orderedStops.value.find((stop) => stop.order > currentStop.value!.order) || null
  : orderedStops.value[0] || null);
const plannedLeg = computed(() => props.map.plannedLegs.find((entry) => entry.fromVisitAnchorId === props.currentVisitAnchorId) || null);
const plannedSteps = computed(() => {
  const leg = plannedLeg.value;
  if (!leg) return [];
  return [
    ...(leg.transferInstruction ? [{ key: "transfer", label: "Trasferimento", instruction: leg.transferInstruction }] : []),
    ...leg.macroSteps.flatMap((step, index) => step.instruction
      ? [{ key: `macro-${index}`, label: "Percorso", instruction: step.instruction }]
      : []),
    ...(leg.approachStep ? [{ key: "approach", label: "Ultimi passi", instruction: leg.approachStep.instruction }] : []),
  ];
});
const plannedOverlays = computed(() => venue.value?.route.overlays.filter((entry) => entry.floorId === selectedFloorId.value) || []);
const navigationOverlays = computed(() => {
  const navigation = effectiveNavigation.value;
  if (!venue.value || navigation?.destination.venueId !== venue.value.id) return [];
  return navigation.route.overlays.filter((entry) => entry.floorId === selectedFloorId.value);
});

function pointStyle(point: { x: number; y: number }) {
  return { left: `${point.x * 100}%`, top: `${point.y * 100}%` };
}
</script>

<template>
  <section v-if="venue" class="session-map" aria-labelledby="map-heading">
    <header class="map-heading">
      <div>
        <p class="eyebrow">Orientamento</p>
        <h2 id="map-heading">Mappa</h2>
      </div>
      <span v-if="map.knownLocation" class="location-status">Posizione confermata</span>
    </header>

    <aside v-if="locationSelectionMode" class="location-prompt" role="status">
      <strong>{{ locationSelectionMode === 'confirm' ? 'Dove ti trovi?' : 'Aggiorna la posizione' }}</strong>
      <span>Tocca un punto disponibile sulla planimetria. È una posizione confermata manualmente, non una rilevazione GPS.</span>
    </aside>

    <div v-if="map.venues.length > 1" class="map-tabs venue-tabs" aria-label="Sede">
      <button
        v-for="(candidate, index) in map.venues"
        :key="candidate.id"
        type="button"
        :aria-pressed="venueIndex === index"
        @click="venueIndex = index"
      >{{ candidate.name }}</button>
    </div>
    <div class="map-tabs" aria-label="Piano">
      <button
        v-for="candidate in venue.floors"
        :key="candidate.id"
        type="button"
        :aria-pressed="selectedFloorId === candidate.id"
        @click="selectedFloorId = candidate.id"
      >{{ candidate.label }}</button>
    </div>

    <div v-if="floor?.map.available && floor.map.imageUrl" class="map-canvas">
      <img :src="floor.map.imageUrl" :alt="`Mappa ${floor.label} — ${venue.name}`">
      <svg class="map-overlay" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline
          v-for="(overlay, index) in plannedOverlays"
          :key="`planned-${index}`"
          :points="overlay.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')"
          fill="none"
          vector-effect="non-scaling-stroke"
        />
        <polyline
          v-for="(overlay, index) in navigationOverlays"
          :key="`navigation-${index}`"
          :points="overlay.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')"
          fill="none"
          vector-effect="non-scaling-stroke"
          class="navigation-route"
        />
      </svg>

      <span
        v-for="stop in stops"
        :key="stop.visitAnchorId"
        class="map-marker stop-marker"
        :class="{ current: stop.visitAnchorId === currentVisitAnchorId, experienced: stop.experienced }"
        :style="pointStyle(stop.position)"
        :title="stop.label"
      >{{ stop.order }}</span>
      <span
        v-for="facility in facilities"
        :key="facility.id"
        class="map-marker facility-marker"
        :style="pointStyle(facility.position)"
        :title="`${facility.category}: ${facility.label}`"
      >•</span>
      <span
        v-if="knownLocation"
        class="map-marker known-location-marker"
        :style="pointStyle(knownLocation.position)"
        title="Ultima posizione confermata"
        aria-label="Ultima posizione confermata"
      ></span>
      <span
        v-if="effectiveNavigation && effectiveNavigation.destination.venueId === venue.id && effectiveNavigation.destination.floorId === selectedFloorId"
        class="map-marker destination-marker"
        :style="pointStyle(effectiveNavigation.destination.position)"
        :title="effectiveNavigation.destination.label"
      >◎</span>

      <button
        v-for="location in locationSelectionMode ? selectableLocations : []"
        :key="`select-${location.kind}-${location.placeId}-${location.visitAnchorId || ''}`"
        type="button"
        class="selectable-location-marker"
        :style="pointStyle(location.position)"
        :title="`Conferma: ${location.label}`"
        :aria-label="`Conferma posizione: ${location.label}`"
        :disabled="selectionBusy"
        @click="emit('selectLocation', location.locationRef)"
      >⌖</button>
    </div>
    <p v-else role="status">Per questo piano non è disponibile un asset cartografico.</p>

    <p class="logical-position-note">
      Il punto rosso mostra l'ultima posizione confermata al Navigator. Non indica una localizzazione automatica del telefono.
    </p>

    <article v-if="interVenueActiveNavigation" class="destination-summary">
      <span class="destination-mark" aria-hidden="true">⇢</span>
      <div>
        <small>Trasferimento</small>
        <strong>{{ interVenueActiveNavigation.route.transferInstruction || 'Raggiungi la sede successiva' }}</strong>
        <span>circa {{ interVenueActiveNavigation.route.estimatedSeconds }} s</span>
      </div>
    </article>
    <article v-else-if="effectiveNavigation && effectiveNavigation.destination.venueId === venue.id" class="destination-summary">
      <span class="destination-mark" aria-hidden="true">◎</span>
      <div>
        <small>{{ map.activeNavigation?.intent === 'physical_detour' ? 'Deviazione' : 'Destinazione corrente' }}</small>
        <strong>{{ effectiveNavigation.destination.label }}</strong>
        <span>{{ effectiveNavigation.route.distanceMeters }} m · circa {{ effectiveNavigation.route.estimatedSeconds }} s</span>
      </div>
    </article>
    <article v-else-if="nextStop" class="destination-summary">
      <span class="destination-mark">{{ nextStop.order }}</span>
      <div>
        <small>Prossima tappa</small>
        <strong>{{ nextStop.label }}</strong>
        <span>{{ nextStop.venueName }} · {{ nextStop.floorLabel }}</span>
      </div>
    </article>

    <ol v-if="effectiveNavigation?.route.instructions.length" class="route-instructions" aria-label="Indicazioni correnti">
      <li v-for="(instruction, index) in effectiveNavigation.route.instructions" :key="`${instruction}-${index}`">{{ instruction }}</li>
    </ol>
    <ol v-else-if="plannedSteps.length" class="planned-guidance" aria-label="Indicazioni pianificate verso la prossima tappa">
      <li v-for="step in plannedSteps" :key="step.key">
        <small>{{ step.label }}</small>
        <span>{{ step.instruction }}</span>
      </li>
    </ol>

    <ul v-if="venue.warnings.length" class="map-warnings">
      <li v-for="warning in venue.warnings" :key="`${warning.code}-${warning.message}`">{{ warning.message }}</li>
    </ul>
  </section>
</template>

<style scoped>
.session-map { padding-bottom:1rem; }
.map-heading { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; margin-bottom:.8rem; }
.map-heading p, .map-heading h2 { margin:0; }
.map-heading h2 { margin-top:.15rem; font-family:Georgia,"Times New Roman",serif; font-size:clamp(1.8rem,7vw,2.4rem); font-weight:500; }
.eyebrow { color:var(--navigator-primary); font-size:.68rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
.location-status { color:var(--navigator-muted); font-size:.72rem; font-weight:760; }
.location-prompt { display:grid; gap:.2rem; margin:.7rem 0; padding:.75rem .85rem; border:1px solid color-mix(in srgb,var(--navigator-primary) 35%,var(--navigator-border)); border-radius:.9rem; background:color-mix(in srgb,var(--navigator-primary) 7%,var(--navigator-surface-raised)); }
.location-prompt strong { font-size:.9rem; }
.location-prompt span { color:var(--navigator-muted); font-size:.75rem; line-height:1.45; }
.map-tabs { display:flex; align-items:center; gap:.45rem; flex-wrap:wrap; margin-block:.55rem; }
.map-tabs button { min-height:38px; padding:.45rem .7rem; border:1px solid var(--navigator-border); border-radius:.65rem; color:var(--navigator-ink); background:var(--navigator-surface-raised); font:inherit; font-size:.78rem; font-weight:720; }
.map-tabs button[aria-pressed="true"] { border-color:var(--navigator-primary); color:var(--navigator-primary); background:color-mix(in srgb,var(--navigator-primary) 9%,var(--navigator-surface-raised)); }
.venue-tabs { padding-bottom:.25rem; overflow-x:auto; flex-wrap:nowrap; }
.map-canvas { position:relative; margin-top:.8rem; overflow:hidden; border:1px solid var(--navigator-border); border-radius:1.2rem; background:var(--navigator-surface-raised); }
.map-canvas img { display:block; width:100%; height:auto; }
.map-overlay { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.map-overlay polyline { stroke:var(--navigator-muted); stroke-width:1.1; stroke-dasharray:2 1; }
.map-overlay .navigation-route { stroke:var(--navigator-primary); stroke-width:1.9; stroke-dasharray:none; }
.map-marker, .selectable-location-marker { position:absolute; transform:translate(-50%,-50%); z-index:2; }
.map-marker { display:grid; place-items:center; min-width:1.65rem; height:1.65rem; padding:0 .35rem; border:2px solid var(--navigator-surface-raised); border-radius:999px; box-shadow:0 2px 7px rgba(0,0,0,.22); font-size:.7rem; font-weight:850; }
.stop-marker { color:var(--navigator-ink); background:var(--navigator-surface-raised); }
.stop-marker.experienced { border-color:color-mix(in srgb,var(--navigator-primary) 45%,var(--navigator-surface-raised)); }
.stop-marker.current { color:var(--navigator-on-primary); background:var(--navigator-primary); }
.facility-marker { color:var(--navigator-primary); background:var(--navigator-surface-raised); }
.destination-marker { z-index:4; color:var(--navigator-on-primary); background:var(--navigator-primary); }
.known-location-marker { z-index:5; width:1rem; min-width:1rem; height:1rem; padding:0; border:3px solid white; background:#d93232; box-shadow:0 0 0 2px rgba(0,0,0,.12),0 2px 8px rgba(0,0,0,.3); }
.selectable-location-marker { z-index:6; width:2rem; height:2rem; padding:0; border:2px solid var(--navigator-primary); border-radius:50%; color:var(--navigator-primary); background:var(--navigator-surface-raised); box-shadow:0 3px 10px rgba(0,0,0,.2); font-size:1rem; font-weight:900; }
.selectable-location-marker:disabled { opacity:.55; }
.logical-position-note { margin:.75rem 0; color:var(--navigator-muted); font-size:.72rem; line-height:1.45; }
.destination-summary { display:grid; grid-template-columns:2.5rem minmax(0,1fr); gap:.75rem; align-items:center; margin:.85rem 0 0; padding:.75rem; border:1px solid var(--navigator-border); border-radius:.9rem; background:var(--navigator-surface-raised); }
.destination-mark { width:2.4rem; height:2.4rem; display:grid; place-items:center; border-radius:50%; color:var(--navigator-on-primary); background:var(--navigator-primary); font-weight:850; }
.destination-summary div { min-width:0; display:grid; gap:.12rem; }
.destination-summary small { color:var(--navigator-muted); font-size:.68rem; font-weight:760; text-transform:uppercase; letter-spacing:.06em; }
.destination-summary strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.destination-summary span { color:var(--navigator-muted); font-size:.74rem; }
.planned-guidance, .route-instructions { display:grid; gap:.55rem; margin:.85rem 0 0; padding:0; list-style:none; }
.planned-guidance li, .route-instructions li { padding:.7rem .8rem; border:1px solid var(--navigator-border); border-radius:.8rem; background:var(--navigator-surface-raised); }
.planned-guidance li { display:grid; grid-template-columns:6.2rem minmax(0,1fr); gap:.7rem; }
.planned-guidance small { color:var(--navigator-primary); font-weight:760; }
.route-instructions li { font-size:.84rem; line-height:1.45; }
.map-warnings { margin:.8rem 0 0; padding-left:1.2rem; color:var(--navigator-muted); font-size:.75rem; }
</style>
