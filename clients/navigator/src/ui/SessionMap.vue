<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { MapProjection, NavigationProjection } from "../infrastructure/http/navigationRepository";

const props = defineProps<{
  map: MapProjection;
  navigation: NavigationProjection | null;
  currentVisitAnchorId: string | null;
}>();

const venueIndex = ref(0);
const selectedFloorKey = ref<string | null>(null);
const venue = computed(() => props.map.venues[venueIndex.value] || null);

watch(() => props.currentVisitAnchorId, (anchorId) => {
  if (!anchorId) return;
  const index = props.map.venues.findIndex((candidate) =>
    candidate.stops.some((stop) => stop.visitAnchorId === anchorId));
  if (index >= 0) venueIndex.value = index;
}, { immediate: true });

watch([venue, () => props.currentVisitAnchorId], ([value]) => {
  if (!value) { selectedFloorKey.value = null; return; }
  const currentStop = value.stops.find((stop) => stop.visitAnchorId === props.currentVisitAnchorId);
  selectedFloorKey.value = currentStop?.floorKey || value.floors[0]?.key || null;
}, { immediate: true });

const floor = computed(() => venue.value?.floors.find((entry) => entry.key === selectedFloorKey.value) || null);
const stops = computed(() => venue.value?.stops.filter((entry) => entry.floorKey === selectedFloorKey.value) || []);
const orderedStops = computed(() => props.map.venues
  .flatMap((candidate) => candidate.stops.map((stop) => ({
    ...stop,
    venueName: candidate.name,
    floorLabel: candidate.floors.find((floor) => floor.key === stop.floorKey)?.label || stop.floorKey,
  })))
  .sort((left, right) => left.order - right.order));
const currentStop = computed(() =>
  orderedStops.value.find((stop) => stop.visitAnchorId === props.currentVisitAnchorId) || null);
const nextStop = computed(() =>
  currentStop.value
    ? orderedStops.value.find((stop) => stop.order > currentStop.value!.order) || null
    : null);

const facilities = computed(() => venue.value?.facilities.filter((entry) => entry.floorKey === selectedFloorKey.value) || []);
const plannedOverlays = computed(() => venue.value?.route.overlays.filter((entry) => entry.floorKey === selectedFloorKey.value) || []);
const navigationOverlays = computed(() => {
  if (!venue.value || props.navigation?.destination.venueId !== venue.value.id) return [];
  return props.navigation.route.overlays.filter((entry) => entry.floorKey === selectedFloorKey.value);
});

function pointStyle(point: { x: number; y: number }) {
  return { left: `${point.x * 100}%`, top: `${point.y * 100}%` };
}
</script>

<template>
  <section v-if="venue" class="session-map" aria-labelledby="map-heading">
    <header class="map-heading">
      <h2 id="map-heading">Il percorso</h2>
    </header>
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
        :key="candidate.key"
        type="button"
        :aria-pressed="selectedFloorKey === candidate.key"
        @click="selectedFloorKey = candidate.key"
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
        :class="{ current: stop.visitAnchorId === currentVisitAnchorId }"
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
        v-if="navigation && navigation.destination.venueId === venue.id && navigation.destination.floorKey === selectedFloorKey"
        class="map-marker destination-marker"
        :style="pointStyle(navigation.destination.position)"
        :title="navigation.destination.label"
      >◎</span>
    </div>
    <p v-else role="status">Per questo piano non è disponibile un asset cartografico.</p>

    <ul v-if="venue.warnings.length">
      <li v-for="warning in venue.warnings" :key="`${warning.code}-${warning.message}`">{{ warning.message }}</li>
    </ul>
    <p class="logical-position-note">
      La tappa evidenziata indica la posizione logica nella visita, non la posizione rilevata del telefono.
    </p>
    <article v-if="navigation && navigation.destination.venueId === venue.id" class="destination-summary">
      <span class="destination-mark" aria-hidden="true">◎</span>
      <div>
        <small>Destinazione richiesta</small>
        <strong>{{ navigation.destination.label }}</strong>
        <span>{{ navigation.route.distanceMeters }} m · circa {{ navigation.route.estimatedSeconds }} s</span>
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
    <ol v-if="navigation?.route.instructions.length" class="route-instructions">
      <li v-for="instruction in navigation.route.instructions" :key="instruction">{{ instruction }}</li>
    </ol>
  </section>
</template>

<style scoped>
.session-map { padding-bottom: 1rem; }
.map-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: .8rem;
}
.map-heading h2 {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.8rem, 7vw, 2.4rem);
  font-weight: 500;
}
.map-tabs {
  display: flex;
  align-items: center;
  gap: .45rem;
  flex-wrap: wrap;
  margin-block: .55rem;
}
.map-tabs > span {
  color: var(--navigator-muted);
  font-size: .72rem;
  font-weight: 780;
  letter-spacing: .07em;
  text-transform: uppercase;
}
.map-tabs button {
  min-height: 38px;
  padding: .45rem .7rem;
  border-radius: .65rem;
  font-size: .78rem;
  font-weight: 720;
}
.map-tabs button[aria-pressed="true"] {
  border-color: var(--navigator-primary);
  color: var(--navigator-primary);
  background: color-mix(in srgb, var(--navigator-primary) 9%, var(--navigator-surface-raised));
}
.venue-tabs {
  padding-bottom: .25rem;
  overflow-x: auto;
  flex-wrap: nowrap;
}
.map-canvas {
  position: relative;
  margin-top: .8rem;
  overflow: hidden;
  border: 1px solid var(--navigator-border);
  border-radius: 1.2rem;
  background: var(--navigator-surface-raised);
}
.map-canvas img {
  display: block;
  width: 100%;
  height: auto;
}
.map-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.map-overlay polyline {
  stroke: var(--navigator-muted);
  stroke-width: 1.1;
  stroke-dasharray: 2 1;
}
.map-overlay .navigation-route {
  stroke: var(--navigator-primary);
  stroke-width: 1.8;
  stroke-dasharray: none;
}
.map-marker {
  position: absolute;
  transform: translate(-50%, -50%);
  min-width: 1.65rem;
  min-height: 1.65rem;
  display: grid;
  place-items: center;
  border: 2px solid var(--navigator-ink);
  border-radius: 999px;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
  font-size: .72rem;
  font-weight: 800;
  box-shadow: 0 2px 8px var(--navigator-shadow);
}
.stop-marker.current {
  border-color: var(--navigator-primary);
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
  outline: 4px solid color-mix(in srgb, var(--navigator-primary) 28%, transparent);
  outline-offset: 2px;
}
.facility-marker {
  min-width: 1.15rem;
  min-height: 1.15rem;
  border-color: var(--navigator-accent);
  color: var(--navigator-accent);
  font-size: 1rem;
}
.destination-marker {
  min-width: 2rem;
  min-height: 2rem;
  border-color: var(--navigator-primary);
  color: var(--navigator-primary);
}
.logical-position-note {
  margin: .7rem .15rem 1rem;
  color: var(--navigator-muted);
  font-size: .74rem;
  line-height: 1.4;
}
.session-map > ul {
  padding: .8rem 1rem .8rem 2rem;
  border: 1px solid color-mix(in srgb, var(--navigator-accent) 45%, var(--navigator-border));
  border-radius: .8rem;
  color: var(--navigator-muted);
  font-size: .8rem;
}
.destination-summary {
  display: grid;
  grid-template-columns: 44px 1fr;
  align-items: center;
  gap: .75rem;
  padding: .85rem;
  border: 1px solid var(--navigator-border);
  border-radius: 1rem;
  background: var(--navigator-surface-raised);
}
.destination-mark {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
  font-size: 1.1rem;
  font-weight: 800;
}
.destination-summary small,
.destination-summary strong,
.destination-summary span { display: block; }
.destination-summary small {
  color: var(--navigator-muted);
  font-size: .68rem;
  font-weight: 780;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.destination-summary strong { margin-top: .12rem; }
.destination-summary div > span {
  margin-top: .15rem;
  color: var(--navigator-muted);
  font-size: .76rem;
}
.route-instructions {
  margin: .7rem 0 0;
  padding: .75rem .75rem .75rem 2rem;
  border-left: 3px solid var(--navigator-primary);
  color: var(--navigator-muted);
  font-size: .84rem;
}
</style>
