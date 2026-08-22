<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useNavigationStore, useRuntimeStore } from "../application/stores";
import { browserTts } from "../capabilities/browserTts";
import { browserControlledVoice } from "../capabilities/controlledVoice";
import { navigationRepository } from "../infrastructure/http/navigationRepository";
import { sessionRepository, type AvailableAction } from "../infrastructure/http/sessionRepository";
import SessionMap from "./SessionMap.vue";

const route = useRoute();
const runtimeStore = useRuntimeStore();
const navigationStore = useNavigationStore();
const { snapshot } = storeToRefs(runtimeStore);
const { map, navigation } = storeToRefs(navigationStore);
const busyActionId = ref<string | null>(null);
const voiceBusy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const sessionId = computed(() => String(route.params.sessionId));
const currentAnchorId = computed(() => snapshot.value?.current?.anchor?.visitAnchorId || null);

onMounted(async () => {
  error.value = null;
  try {
    const requests: Promise<unknown>[] = [];
    if (snapshot.value?.session.id !== sessionId.value) {
      requests.push(sessionRepository.current(sessionId.value).then((value) => runtimeStore.applySnapshot(value)));
    }
    requests.push(navigationRepository.map(sessionId.value).then((value) => navigationStore.setMap(value)));
    await Promise.all(requests);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile riprendere la sessione";
  }
});

onUnmounted(() => {
  browserTts.stop();
  browserControlledVoice.stop();
});

async function dispatch(action: AvailableAction, channel: "button" | "controlled_voice" = "button") {
  if (!snapshot.value) return;
  busyActionId.value = action.actionId;
  error.value = null;
  notice.value = null;
  try {
    const response = await sessionRepository.dispatchAction(
      sessionId.value,
      action.actionId,
      snapshot.value.session.runtimeVersion,
      channel,
    );
    runtimeStore.applySnapshot(response.runtime);
    if (action.family === "progress") navigationStore.setNavigation(null);
    if (response.effect?.type === "navigation_requested" && response.effect.navigation) {
      navigationStore.setNavigation(response.effect.navigation);
      notice.value = `Percorso verso ${response.effect.navigation.destination.label}`;
    } else if (response.effect?.type === "obstacle_check" && response.effect.obstacleCheck) {
      notice.value = response.effect.obstacleCheck.message;
    } else if (response.effect?.type === "completion") {
      navigationStore.setNavigation(null);
      notice.value = "Visita completata";
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Operazione non disponibile";
    try {
      runtimeStore.applySnapshot(await sessionRepository.current(sessionId.value));
    } catch {
      // Mantiene l'ultimo snapshot se anche il refresh fallisce.
    }
  } finally {
    busyActionId.value = null;
  }
}

function speakCurrent() {
  const presentation = snapshot.value?.current?.presentation;
  if (!presentation) return;
  if (!browserTts.speak(presentation.text, presentation.locale || "it-IT")) {
    notice.value = "Sintesi vocale non supportata dal browser";
  }
}

async function listenControlledVoice() {
  if (!snapshot.value || voiceBusy.value) return;
  voiceBusy.value = true;
  error.value = null;
  notice.value = "In ascolto…";
  try {
    const result = await browserControlledVoice.listen(
      snapshot.value.availableActions,
      snapshot.value.current?.presentation.locale || "it-IT",
    );
    if (!result.action) {
      notice.value = result.transcript
        ? `Comando non disponibile: “${result.transcript}”`
        : "Nessun comando riconosciuto";
      return;
    }
    notice.value = null;
    await dispatch(result.action, "controlled_voice");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Comando vocale non disponibile";
  } finally {
    voiceBusy.value = false;
  }
}
</script>

<template>
  <main class="page session-page">
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="notice" role="status">{{ notice }}</p>
    <template v-if="snapshot">
      <p class="eyebrow">Sessione {{ snapshot.session.status }}</p>
      <template v-if="snapshot.current">
        <h1>{{ snapshot.current.label }}</h1>
        <p class="presentation-text">{{ snapshot.current.presentation.text }}</p>
        <div class="speech-controls" aria-label="Lettura del contenuto">
          <button type="button" @click="speakCurrent">Ascolta il testo</button>
          <button type="button" @click="browserTts.stop()">Ferma lettura</button>
        </div>
      </template>
      <p v-else-if="snapshot.session.status !== 'completed'">La sessione non contiene un contenuto corrente.</p>
      <p v-else>Visita completata.</p>

      <div class="voice-controls">
        <button
          type="button"
          :disabled="voiceBusy || !browserControlledVoice.supported || !snapshot.availableActions.length"
          @click="listenControlledVoice"
        >{{ voiceBusy ? "In ascolto…" : "Comando vocale" }}</button>
        <p v-if="!browserControlledVoice.supported">Il browser non supporta il riconoscimento vocale; usa i bottoni equivalenti.</p>
      </div>

      <div v-if="snapshot.availableActions.length" class="session-actions" aria-label="Azioni disponibili">
        <button
          v-for="action in snapshot.availableActions"
          :key="action.actionId"
          type="button"
          :disabled="busyActionId !== null || voiceBusy"
          @click="dispatch(action, 'button')"
        >
          {{ busyActionId === action.actionId ? "…" : action.label }}
        </button>
      </div>

      <SessionMap
        v-if="map?.venues.length"
        :map="map"
        :navigation="navigation"
        :current-visit-anchor-id="currentAnchorId"
      />
    </template>
  </main>
</template>

<style scoped>
.speech-controls, .voice-controls, .session-actions { display: flex; gap: .5rem; flex-wrap: wrap; margin-block: 1rem; }
.voice-controls { align-items: center; }
</style>
