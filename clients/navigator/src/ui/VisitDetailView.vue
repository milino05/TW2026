<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRuntimeStore } from "../application/stores";
import { navigatorVisitRepository, type NavigatorVisitDetail } from "../infrastructure/http/navigatorVisitRepository";
import {
  executionPreparationRepository,
  type ExecutionPreparationProjection,
} from "../infrastructure/http/executionPreparationRepository";

const route = useRoute();
const router = useRouter();
const runtimeStore = useRuntimeStore();
const detail = ref<NavigatorVisitDetail | null>(null);
const preparation = ref<ExecutionPreparationProjection | null>(null);
const busy = ref(true);
const starting = ref(false);
const error = ref<string | null>(null);

const canStart = computed(() => Boolean(
  preparation.value &&
  preparation.value.status === "active" &&
  preparation.value.readiness.status === "ready" &&
  preparation.value.readiness.blockers.length === 0,
));

function minutes(seconds: number) {
  return Math.max(0, Math.ceil(seconds / 60));
}

onMounted(async () => {
  try {
    detail.value = await navigatorVisitRepository.detail(String(route.params.visitId));
    preparation.value = await executionPreparationRepository.createForVisit(detail.value.visit.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile preparare la visita";
  } finally {
    busy.value = false;
  }
});

async function start() {
  if (!preparation.value || !canStart.value) return;
  starting.value = true;
  error.value = null;
  try {
    const response = await executionPreparationRepository.start(preparation.value);
    preparation.value = response.preparation;
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
    <p v-if="busy">Preparazione visita…</p>
    <p v-else-if="error && !detail" role="alert">{{ error }}</p>
    <template v-else-if="detail">
      <h1>{{ detail.visit.title }}</h1>
      <p>{{ detail.visit.description }}</p>
      <p>{{ detail.visit.stopCount }} tappe · {{ detail.visit.contentCount }} contenuti</p>
      <p v-if="detail.visit.physicalScope.length">
        {{ detail.visit.physicalScope.map((venue) => venue.name).join(" · ") }}
      </p>

      <section v-if="preparation" aria-labelledby="preparation-title">
        <h2 id="preparation-title">Prima di iniziare</h2>
        <p>
          Durata stimata: circa {{ minutes(preparation.logisticsPreview.estimatedTotalSeconds) }} min
          <span v-if="preparation.logisticsPreview.reservedSeconds">
            + {{ minutes(preparation.logisticsPreview.reservedSeconds) }} min di riserva
          </span>
        </p>
        <p>
          Contenuti {{ minutes(preparation.logisticsPreview.breakdown.contentSeconds) }} min ·
          osservazione {{ minutes(preparation.logisticsPreview.breakdown.observationSeconds) }} min ·
          spostamenti {{ minutes(preparation.logisticsPreview.breakdown.travelSeconds) }} min
        </p>
        <p v-if="preparation.logisticsPreview.routeSummary.venueCount">
          {{ preparation.logisticsPreview.routeSummary.venueCount }} sedi ·
          {{ preparation.logisticsPreview.routeSummary.stopCount }} tappe ·
          {{ preparation.logisticsPreview.routeSummary.legCount }} spostamenti
        </p>
        <ul v-if="preparation.readiness.warnings.length">
          <li v-for="warning in preparation.readiness.warnings" :key="warning.code">
            {{ warning.message }}
          </li>
        </ul>
        <ul v-if="preparation.readiness.blockers.length" role="alert">
          <li v-for="blocker in preparation.readiness.blockers" :key="blocker.code">
            {{ blocker.message }}
          </li>
        </ul>
      </section>

      <button type="button" :disabled="starting || !canStart" @click="start">
        {{ starting ? "Avvio…" : "Inizia visita" }}
      </button>
      <p v-if="error" role="alert">{{ error }}</p>
    </template>
  </main>
</template>
