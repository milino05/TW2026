<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useRuntimeStore } from "../application/stores";
import { generatorRepository, type GeneratedPlanProjection } from "../infrastructure/http/generatorRepository";
import {
  executionPreparationRepository,
  type ExecutionPreparationProjection,
} from "../infrastructure/http/executionPreparationRepository";

const route = useRoute();
const router = useRouter();
const runtimeStore = useRuntimeStore();
const plan = ref<GeneratedPlanProjection | null>(null);
const preparation = ref<ExecutionPreparationProjection | null>(null);
const busy = ref(true);
const acting = ref(false);
const error = ref<string | null>(null);
const materializedTitle = ref("Visita generata");
const depthPreference = ref(0.5);
const complexityPreference = ref(0.5);
const movementPacePreference = ref(0.5);

const canStart = computed(() => Boolean(
  preparation.value &&
  preparation.value.status === "active" &&
  preparation.value.readiness.status === "ready" &&
  preparation.value.readiness.blockers.length === 0,
));
const operations = computed(() => new Set((plan.value?.operations || []).map((operation) => operation.code)));

function minutes(seconds: number) {
  return Math.max(0, Math.ceil(Number(seconds || 0) / 60));
}

function syncPreparationControls(value: ExecutionPreparationProjection) {
  depthPreference.value = value.effectivePresentationPreference?.depthPreference ?? 0.5;
  complexityPreference.value = value.effectivePresentationPreference?.languageComplexityPreference ?? 0.5;
  movementPacePreference.value = value.navigation.movementPacePreference;
}

async function load() {
  busy.value = true;
  error.value = null;
  try {
    plan.value = await generatorRepository.get(String(route.params.planId));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Piano generato non disponibile";
  } finally {
    busy.value = false;
  }
}

onMounted(load);

function modifyCriteria() {
  void router.push("/generate");
}

async function accept() {
  if (!plan.value || !operations.value.has("accept")) return;
  acting.value = true;
  error.value = null;
  try {
    plan.value = await generatorRepository.accept(plan.value.id);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile accettare la proposta";
  } finally {
    acting.value = false;
  }
}

async function prepareStart() {
  if (!plan.value || !operations.value.has("start")) return;
  acting.value = true;
  error.value = null;
  try {
    preparation.value = await executionPreparationRepository.createForGeneratedPlan(plan.value.id);
    syncPreparationControls(preparation.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile preparare l'avvio";
  } finally {
    acting.value = false;
  }
}

async function updatePreparation() {
  if (!preparation.value || preparation.value.status !== "active") return;
  acting.value = true;
  error.value = null;
  try {
    preparation.value = await executionPreparationRepository.update(preparation.value, {
      presentationPreference: {
        depthPreference: depthPreference.value,
        languageComplexityPreference: complexityPreference.value,
      },
      movementPacePreference: movementPacePreference.value,
    });
    syncPreparationControls(preparation.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile aggiornare la preparazione";
  } finally {
    acting.value = false;
  }
}

async function start() {
  if (!preparation.value || !canStart.value) return;
  acting.value = true;
  error.value = null;
  try {
    const response = await executionPreparationRepository.start(preparation.value);
    preparation.value = response.preparation;
    runtimeStore.applySnapshot(response.current);
    await router.push(`/sessions/${response.session._id}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile avviare la visita";
  } finally {
    acting.value = false;
  }
}

async function materialize() {
  if (!plan.value || !operations.value.has("materialize")) return;
  acting.value = true;
  error.value = null;
  try {
    const result = await generatorRepository.materialize(plan.value.id, materializedTitle.value);
    await router.push(`/visits/${result.visitId}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile salvare la visita";
  } finally {
    acting.value = false;
  }
}
</script>

<template>
  <main class="page">
    <p v-if="busy">Caricamento proposta…</p>
    <p v-else-if="error && !plan" role="alert">{{ error }}</p>
    <template v-else-if="plan">
      <p class="eyebrow">Piano generato · {{ plan.status }}</p>
      <h1>Proposta di visita</h1>
      <p>{{ plan.routeSummary.stopCount }} tappe · {{ plan.contentEntries.length }} contenuti · circa {{ minutes(plan.timing.totalSeconds) }} min</p>
      <button type="button" :disabled="acting" @click="modifyCriteria">Modifica criteri</button>
      <p class="supporting-copy">La modifica apre una nuova richiesta di generazione: questo piano rimane immutato.</p>

      <section>
        <h2>Sedi</h2>
        <ul>
          <li v-for="venue in plan.physicalScope" :key="venue.id">{{ venue.name }}</li>
        </ul>
      </section>

      <section>
        <h2>Sorgenti editoriali</h2>
        <ul>
          <li v-for="(source, index) in plan.editorialSources" :key="`${source.name}-${index}`">
            {{ source.name }} · {{ source.versionMode === "follow_current" ? "source live" : `release v${source.version}` }}
          </li>
        </ul>
      </section>

      <section>
        <h2>Contenuti proposti</h2>
        <ol>
          <li v-for="entry in plan.contentEntries" :key="`${entry.position}-${entry.title}`">
            <strong>{{ entry.title }}</strong>
            <span v-if="entry.authorCredits.length"> · {{ entry.authorCredits.join(", ") }}</span>
            <span v-if="entry.delivery"> · {{ entry.delivery.targetLabel }}, {{ entry.delivery.venueName }}</span>
            <small>{{ minutes(entry.estimatedContentSeconds) }} min · {{ entry.role }}<span v-if="entry.license"> · {{ entry.license }}</span></small>
          </li>
        </ol>
      </section>

      <section>
        <h2>Logistica stimata</h2>
        <p>
          Contenuti {{ minutes(plan.timing.contentSeconds) }} min ·
          osservazione {{ minutes(plan.timing.observationSeconds) }} min ·
          spostamenti {{ minutes(plan.timing.travelSeconds) }} min
        </p>
        <p v-if="plan.timing.reservedSeconds">Riserva: {{ minutes(plan.timing.reservedSeconds) }} min.</p>
        <p>{{ plan.routeSummary.venueCount }} sedi · {{ plan.routeSummary.legCount }} spostamenti · {{ plan.routeSummary.interVenueLegCount }} trasferimenti fra sedi.</p>
        <ul v-if="plan.warnings.length">
          <li v-for="warning in plan.warnings" :key="warning.code">{{ warning.message }}</li>
        </ul>
      </section>

      <section v-if="operations.has('accept')">
        <h2>Conferma proposta</h2>
        <p>L'accettazione fissa questo GeneratedPlan. Non crea ancora una Visit salvata.</p>
        <button type="button" :disabled="acting" @click="accept">{{ acting ? "Operazione…" : "Accetta proposta" }}</button>
      </section>

      <section v-if="operations.has('start')">
        <h2>Avvia direttamente</h2>
        <button v-if="!preparation" type="button" :disabled="acting" @click="prepareStart">Prepara avvio</button>
        <template v-else>
          <div class="preparation-controls">
            <label>
              Approfondimento
              <input v-model.number="depthPreference" type="range" min="0" max="1" step="0.1">
            </label>
            <label>
              Complessità linguistica
              <input v-model.number="complexityPreference" type="range" min="0" max="1" step="0.1">
            </label>
            <label>
              Ritmo di movimento
              <input v-model.number="movementPacePreference" type="range" min="0" max="1" step="0.1">
            </label>
            <button type="button" :disabled="acting" @click="updatePreparation">Aggiorna preparazione</button>
          </div>
          <p>Stima aggiornata: circa {{ minutes(preparation.logisticsPreview.estimatedTotalSeconds) }} min.</p>
          <ul v-if="preparation.readiness.warnings.length">
            <li v-for="warning in preparation.readiness.warnings" :key="warning.code">{{ warning.message }}</li>
          </ul>
          <ul v-if="preparation.readiness.blockers.length" role="alert">
            <li v-for="blocker in preparation.readiness.blockers" :key="blocker.code">{{ blocker.message }}</li>
          </ul>
          <button type="button" :disabled="acting || !canStart" @click="start">Inizia visita</button>
        </template>
      </section>

      <section v-if="operations.has('materialize')">
        <h2>Salva nelle mie visite</h2>
        <label>
          Titolo
          <input v-model="materializedTitle" type="text">
        </label>
        <button type="button" :disabled="acting" @click="materialize">Salva come Visit personale</button>
      </section>

      <section v-if="plan.materializedVisitId">
        <h2>Visita salvata</h2>
        <RouterLink :to="`/visits/${plan.materializedVisitId}`">Apri la Visit</RouterLink>
      </section>

      <p v-if="error" role="alert">{{ error }}</p>
    </template>
  </main>
</template>

<style scoped>
section {
  margin-block: 2rem;
}
small {
  display: block;
  opacity: .75;
}
.supporting-copy {
  opacity: .75;
}
.preparation-controls {
  display: grid;
  gap: 1rem;
  max-width: 34rem;
}
</style>