<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useRuntimeStore } from "../application/stores";
import { sessionRepository } from "../infrastructure/http/sessionRepository";

const route = useRoute();
const runtimeStore = useRuntimeStore();
const { snapshot } = storeToRefs(runtimeStore);
const busy = ref(false);
const error = ref<string | null>(null);
const sessionId = computed(() => String(route.params.sessionId));

onMounted(async () => {
  if (snapshot.value?.session.id === sessionId.value) return;
  try {
    runtimeStore.applySnapshot(await sessionRepository.current(sessionId.value));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile riprendere la sessione";
  }
});

async function advance(direction: "next" | "previous") {
  busy.value = true;
  error.value = null;
  try {
    runtimeStore.applySnapshot(await sessionRepository.advance(sessionId.value, direction));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Operazione non disponibile";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page session-page">
    <p v-if="error" role="alert">{{ error }}</p>
    <template v-if="snapshot">
      <p class="eyebrow">Sessione {{ snapshot.session.status }}</p>
      <template v-if="snapshot.current">
        <h1>{{ snapshot.current.label }}</h1>
        <p class="presentation-text">{{ snapshot.current.presentation.text }}</p>
      </template>
      <p v-else>La sessione non contiene un contenuto corrente.</p>
      <div class="session-actions">
        <button
          v-if="snapshot.availableActions.includes('PREVIOUS')"
          type="button"
          :disabled="busy"
          @click="advance('previous')"
        >Precedente</button>
        <button
          v-if="snapshot.availableActions.includes('NEXT')"
          type="button"
          :disabled="busy"
          @click="advance('next')"
        >Prossimo</button>
      </div>
    </template>
  </main>
</template>
