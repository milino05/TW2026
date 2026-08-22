<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useRuntimeStore } from "../application/stores";
import { sessionRepository, type AvailableAction } from "../infrastructure/http/sessionRepository";

const route = useRoute();
const runtimeStore = useRuntimeStore();
const { snapshot } = storeToRefs(runtimeStore);
const busyActionId = ref<string | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const sessionId = computed(() => String(route.params.sessionId));

onMounted(async () => {
  if (snapshot.value?.session.id === sessionId.value) return;
  try {
    runtimeStore.applySnapshot(await sessionRepository.current(sessionId.value));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile riprendere la sessione";
  }
});

async function dispatch(action: AvailableAction) {
  if (!snapshot.value) return;
  busyActionId.value = action.actionId;
  error.value = null;
  notice.value = null;
  try {
    const response = await sessionRepository.dispatchAction(
      sessionId.value,
      action.actionId,
      snapshot.value.session.runtimeVersion,
      "button",
    );
    runtimeStore.applySnapshot(response.runtime);
    if (response.effect?.type === "navigation_requested") {
      notice.value = response.effect.label ? `Navigazione richiesta: ${response.effect.label}` : "Navigazione richiesta";
    } else if (response.effect?.type === "completion") {
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
      </template>
      <p v-else-if="snapshot.session.status !== 'completed'">La sessione non contiene un contenuto corrente.</p>
      <p v-else>Visita completata.</p>

      <div v-if="snapshot.availableActions.length" class="session-actions" aria-label="Azioni disponibili">
        <button
          v-for="action in snapshot.availableActions"
          :key="action.actionId"
          type="button"
          :disabled="busyActionId !== null"
          @click="dispatch(action)"
        >
          {{ busyActionId === action.actionId ? "…" : action.label }}
        </button>
      </div>
    </template>
  </main>
</template>
