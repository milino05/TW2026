<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useConfiguredVenueStore } from "../application/stores";
import {
  generatorRepository,
  type GenerationNavigationRequirement,
  type GenerationOptionsProjection,
  type GenerationSourceRef,
  type GenerationSubjectOption,
} from "../infrastructure/http/generatorRepository";

const router = useRouter();
const configuredVenueStore = useConfiguredVenueStore();
const options = ref<GenerationOptionsProjection | null>(null);
const selectedVenueIds = ref<string[]>([]);
const selectedSourceKeys = ref<string[]>([]);
const sourceTouched = ref(false);
const transferMinutes = ref<Record<string, number>>({});
const timeBudgetMinutes = ref(45);
const depthPreference = ref(0.5);
const complexityPreference = ref(0.5);
const movementPacePreference = ref(0.5);
const locale = ref("it-IT");
const subjectQuery = ref("");
const subjectResults = ref<GenerationSubjectOption[]>([]);
const selectedSubjectIds = ref<string[]>([]);
const searchingSubjects = ref(false);
const booleanRoutingChoices = ref<Record<string, string>>({});
const numericRoutingValues = ref<Record<string, number | null>>({});
const numericRoutingPriorities = ref<Record<string, "preferred" | "required">>({});
const busy = ref(true);
const generating = ref(false);
const error = ref<string | null>(null);

function sourceKey(source: GenerationSourceRef) {
  return `${source.resourceType}:${source.resourceId}`;
}

function allSources(projection = options.value) {
  return (projection?.editorialScope.contentSpaces || []).flatMap((space) =>
    space.contexts.flatMap((context) => context.sources),
  );
}

function selectedSources(): GenerationSourceRef[] {
  const selected = new Set(selectedSourceKeys.value);
  return allSources()
    .map((entry) => entry.sourceRef)
    .filter((source) => selected.has(sourceKey(source)));
}

function venueLabel(venueId: string) {
  for (const organization of options.value?.physicalScope.organizations || []) {
    const venue = organization.venues.find((entry) => entry.id === venueId);
    if (venue) return venue.name;
  }
  return "Sede";
}

const selectedVenuePairs = computed(() => {
  const pairs: Array<{ a: string; b: string; key: string }> = [];
  for (let i = 0; i < selectedVenueIds.value.length; i += 1) {
    for (let j = i + 1; j < selectedVenueIds.value.length; j += 1) {
      const a = selectedVenueIds.value[i];
      const b = selectedVenueIds.value[j];
      pairs.push({ a, b, key: [a, b].sort().join("|") });
    }
  }
  return pairs;
});

const routingControls = computed(() => options.value?.controls.navigation.requirements || []);

async function loadOptions({ preserveSources = false } = {}) {
  busy.value = true;
  error.value = null;
  try {
    const previous = new Set(selectedSourceKeys.value);
    const projection = await generatorRepository.options(selectedVenueIds.value);
    options.value = projection;
    selectedVenueIds.value = [...projection.physicalScope.selectedVenueIds];
    const available = new Set(allSources(projection).map((entry) => sourceKey(entry.sourceRef)));
    if (preserveSources && sourceTouched.value) {
      selectedSourceKeys.value = [...previous].filter((key) => available.has(key));
    } else {
      selectedSourceKeys.value = projection.editorialScope.defaultSources.map(sourceKey).filter((key) => available.has(key));
    }
    clearSemanticSelection();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile caricare le opzioni di generazione";
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  const configuredVenueId = configuredVenueStore.config?.venueId;
  selectedVenueIds.value = configuredVenueId ? [configuredVenueId] : [];
  await loadOptions();
});

async function onVenueChanged() {
  await loadOptions({ preserveSources: true });
}

function clearSemanticSelection() {
  subjectResults.value = [];
  selectedSubjectIds.value = [];
}

function onSourceChanged() {
  sourceTouched.value = true;
  clearSemanticSelection();
}

async function searchSubjects() {
  const sources = selectedSources();
  if (!sources.length) {
    error.value = "Seleziona almeno una sorgente editoriale prima di cercare gli interessi.";
    return;
  }
  searchingSubjects.value = true;
  error.value = null;
  try {
    const response = await generatorRepository.searchSubjects(sources, subjectQuery.value.trim(), 30);
    subjectResults.value = response.results;
    const visible = new Set(response.results.map((subject) => subject.id));
    selectedSubjectIds.value = selectedSubjectIds.value.filter((subjectId) => visible.has(subjectId));
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile cercare gli interessi";
  } finally {
    searchingSubjects.value = false;
  }
}

function routingRequirements(): GenerationNavigationRequirement[] {
  const requirements: GenerationNavigationRequirement[] = [];
  for (const control of routingControls.value) {
    if (control.dataType === "boolean") {
      const choice = booleanRoutingChoices.value[control.key] || "";
      if (!choice) continue;
      const [priority, rawValue] = choice.split(":");
      requirements.push({
        attributeKey: control.key,
        operator: control.recommendedOperator || "eq",
        value: rawValue === "true",
        priority: priority === "required" ? "required" : "preferred",
        weight: 1,
      });
      continue;
    }
    if (control.dataType === "number") {
      const value = Number(numericRoutingValues.value[control.key]);
      if (!Number.isFinite(value)) continue;
      requirements.push({
        attributeKey: control.key,
        operator: control.recommendedOperator || "gte",
        value,
        priority: numericRoutingPriorities.value[control.key] || "preferred",
        weight: 1,
      });
    }
  }
  return requirements;
}

async function generate() {
  error.value = null;
  if (!selectedVenueIds.value.length) {
    error.value = "Seleziona almeno una sede.";
    return;
  }
  const sources = selectedSources();
  if (!sources.length) {
    error.value = "Seleziona almeno una sorgente editoriale autorizzata.";
    return;
  }
  const transfers = [];
  for (const pair of selectedVenuePairs.value) {
    const minutes = Number(transferMinutes.value[pair.key]);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      error.value = `Indica il tempo di trasferimento tra ${venueLabel(pair.a)} e ${venueLabel(pair.b)}.`;
      return;
    }
    const estimatedSeconds = Math.round(minutes * 60);
    transfers.push(
      { fromVenueId: pair.a, toVenueId: pair.b, estimatedSeconds },
      { fromVenueId: pair.b, toVenueId: pair.a, estimatedSeconds },
    );
  }

  generating.value = true;
  try {
    const navigationRequirements = routingRequirements();
    const semanticGoals = selectedSubjectIds.value.map((subjectId) => ({
      feature: { kind: "subject" as const, subjectId },
      priority: "preferred" as const,
      weight: 1,
    }));
    const plan = await generatorRepository.generate({
      venueIds: [...selectedVenueIds.value],
      editorialSources: sources,
      timeBudgetSeconds: Math.max(60, Math.round(Number(timeBudgetMinutes.value) * 60)),
      hardTimeBudget: true,
      ...(semanticGoals.length ? { semanticGoals } : {}),
      depthPreference: depthPreference.value,
      languageComplexityPreference: complexityPreference.value,
      locale: locale.value.trim() || "it-IT",
      movementPacePreference: movementPacePreference.value,
      ...(navigationRequirements.length ? { navigationRequirements } : {}),
      historyMode: "full",
      ...(transfers.length ? { interVenueTransfers: transfers } : {}),
    });
    await router.push(`/generated-plans/${plan.id}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Generazione non riuscita";
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <main class="page">
    <h1>Genera una visita</h1>
    <p>Le sedi fisiche e le sorgenti editoriali sono indipendenti: puoi usare contenuti autorizzati di autori o organizzazioni diverse dalle sedi selezionate.</p>
    <p v-if="busy">Caricamento opzioni…</p>
    <p v-if="error" role="alert">{{ error }}</p>

    <form v-if="options && !busy" @submit.prevent="generate">
      <fieldset>
        <legend>Sedi</legend>
        <section v-for="organization in options.physicalScope.organizations" :key="organization.id" class="option-group">
          <h2>{{ organization.name }}</h2>
          <label v-for="venue in organization.venues" :key="venue.id" class="check-row">
            <input
              v-model="selectedVenueIds"
              type="checkbox"
              :value="venue.id"
              :disabled="generating"
              @change="onVenueChanged"
            >
            <span><strong>{{ venue.name }}</strong><small>{{ venue.description }}</small></span>
          </label>
        </section>
      </fieldset>

      <fieldset v-if="selectedVenuePairs.length">
        <legend>Trasferimenti fra sedi</legend>
        <p>Inserisci una stima fornita dall’utente o dall’organizzazione; ArtAround non inventa tempi tra sedi diverse.</p>
        <label v-for="pair in selectedVenuePairs" :key="pair.key">
          {{ venueLabel(pair.a) }} ↔ {{ venueLabel(pair.b) }} · minuti
          <input v-model.number="transferMinutes[pair.key]" type="number" min="1" step="1" required>
        </label>
      </fieldset>

      <fieldset>
        <legend>Sorgenti editoriali</legend>
        <p>{{ options.controls.semantic.message }}</p>
        <section v-for="space in options.editorialScope.contentSpaces" :key="space.id" class="source-space">
          <h2>{{ space.name }}</h2>
          <p>Di {{ space.owner.name }}</p>
          <article v-for="context in space.contexts" :key="context.id">
            <h3>{{ context.name }}</h3>
            <p>{{ context.namespace.name }}<span v-if="context.description"> · {{ context.description }}</span></p>
            <label v-for="source in context.sources" :key="sourceKey(source.sourceRef)" class="check-row">
              <input
                v-model="selectedSourceKeys"
                type="checkbox"
                :value="sourceKey(source.sourceRef)"
                :disabled="generating"
                @change="onSourceChanged"
              >
              <span>
                {{ source.versionMode === "follow_current" ? "Segue la release corrente" : `Release v${source.version} fissata` }}
                · {{ source.accessKind === "owned" ? "propria" : "con licenza" }}
              </span>
            </label>
          </article>
        </section>
        <p v-if="!options.editorialScope.contentSpaces.length">Nessuna sorgente con capability <code>context.generate</code> disponibile.</p>
      </fieldset>

      <fieldset>
        <legend>Interessi</legend>
        <p>Cerca temi, persone, opere, movimenti o altri soggetti disponibili nelle sorgenti selezionate.</p>
        <div class="inline-control">
          <label>
            Cerca negli argomenti disponibili
            <input v-model="subjectQuery" type="search" :disabled="generating || searchingSubjects" @keydown.enter.prevent="searchSubjects">
          </label>
          <button type="button" :disabled="generating || searchingSubjects || !selectedSourceKeys.length" @click="searchSubjects">
            {{ searchingSubjects ? "Ricerca…" : "Cerca" }}
          </button>
        </div>
        <div v-if="subjectResults.length" class="subject-results">
          <label v-for="subject in subjectResults" :key="subject.id" class="check-row">
            <input v-model="selectedSubjectIds" type="checkbox" :value="subject.id" :disabled="generating">
            <span><strong>{{ subject.preferredLabel }}</strong><small v-if="subject.description">{{ subject.description }}</small></span>
          </label>
        </div>
        <p v-else-if="subjectQuery && !searchingSubjects">Nessun risultato caricato. Avvia la ricerca per esplorare gli argomenti delle sorgenti selezionate.</p>
      </fieldset>

      <fieldset>
        <legend>Preferenze di presentazione</legend>
        <label>
          Tempo disponibile · minuti
          <input v-model.number="timeBudgetMinutes" type="number" min="1" step="1" required>
        </label>
        <label>
          Profondità
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
        <label>
          Lingua / locale
          <input v-model="locale" type="text" placeholder="it-IT">
        </label>
      </fieldset>

      <fieldset v-if="routingControls.length">
        <legend>Percorso e accessibilità</legend>
        <p>Indica solo i vincoli rilevanti. Un requisito necessario blocca la generazione se una sede non può rispettarlo; una preferenza può produrre un avviso.</p>
        <div v-for="control in routingControls" :key="control.key" class="routing-row">
          <label v-if="control.dataType === 'boolean'">
            {{ control.label }}
            <select v-model="booleanRoutingChoices[control.key]" :disabled="generating">
              <option value="">Nessuna preferenza</option>
              <option value="preferred:true">Preferisci: sì</option>
              <option value="preferred:false">Preferisci: no</option>
              <option value="required:true">Necessario: sì</option>
              <option value="required:false">Necessario: no</option>
            </select>
          </label>
          <template v-else-if="control.dataType === 'number'">
            <label>
              {{ control.label }}<span v-if="control.unit"> · {{ control.unit }}</span>
              <input v-model.number="numericRoutingValues[control.key]" type="number" min="0" step="1" :disabled="generating">
            </label>
            <label>
              Importanza
              <select v-model="numericRoutingPriorities[control.key]" :disabled="generating">
                <option value="preferred">Preferenza</option>
                <option value="required">Necessario</option>
              </select>
            </label>
          </template>
        </div>
      </fieldset>

      <button type="submit" :disabled="generating || !selectedVenueIds.length || !selectedSourceKeys.length">
        {{ generating ? "Generazione…" : "Genera proposta" }}
      </button>
    </form>
  </main>
</template>

<style scoped>
fieldset {
  display: grid;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid currentColor;
}
.option-group,
.source-space {
  padding-block: .5rem;
}
.option-group h2,
.source-space h2,
.source-space h3 {
  margin-bottom: .35rem;
}
.check-row {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: .65rem;
  margin-block: .5rem;
}
.check-row small {
  display: block;
  opacity: .75;
}
.inline-control,
.routing-row {
  display: grid;
  gap: .75rem;
  align-items: end;
  grid-template-columns: minmax(0, 1fr) auto;
}
.subject-results {
  max-height: 20rem;
  overflow: auto;
  border: 1px solid currentColor;
  padding: .5rem .75rem;
}
@media (max-width: 42rem) {
  .inline-control,
  .routing-row {
    grid-template-columns: 1fr;
  }
}
</style>