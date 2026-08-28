<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import { useRoute, useRouter } from "vue-router";
import { useConfiguredVenueStore } from "../application/stores";
import {
  generatorRepository,
  type GenerationNavigationRequirement,
  type GenerationOptionsProjection,
  type GenerationSourceRef,
  type GenerationSubjectOption,
  type GenerationSubjectSearchResponse,
} from "../infrastructure/http/generatorRepository";

const route = useRoute();
const router = useRouter();
const configuredVenueStore = useConfiguredVenueStore();
const { config } = storeToRefs(configuredVenueStore);
const venueId = computed(() => String(route.params.venueId || ""));
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
const subjectSearchMeta = ref<GenerationSubjectSearchResponse["resolver"] | null>(null);
const subjectSearchWarnings = ref<GenerationSubjectSearchResponse["warnings"]>([]);
const selectedSubjectIds = ref<string[]>([]);
const searchingSubjects = ref(false);
const booleanRoutingChoices = ref<Record<string, string>>({});
const numericRoutingValues = ref<Record<string, number | string | null>>({});
const numericRoutingPriorities = ref<Record<string, "preferred" | "required">>({});
const choiceRoutingValues = ref<Record<string, string>>({});
const choiceRoutingPriorities = ref<Record<string, "preferred" | "required" | "avoid">>({});
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

function preferenceLabel(value: number) {
  if (value < 0.34) return "Leggera";
  if (value > 0.66) return "Alta";
  return "Bilanciata";
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
const selectedSourceCount = computed(() => selectedSourceKeys.value.length);
const additionalVenueCount = computed(() => selectedVenueIds.value.filter((id) => id !== venueId.value).length);

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
  selectedVenueIds.value = venueId.value ? [venueId.value] : [];
  await loadOptions();
});

async function onVenueChanged() {
  await loadOptions({ preserveSources: true });
}

function clearSemanticSelection() {
  subjectResults.value = [];
  subjectSearchMeta.value = null;
  subjectSearchWarnings.value = [];
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
    const response = await generatorRepository.searchSubjects(sources, subjectQuery.value.trim(), 30, locale.value.trim() || "it-IT");
    subjectResults.value = response.results;
    subjectSearchMeta.value = response.resolver;
    subjectSearchWarnings.value = response.warnings;
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
        physicalFeatureRef: control.physicalFeatureRef,
        operator: control.recommendedOperator || "eq",
        value: rawValue === "true",
        priority: priority === "required" ? "required" : "preferred",
        weight: 1,
      });
      continue;
    }
    if (control.dataType === "number") {
      const rawValue = numericRoutingValues.value[control.key];
      if (rawValue === undefined || rawValue === null || rawValue === "") continue;
      const value = Number(rawValue);
      if (!Number.isFinite(value)) continue;
      requirements.push({
        physicalFeatureRef: control.physicalFeatureRef,
        operator: control.recommendedOperator || "gte",
        value,
        priority: numericRoutingPriorities.value[control.key] || "preferred",
        weight: 1,
      });
      continue;
    }
    if (control.dataType === "choice") {
      const value = choiceRoutingValues.value[control.key];
      if (!value) continue;
      requirements.push({
        physicalFeatureRef: control.physicalFeatureRef,
        operator: "eq",
        value,
        priority: choiceRoutingPriorities.value[control.key] || "preferred",
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
    await router.push({ name: "museum-generated-plan", params: { venueId: venueId.value, planId: plan.id } });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Generazione non riuscita";
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <main class="generate-page">
    <section
      class="generate-hero"
      :style="config?.branding.heroImage?.src ? { backgroundImage: `linear-gradient(90deg, rgba(13, 24, 23, .92), rgba(13, 24, 23, .34)), url('${config.branding.heroImage.src}')` } : undefined"
    >
      <RouterLink class="back-link" :to="{ name: 'museum-library', params: { venueId } }">← Le mie visite</RouterLink>
      <div>
        <p class="eyebrow">{{ config?.branding.museumTitle || "Museo selezionato" }}</p>
        <h1>Costruiamo la tua visita</h1>
        <p>Scegli tempo, interessi e necessità: il Navigator preparerà un percorso adatto a te.</p>
      </div>
    </section>

    <div v-if="busy" class="state-card" aria-live="polite">Caricamento delle opzioni…</div>
    <p v-if="error" class="error-card" role="alert">{{ error }}</p>

    <form v-if="options && !busy" class="generation-layout" @submit.prevent="generate">
      <div class="form-sections">
      <fieldset class="form-section">
        <legend><span>1</span> Museo e durata</legend>
        <p class="section-intro">La visita viene creata per {{ config?.branding.museumTitle || venueLabel(venueId) }}. Puoi aggiungere altre sedi dalle opzioni avanzate.</p>
        <div class="current-venue">
          <span aria-hidden="true">✓</span>
          <div><strong>{{ venueLabel(venueId) }}</strong><small>Museo selezionato</small></div>
        </div>
        <details class="advanced-options">
          <summary>Opzioni avanzate · aggiungi altre sedi</summary>
          <p>La visita può attraversare più sedi. In questo caso dovrai indicare anche i tempi di trasferimento.</p>
          <section v-for="organization in options.physicalScope.organizations" :key="organization.id" class="option-group">
            <h2>{{ organization.name }}</h2>
            <template v-for="venue in organization.venues" :key="venue.id">
              <label v-if="venue.id !== venueId" class="check-row">
                <input
                  v-model="selectedVenueIds"
                  type="checkbox"
                  :value="venue.id"
                  :disabled="generating"
                  @change="onVenueChanged"
                >
                <span>
                  <strong>{{ venue.name }}</strong>
                  <small>{{ venue.description }}</small>
                </span>
              </label>
            </template>
          </section>
        </details>
        <label class="field-label">
          <span>Quanto tempo hai?</span>
          <span class="duration-control">
            <input v-model.number="timeBudgetMinutes" type="number" min="1" step="1" required>
            <strong>minuti</strong>
          </span>
        </label>
      </fieldset>

      <fieldset v-if="selectedVenuePairs.length" class="form-section transfer-section">
        <legend>Trasferimenti fra sedi</legend>
        <p>Inserisci una stima fornita dall’utente o dall’organizzazione; ArtAround non inventa tempi tra sedi diverse.</p>
        <label v-for="pair in selectedVenuePairs" :key="pair.key">
          {{ venueLabel(pair.a) }} ↔ {{ venueLabel(pair.b) }} · minuti
          <input v-model.number="transferMinutes[pair.key]" type="number" min="1" step="1" required>
        </label>
      </fieldset>

      <fieldset class="form-section">
        <legend><span>2</span> Contenuti e interessi</legend>
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

      <fieldset class="form-section interests-section">
        <legend>Quali temi ti interessano?</legend>
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
        <p v-if="selectedSubjectIds.length">Interessi selezionati: {{ selectedSubjectIds.length }}</p>
        <p v-for="warning in subjectSearchWarnings" :key="warning.code" class="semantic-notice" role="status">{{ warning.message }}</p>
        <p v-if="subjectSearchMeta?.status === 'grounded'" class="semantic-notice">
          Alcuni risultati sono stati trovati tramite Wikidata, ma sono mostrati solo perché corrispondono a Subject già presenti nelle sorgenti selezionate.
          <a v-if="subjectSearchMeta.provider?.attribution" :href="subjectSearchMeta.provider.attribution.url" target="_blank" rel="noreferrer">{{ subjectSearchMeta.provider.attribution.label }}</a>
        </p>
        <div v-if="subjectResults.length" class="subject-results">
          <label v-for="subject in subjectResults" :key="subject.id" class="check-row">
            <input v-model="selectedSubjectIds" type="checkbox" :value="subject.id" :disabled="generating">
            <span><strong>{{ subject.preferredLabel }}</strong><small v-if="subject.description">{{ subject.description }}</small><small v-if="subject.matchSource === 'external_grounded'">Corrispondenza esterna verificata · Subject ArtAround esistente</small></span>
          </label>
        </div>
        <p v-else-if="subjectQuery && !searchingSubjects">Nessun risultato caricato. Avvia la ricerca per esplorare gli argomenti delle sorgenti selezionate.</p>
      </fieldset>

      <fieldset class="form-section">
        <legend><span>3</span> Come vuoi esplorare?</legend>
        <label class="range-control">
          <span><strong>Profondità</strong><output>{{ preferenceLabel(depthPreference) }}</output></span>
          <input v-model.number="depthPreference" type="range" min="0" max="1" step="0.1">
          <small>Da una panoramica essenziale a un racconto più approfondito.</small>
        </label>
        <label class="range-control">
          <span><strong>Complessità linguistica</strong><output>{{ preferenceLabel(complexityPreference) }}</output></span>
          <input v-model.number="complexityPreference" type="range" min="0" max="1" step="0.1">
          <small>Regola quanto specialistici saranno i contenuti.</small>
        </label>
        <label class="range-control">
          <span><strong>Ritmo di movimento</strong><output>{{ preferenceLabel(movementPacePreference) }}</output></span>
          <input v-model.number="movementPacePreference" type="range" min="0" max="1" step="0.1">
          <small>Scegli un percorso più rilassato o più dinamico.</small>
        </label>
        <label class="field-label">
          <span>Lingua / locale</span>
          <input v-model="locale" type="text" placeholder="it-IT">
        </label>
      </fieldset>

      <fieldset v-if="routingControls.length" class="form-section">
        <legend><span>4</span> Percorso e accessibilità</legend>
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
          <template v-else-if="control.dataType === 'choice'">
            <label>
              {{ control.label }}
              <select v-model="choiceRoutingValues[control.key]" :disabled="generating">
                <option value="">Nessuna preferenza</option>
                <option v-for="option in control.options" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label>
              Importanza
              <select v-model="choiceRoutingPriorities[control.key]" :disabled="generating">
                <option value="preferred">Preferenza</option>
                <option value="avoid">Evita</option>
                <option value="required">Necessario</option>
              </select>
            </label>
          </template>
        </div>
      </fieldset>
      </div>

      <aside class="generation-summary">
        <p class="eyebrow">La tua visita</p>
        <h2>Riepilogo</h2>
        <dl>
          <div><dt>Museo</dt><dd>{{ config?.branding.museumTitle || venueLabel(venueId) }}</dd></div>
          <div><dt>Durata</dt><dd>{{ timeBudgetMinutes }} min</dd></div>
          <div><dt>Contenuti</dt><dd>{{ selectedSourceCount }} sorgenti</dd></div>
          <div><dt>Interessi</dt><dd>{{ selectedSubjectIds.length || "Nessuno" }}</dd></div>
          <div v-if="additionalVenueCount"><dt>Altre sedi</dt><dd>{{ additionalVenueCount }}</dd></div>
        </dl>
        <button class="primary-action" type="submit" :disabled="generating || !selectedVenueIds.length || !selectedSourceKeys.length">
          {{ generating ? "Sto creando la visita…" : "Genera la mia visita" }}
        </button>
        <small>Potrai controllare la proposta prima di iniziare.</small>
      </aside>
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
.semantic-notice {
  padding: .7rem .8rem;
  border-left: 3px solid currentColor;
  background: color-mix(in srgb, currentColor 8%, transparent);
}
@media (max-width: 42rem) {
  .inline-control,
  .routing-row {
    grid-template-columns: 1fr;
  }
}
.generate-page {
  width: min(100%, 76rem);
  margin: 0 auto;
  padding: clamp(1rem, 3vw, 2rem);
}
.generate-hero {
  min-height: 17rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 3rem;
  padding: clamp(1.25rem, 4vw, 3rem);
  border-radius: 1.5rem;
  color: #fff;
  background-color: color-mix(in srgb, var(--navigator-primary) 78%, #12211e);
  background-position: center;
  background-size: cover;
  box-shadow: 0 20px 50px var(--navigator-shadow);
}
.generate-hero h1 {
  max-width: 46rem;
  margin: .25rem 0 .65rem;
  font: 500 clamp(2.15rem, 6vw, 4.3rem)/.98 Georgia, "Times New Roman", serif;
}
.generate-hero p:not(.eyebrow) {
  max-width: 42rem;
  margin: 0;
  color: rgba(255, 255, 255, .88);
  font-size: clamp(1rem, 2vw, 1.2rem);
}
.generate-hero .eyebrow { color: rgba(255, 255, 255, .74); }
.back-link { width: fit-content; color: #fff; font-weight: 750; text-decoration: none; }
.generation-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(17rem, 21rem);
  align-items: start;
  gap: clamp(1rem, 3vw, 2rem);
  margin-top: 1.75rem;
}
.form-sections { display: grid; gap: 1.25rem; min-width: 0; }
.form-section {
  min-width: 0;
  display: grid;
  gap: 1rem;
  margin: 0;
  padding: clamp(1.1rem, 3vw, 1.65rem);
  border: 1px solid var(--navigator-border);
  border-radius: 1.25rem;
  background: var(--navigator-surface-raised);
  box-shadow: 0 12px 28px color-mix(in srgb, var(--navigator-shadow) 72%, transparent);
}
.form-section legend {
  padding-inline: .35rem;
  font: 650 clamp(1.25rem, 3vw, 1.65rem)/1.2 Georgia, "Times New Roman", serif;
}
.form-section legend > span {
  display: inline-grid;
  width: 2rem;
  height: 2rem;
  margin-right: .45rem;
  place-items: center;
  border-radius: 50%;
  color: var(--navigator-on-primary);
  background: var(--navigator-primary);
  font: 800 .85rem/1 Inter, ui-sans-serif, system-ui, sans-serif;
}
.section-intro,
.form-section > p { margin: 0; color: var(--navigator-muted); line-height: 1.55; }
.option-group,
.source-space { padding: .25rem 0; }
.option-group h2,
.source-space h2,
.source-space h3 { margin: .35rem 0; font-family: Georgia, "Times New Roman", serif; }
.option-group h2,
.source-space h2 { font-size: 1.05rem; }
.source-space h3 { font-size: 1rem; }
.source-space article { padding-top: .45rem; }
.source-space p { margin: .2rem 0; color: var(--navigator-muted); font-size: .88rem; }
.check-row {
  gap: .75rem;
  margin-block: .55rem;
  padding: .9rem;
  border: 1px solid var(--navigator-border);
  border-radius: .9rem;
  background: color-mix(in srgb, var(--navigator-surface) 60%, var(--navigator-surface-raised));
  cursor: pointer;
}
.check-row:has(input:checked) {
  border-color: var(--navigator-primary);
  background: color-mix(in srgb, var(--navigator-primary) 8%, var(--navigator-surface-raised));
}
.check-row input { width: 1.15rem; height: 1.15rem; margin-top: .12rem; }
.check-row small { margin-top: .2rem; color: var(--navigator-muted); opacity: 1; }
.check-row em {
  display: inline-block;
  margin-top: .45rem;
  padding: .2rem .5rem;
  border-radius: 999px;
  color: var(--navigator-primary);
  background: color-mix(in srgb, var(--navigator-primary) 11%, transparent);
  font-size: .7rem;
  font-style: normal;
  font-weight: 800;
  text-transform: uppercase;
}
.current-venue {
  display: flex;
  align-items: center;
  gap: .8rem;
  padding: 1rem;
  border: 1px solid var(--navigator-primary);
  border-radius: .9rem;
  background: color-mix(in srgb, var(--navigator-primary) 8%, var(--navigator-surface-raised));
}
.current-venue > span {
  width: 2rem;
  height: 2rem;
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 50%;
  color: var(--navigator-on-primary);
  background: var(--navigator-primary);
  font-weight: 850;
}
.current-venue div,
.current-venue small { display: block; }
.current-venue small { margin-top: .2rem; color: var(--navigator-muted); }
.advanced-options {
  padding: .9rem 1rem;
  border: 1px solid var(--navigator-border);
  border-radius: .9rem;
}
.advanced-options summary {
  color: var(--navigator-primary);
  font-weight: 800;
  cursor: pointer;
}
.advanced-options > p {
  color: var(--navigator-muted);
  line-height: 1.5;
}
.field-label,
.range-control,
.inline-control label,
.routing-row label,
.transfer-section label { display: grid; gap: .5rem; font-weight: 700; }
.field-label input,
.inline-control input,
.routing-row input,
.routing-row select,
.transfer-section input {
  width: 100%;
  min-height: 46px;
  padding: .7rem .8rem;
  border: 1px solid var(--navigator-border);
  border-radius: .75rem;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
}
.duration-control { width: fit-content; display: flex; align-items: center; gap: .65rem; }
.duration-control input { width: 7rem; font-size: 1.15rem; }
.duration-control strong { color: var(--navigator-muted); }
.range-control { padding: .7rem 0; }
.range-control > span { display: flex; justify-content: space-between; gap: 1rem; }
.range-control output { color: var(--navigator-primary); font-size: .85rem; }
.range-control input { width: 100%; accent-color: var(--navigator-primary); }
.range-control small { color: var(--navigator-muted); font-weight: 450; }
.routing-row { padding-top: .85rem; border-top: 1px solid var(--navigator-border); }
.subject-results { padding: .4rem; border-color: var(--navigator-border); border-radius: .9rem; }
.generation-summary {
  position: sticky;
  top: 1rem;
  display: grid;
  gap: 1rem;
  padding: 1.4rem;
  border: 1px solid var(--navigator-border);
  border-radius: 1.25rem;
  background: var(--navigator-surface-raised);
  box-shadow: 0 16px 38px var(--navigator-shadow);
}
.generation-summary h2 { margin: -.55rem 0 0; font: 650 1.65rem/1.2 Georgia, "Times New Roman", serif; }
.generation-summary dl { display: grid; gap: 0; margin: 0; }
.generation-summary dl > div {
  display: grid;
  grid-template-columns: 5.5rem 1fr;
  gap: .75rem;
  padding: .75rem 0;
  border-bottom: 1px solid var(--navigator-border);
}
.generation-summary dt { color: var(--navigator-muted); }
.generation-summary dd { margin: 0; font-weight: 750; text-align: right; }
.generation-summary > small { color: var(--navigator-muted); text-align: center; line-height: 1.45; }
.primary-action {
  width: 100%;
  border-color: var(--navigator-primary);
  color: var(--navigator-on-primary);
  background: var(--navigator-primary);
  font-weight: 800;
}
.state-card,
.error-card {
  margin: 1.25rem 0 0;
  padding: 1rem 1.15rem;
  border: 1px solid var(--navigator-border);
  border-radius: .9rem;
  background: var(--navigator-surface-raised);
}
.error-card { border-color: #b42318; color: #b42318; }
@media (max-width: 56rem) {
  .generation-layout { grid-template-columns: 1fr; }
  .generation-summary { position: static; grid-row: 1; }
}
@media (max-width: 42rem) {
  .generate-page { padding: .75rem; }
  .generate-hero { min-height: 15rem; border-radius: 1.1rem; }
  .generation-layout { margin-top: 1rem; }
  .form-section { padding: 1rem; border-radius: 1rem; }
  .generation-summary { padding: 1.1rem; }
}
</style>
