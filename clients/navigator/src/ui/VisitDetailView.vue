<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRuntimeStore } from "../application/stores";
import { navigatorVisitRepository, type NavigatorVisitDetail } from "../infrastructure/http/navigatorVisitRepository";
import { sessionRepository } from "../infrastructure/http/sessionRepository";

const route = useRoute();
const router = useRouter();
const runtimeStore = useRuntimeStore();
const detail = ref<NavigatorVisitDetail | null>(null);
const busy = ref(true);
const starting = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    detail.value = await navigatorVisitRepository.detail(String(route.params.visitId));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile caricare la visita";
  } finally {
    busy.value = false;
  }
});

async function start() {
  if (!detail.value) return;
  starting.value = true;
  error.value = null;
  try {
    const response = await sessionRepository.startVisit(detail.value.visit.id);
    runtimeStore.applySnapshot(response.current);
    await router.push(`/sessions/${response.session._id}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile avviare la visita";
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <main class="page">
    <p v-if="busy">Caricamento…</p>
    <p v-else-if="error && !detail" role="alert">{{ error }}</p>
    <template v-else-if="detail">
      <h1>{{ detail.visit.title }}</h1>
      <p>{{ detail.visit.description }}</p>
      <p>{{ detail.visit.stopCount }} tappe · {{ detail.visit.contentCount }} contenuti</p>
      <p>{{ detail.visit.physicalScope.map((venue) => venue.name).join(" · ") }}</p>
      <button type="button" :disabled="starting" @click="start">{{ starting ? "Avvio…" : "Inizia visita" }}</button>
      <p v-if="error" role="alert">{{ error }}</p>
    </template>
  </main>
</template>
