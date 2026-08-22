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

watch(venue, (value) => {
  if (!value) { selectedFloorKey.value = null; return; }
  const currentStop = value.stops.find((stop) => stop.visitAnchorId === props.currentVisitAnchorId);
  selectedFloorKey.value = currentStop?.floorKey || value.floors[0]?.key || null;
}, { immediate: true });

const floor = computed(() => venue.value?.floors.find((entry) => entry.key === selectedFloorKey.value) || null);
const stops = computed(() => venue.value?.stops.filter((entry) => entry.floorKey === selectedFloorKey.value) || []);
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
    <h2 id="map-heading">Mappa</h2>
    <div v-if="map.venues.length > 1" class="map-tabs" aria-label="Sede">
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
    <p v-if="navigation && navigation.destination.venueId === venue.id">
      Destinazione: {{ navigation.destination.label }} · {{ navigation.route.distanceMeters }} m · circa {{ navigation.route.estimatedSeconds }} s
    </p>
    <ol v-if="navigation?.route.instructions.length">
      <li v-for="instruction in navigation.route.instructions" :key="instruction">{{ instruction }}</li>
    </ol>
  </section>
</template>

<style scoped>
.session-map { margin-block: 1.5rem; }
.map-tabs { display: flex; gap: .5rem; flex-wrap: wrap; margin-block: .5rem; }
.map-canvas { position: relative; max-width: 52rem; overflow: hidden; border-radius: .75rem; }
.map-canvas img { display: block; width: 100%; height: auto; }
.map-overlay { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.map-overlay polyline { stroke: currentColor; stroke-width: 1.1; stroke-dasharray: 2 1; }
.map-overlay .navigation-route { stroke-width: 1.8; stroke-dasharray: none; }
.map-marker { position: absolute; transform: translate(-50%, -50%); display: grid; place-items: center; min-width: 1.5rem; min-height: 1.5rem; border-radius: 999px; background: Canvas; color: CanvasText; border: 2px solid currentColor; font-weight: 700; }
.stop-marker.current { outline: 4px solid currentColor; outline-offset: 2px; }
.facility-marker { min-width: 1.1rem; min-height: 1.1rem; font-size: 1.25rem; }
.destination-marker { min-width: 2rem; min-height: 2rem; }
</style>
