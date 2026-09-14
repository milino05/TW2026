<script setup lang="ts">
import { computed } from "vue";
import type { MapProjection, VisitStopProjection } from "../infrastructure/http/navigationRepository";

const props = withDefaults(defineProps<{
  map: MapProjection;
  canSelect?: boolean;
  busy?: boolean;
}>(), {
  canSelect: true,
  busy: false,
});

const emit = defineEmits<{
  select: [visitAnchorId: string];
}>();

type StopRow = VisitStopProjection & { venueName: string; floorLabel: string };

const stops = computed<StopRow[]>(() => props.map.venues
  .flatMap((venue) => venue.stops.map((stop) => ({
    ...stop,
    venueName: venue.name,
    floorLabel: venue.floors.find((floor) => floor.id === stop.floorId)?.label || stop.floorId,
  })))
  .sort((left, right) => left.order - right.order));

function stateLabel(stop: StopRow) {
  if (stop.sequencePosition === "current") return "Tappa corrente";
  if (stop.experienced) return "Già visitata";
  if (stop.sequencePosition === "before_current") return "Superata";
  return "Da visitare";
}
</script>

<template>
  <section class="stops-panel" aria-labelledby="stops-title">
    <header>
      <div>
        <p class="eyebrow">Percorso della visita</p>
        <h2 id="stops-title">Tappe</h2>
      </div>
      <span>{{ stops.length }} {{ stops.length === 1 ? "tappa" : "tappe" }}</span>
    </header>

    <ol class="stops-list">
      <li
        v-for="stop in stops"
        :key="stop.visitAnchorId"
        :class="{ current: stop.sequencePosition === 'current', experienced: stop.experienced }"
      >
        <button
          type="button"
          :disabled="busy || !canSelect || stop.sequencePosition === 'current'"
          :aria-current="stop.sequencePosition === 'current' ? 'step' : undefined"
          @click="emit('select', stop.visitAnchorId)"
        >
          <span class="stop-number">{{ stop.order }}</span>
          <span class="stop-copy">
            <strong>{{ stop.label }}</strong>
            <small>{{ stop.venueName }} · {{ stop.floorLabel }}</small>
            <em>{{ stateLabel(stop) }}</em>
          </span>
          <span v-if="canSelect && stop.sequencePosition !== 'current'" class="stop-go" aria-hidden="true">→</span>
          <span v-else-if="stop.sequencePosition === 'current'" class="stop-current" aria-hidden="true">●</span>
        </button>
      </li>
    </ol>

    <p v-if="!canSelect" class="stops-note">La guida controlla la tappa comune. Puoi consultare l'itinerario, ma non cambiarlo.</p>
  </section>
</template>

<style scoped>
.stops-panel { padding: .35rem 0 1.2rem; }
header { display:flex; align-items:flex-end; justify-content:space-between; gap:1rem; margin-bottom:1rem; }
header p, header h2 { margin:0; }
header h2 { margin-top:.18rem; font-family:Georgia,"Times New Roman",serif; font-size:clamp(1.8rem,7vw,2.35rem); font-weight:500; }
header > span { color:var(--navigator-muted); font-size:.78rem; font-weight:760; }
.eyebrow { color:var(--navigator-primary); font-size:.68rem; font-weight:800; letter-spacing:.08em; text-transform:uppercase; }
.stops-list { display:grid; gap:.65rem; margin:0; padding:0; list-style:none; }
.stops-list li { border:1px solid var(--navigator-border); border-radius:1rem; background:var(--navigator-surface-raised); overflow:hidden; }
.stops-list li.current { border-color:var(--navigator-primary); box-shadow:0 6px 20px var(--navigator-shadow); }
.stops-list button { width:100%; min-height:76px; display:grid; grid-template-columns:2.7rem minmax(0,1fr) auto; align-items:center; gap:.75rem; padding:.8rem; border:0; border-radius:0; color:var(--navigator-ink); background:transparent; text-align:left; }
.stops-list button:not(:disabled):hover { background:color-mix(in srgb,var(--navigator-primary) 7%,transparent); }
.stops-list button:disabled { opacity:1; cursor:default; }
.stop-number { width:2.55rem; height:2.55rem; display:grid; place-items:center; border:1px solid var(--navigator-border); border-radius:50%; font-weight:850; }
.current .stop-number { border-color:var(--navigator-primary); color:var(--navigator-on-primary); background:var(--navigator-primary); }
.stop-copy { min-width:0; display:grid; gap:.16rem; }
.stop-copy strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:.94rem; }
.stop-copy small { color:var(--navigator-muted); font-size:.75rem; }
.stop-copy em { color:var(--navigator-muted); font-size:.68rem; font-style:normal; font-weight:760; }
.current .stop-copy em { color:var(--navigator-primary); }
.experienced:not(.current) .stop-copy em { color:var(--navigator-primary); }
.stop-go, .stop-current { color:var(--navigator-primary); font-size:1.2rem; font-weight:800; }
.stops-note { margin:1rem 0 0; padding:.8rem; border-radius:.8rem; color:var(--navigator-muted); background:color-mix(in srgb,var(--navigator-primary) 6%,var(--navigator-surface)); font-size:.78rem; line-height:1.45; }
</style>
