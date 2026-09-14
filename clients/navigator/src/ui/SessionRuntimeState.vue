<script setup lang="ts">
import { computed } from "vue";
import type { MapProjection } from "../infrastructure/http/navigationRepository";
import type { AvailableAction, SessionProjection } from "../infrastructure/http/sessionRepository";

const props = defineProps<{
  snapshot: SessionProjection;
  map: MapProjection | null;
  nextAction: AvailableAction | null;
  returnAction: AvailableAction | null;
  busy: boolean;
}>();

const emit = defineEmits<{
  showMap: [];
  selectAction: [action: AvailableAction];
}>();

const phase = computed(() => props.snapshot.experience?.phase || null);
const contextStop = computed(() => props.map?.narrativeContextStop || null);
const recognitionMedia = computed(() => contextStop.value?.recognitionMedia || null);
const instruction = computed(() => {
  if (phase.value === "approaching_visit_target") {
    return contextStop.value?.approachInstruction || "Cerca l'opera indicata nella sala e conferma quando l'hai trovata.";
  }
  return props.snapshot.physical?.navigation?.nextInstruction || null;
});
const title = computed(() => {
  if (phase.value === "location_required") return "Da dove parti?";
  if (phase.value === "navigating_to_visit_stop") return "Verso la prossima tappa";
  if (phase.value === "approaching_visit_target") return "Trova l'opera";
  if (phase.value === "navigating_detour") return "Deviazione in corso";
  if (phase.value === "at_detour_destination") return "Destinazione raggiunta";
  return "Visita in corso";
});
const description = computed(() => {
  if (phase.value === "location_required") return "Indica sulla mappa dove ti trovi. ArtAround userà questa posizione come punto di partenza del percorso.";
  if (phase.value === "navigating_to_visit_stop") return instruction.value || "Segui il percorso sulla mappa e conferma l'indicazione corrente quando l'hai completata.";
  if (phase.value === "approaching_visit_target") return instruction.value;
  if (phase.value === "navigating_detour") return instruction.value || "Segui le indicazioni verso la destinazione richiesta. Puoi tornare alla visita in qualsiasi momento.";
  if (phase.value === "at_detour_destination") return "Puoi tornare alla visita: il percorso ripartirà dall'ultima posizione confermata.";
  return null;
});
const showMapButton = computed(() => ["location_required", "navigating_to_visit_stop", "navigating_detour"].includes(phase.value || ""));
const showReturn = computed(() => Boolean(props.returnAction) && ["navigating_detour", "at_detour_destination"].includes(phase.value || ""));
const knownLocationSourceLabel = computed(() => {
  const source = props.snapshot.physical?.knownLocation?.source;
  if (source === "navigation_confirmation") return "aggiornata con il percorso";
  if (source === "qr") return "confermata tramite QR";
  if (source === "teleport") return "impostata dal simulatore";
  if (source === "geolocation") return "rilevata dal provider di localizzazione";
  return "confermata manualmente";
});
</script>

<template>
  <section class="runtime-state" :data-phase="phase">
    <p class="eyebrow">Navigazione</p>
    <h1>{{ title }}</h1>
    <p v-if="description" class="runtime-description">{{ description }}</p>

    <figure v-if="phase === 'approaching_visit_target' && recognitionMedia" class="recognition-media">
      <img
        :src="recognitionMedia.url"
        :alt="recognitionMedia.altText || contextStop?.label || 'Opera da riconoscere'"
        :width="recognitionMedia.width || undefined"
        :height="recognitionMedia.height || undefined"
      >
      <figcaption>
        <strong>{{ contextStop?.label }}</strong>
        <span>{{ recognitionMedia.origin === 'venue_target' ? 'Foto di riconoscimento della sede' : 'Immagine di riconoscimento dell’opera' }}</span>
      </figcaption>
    </figure>

    <div v-if="snapshot.physical?.navigation" class="route-summary">
      <span v-if="snapshot.physical.navigation.distanceMeters != null">{{ snapshot.physical.navigation.distanceMeters }} m</span>
      <span>circa {{ snapshot.physical.navigation.estimatedSeconds }} s</span>
      <span v-if="snapshot.physical.navigation.remainingStepCount">{{ snapshot.physical.navigation.remainingStepCount }} indicazioni</span>
    </div>

    <div class="runtime-actions">
      <button v-if="showMapButton" type="button" class="secondary" @click="emit('showMap')">Apri mappa</button>
      <button
        v-if="nextAction && phase === 'approaching_visit_target'"
        type="button"
        class="primary"
        :disabled="busy"
        @click="emit('selectAction', nextAction)"
      >Trovata!</button>
      <button
        v-if="showReturn && returnAction"
        type="button"
        class="return-action"
        :disabled="busy"
        @click="emit('selectAction', returnAction)"
      >← Torna alla visita</button>
    </div>

    <p v-if="snapshot.physical?.knownLocation" class="known-location-note">
      Posizione conosciuta: <strong>{{ knownLocationSourceLabel }}</strong>.
    </p>
  </section>
</template>

<style scoped>
.runtime-state { display:grid; align-content:start; gap:.75rem; min-height:22rem; padding:1.1rem 0 1.5rem; }
.eyebrow { margin:0; color:var(--navigator-primary); font-size:.7rem; font-weight:820; letter-spacing:.08em; text-transform:uppercase; }
h1 { margin:0; font-family:Georgia,"Times New Roman",serif; font-size:clamp(2rem,8vw,3rem); font-weight:500; line-height:1.05; }
.runtime-description { max-width:38rem; margin:0; color:var(--navigator-muted); font-size:1rem; line-height:1.6; }
.recognition-media { display:grid; gap:.55rem; width:min(100%,30rem); margin:.35rem 0; }
.recognition-media img { display:block; width:100%; max-height:22rem; object-fit:cover; border:1px solid var(--navigator-border); border-radius:1rem; background:var(--navigator-surface-raised); }
.recognition-media figcaption { display:grid; gap:.15rem; }
.recognition-media figcaption span { color:var(--navigator-muted); font-size:.76rem; }
.route-summary { display:flex; flex-wrap:wrap; gap:.45rem; margin-top:.35rem; }
.route-summary span { padding:.35rem .55rem; border-radius:999px; color:var(--navigator-muted); background:color-mix(in srgb,var(--navigator-primary) 7%,var(--navigator-surface-raised)); font-size:.73rem; font-weight:760; }
.runtime-actions { display:flex; flex-wrap:wrap; gap:.55rem; margin-top:.45rem; }
.runtime-actions button { min-height:46px; padding:.65rem .9rem; border-radius:.8rem; font:inherit; font-weight:800; }
.runtime-actions .primary { border:0; color:var(--navigator-on-primary); background:var(--navigator-primary); }
.runtime-actions .secondary,
.runtime-actions .return-action { border:1px solid var(--navigator-border); color:var(--navigator-ink); background:var(--navigator-surface-raised); }
.runtime-actions .return-action { border-color:color-mix(in srgb,var(--navigator-primary) 45%,var(--navigator-border)); }
.known-location-note { margin:.5rem 0 0; padding:.7rem .8rem; border-left:3px solid var(--navigator-primary); color:var(--navigator-muted); background:var(--navigator-surface-raised); font-size:.75rem; line-height:1.45; }
.known-location-note strong { color:var(--navigator-ink); }
</style>
