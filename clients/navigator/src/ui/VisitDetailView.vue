<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useConfiguredVenueStore, useRuntimeStore } from "../application/stores";
import { navigatorVisitRepository, type NavigatorVisitDetail } from "../infrastructure/http/navigatorVisitRepository";
import {
  executionPreparationRepository,
  type ExecutionMode,
  type ExecutionPreparationProjection,
  type PreparationUpdate,
} from "../infrastructure/http/executionPreparationRepository";
import ChoiceCard from "./ChoiceCard.vue";
import NavigationPreferencesPanel from "./NavigationPreferencesPanel.vue";

const route = useRoute();
const router = useRouter();
const runtimeStore = useRuntimeStore();
const configuredVenueStore = useConfiguredVenueStore();
const { config } = storeToRefs(configuredVenueStore);
const detail = ref<NavigatorVisitDetail | null>(null);
const preparation = ref<ExecutionPreparationProjection | null>(null);
const busy = ref(true);
const updating = ref(false);
const starting = ref(false);
const error = ref<string | null>(null);
const depthPreference = ref(0.5);
const complexityPreference = ref(0.5);
const requestedJoinAlias = ref("");
const venueId = computed(() => String(route.params.venueId || ""));
let presentationTimer: ReturnType<typeof setTimeout> | null = null;

const canStart = computed(() => Boolean(
  preparation.value
  && preparation.value.status === "active"
  && preparation.value.readiness.status === "ready"
  && preparation.value.readiness.blockers.length === 0,
));
const synchronizedModeAvailable = computed(() => preparation.value?.availableExecutionModes.includes("synchronized") === true);

function preferenceLabel(value: number, labels: [string, string, string]) {
  return labels[Math.min(2, Math.floor(value * 3))];
}
const depthLabel = computed(() => preferenceLabel(depthPreference.value, ["Essenziale", "Equilibrato", "Approfondito"]));
const complexityLabel = computed(() => preferenceLabel(complexityPreference.value, ["Accessibile", "Intermedio", "Specialistico"]));

function detailedDuration(seconds: number) {
  const totalSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const wholeMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (!wholeMinutes) return `${remainingSeconds} s`;
  if (!remainingSeconds) return `${wholeMinutes} min`;
  return `${wholeMinutes} min ${remainingSeconds} s`;
}

function syncPreparationControls(value: ExecutionPreparationProjection) {
  depthPreference.value = value.effectivePresentationPreference?.depthPreference ?? 0.5;
  complexityPreference.value = value.effectivePresentationPreference?.languageComplexityPreference ?? 0.5;
  requestedJoinAlias.value = value.groupSessionSetup.requestedJoinAlias || "";
}

onMounted(async () => {
  try {
    detail.value = await navigatorVisitRepository.detail(String(route.params.visitId), venueId.value);
    preparation.value = await executionPreparationRepository.createForVisit(detail.value.visit.id, "self_guided");
    syncPreparationControls(preparation.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile preparare la visita";
  } finally {
    busy.value = false;
  }
});
onUnmounted(() => { if (presentationTimer) clearTimeout(presentationTimer); });

async function patchPreparation(patch: PreparationUpdate, fallbackMessage: string) {
  if (!preparation.value || preparation.value.status !== "active" || updating.value || starting.value) return;
  updating.value = true;
  error.value = null;
  try {
    preparation.value = await executionPreparationRepository.update(preparation.value, patch);
    syncPreparationControls(preparation.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : fallbackMessage;
  } finally {
    updating.value = false;
  }
}

async function updatePresentation() {
  await patchPreparation({
    presentationPreference: {
      depthPreference: depthPreference.value,
      languageComplexityPreference: complexityPreference.value,
    },
  }, "Impossibile aggiornare la presentazione");
}
function schedulePresentationUpdate() {
  if (presentationTimer) clearTimeout(presentationTimer);
  presentationTimer = setTimeout(() => {
    presentationTimer = null;
    if (updating.value) { schedulePresentationUpdate(); return; }
    void updatePresentation();
  }, 400);
}
async function updateNavigation(patch: PreparationUpdate) {
  await patchPreparation(patch, "Impossibile aggiornare il percorso");
}
async function selectExecutionMode(executionMode: ExecutionMode) {
  if (preparation.value?.executionMode === executionMode) return;
  await patchPreparation({ executionMode }, "Impossibile cambiare la modalità di avvio");
}
async function updateGroupAlias() {
  if (preparation.value?.executionMode !== "synchronized") return;
  await patchPreparation({ groupSessionSetup: { requestedJoinAlias: requestedJoinAlias.value.trim() || null } }, "Impossibile aggiornare il nome di ingresso");
}
async function start() {
  if (!preparation.value || !canStart.value) return;
  starting.value = true;
  error.value = null;
  try {
    const response = await executionPreparationRepository.start(preparation.value);
    preparation.value = response.preparation;
    runtimeStore.applySnapshot(response.current);
    if (response.synchronized) {
      await router.push({ name: "together-session", params: { synchronizedSessionId: response.synchronized.synchronizedSession.id } });
    } else {
      await router.push({ name: "museum-session", params: { venueId: venueId.value, sessionId: response.session._id } });
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile avviare la visita";
  } finally {
    starting.value = false;
  }
}
</script>

<template>
  <main class="previsit-page">
    <p v-if="busy" class="previsit-state">Preparazione della visita…</p>
    <p v-else-if="error && !detail" class="previsit-state error-state" role="alert">{{ error }}</p>
    <template v-else-if="detail">
      <section class="previsit-hero">
        <img v-if="config?.branding.heroImage" :src="config.branding.heroImage.src" :alt="config.branding.heroImage.alt">
        <div class="previsit-hero-overlay">
          <RouterLink class="back-link" :to="{ name: 'museum-library', params: { venueId } }">← Torna alla libreria</RouterLink>
          <div><p class="eyebrow">Prepara la visita</p><h1>{{ detail.visit.title }}</h1><p v-if="detail.visit.description">{{ detail.visit.description }}</p><div class="visit-meta"><span>{{ detail.visit.stopCount }} tappe</span><span>{{ detail.visit.contentCount }} contenuti</span><span>Di {{ detail.context.owner.name }}</span></div></div>
        </div>
      </section>

      <div v-if="preparation" class="previsit-layout">
        <div class="previsit-main">
          <section class="previsit-card">
            <div class="section-intro"><p class="eyebrow">Prima di iniziare</p><h2>Informazioni utili</h2><p>Leggi le indicazioni del museo prima di iniziare il percorso.</p></div>
            <ul v-if="preparation.preVisit.visitNotes.length" class="information-list"><li v-for="note in preparation.preVisit.visitNotes" :key="note">{{ note }}</li></ul>
            <article v-for="venue in preparation.preVisit.venues" :key="venue.id" class="venue-information"><h3>{{ venue.name }}</h3><ul v-if="venue.information.length" class="information-list"><li v-for="information in venue.information" :key="information">{{ information }}</li></ul><p v-else>Nessuna indicazione aggiuntiva per questa sede.</p></article>
          </section>

          <section class="previsit-card">
            <div class="section-intro"><p class="eyebrow">Adatta la visita</p><h2>Personalizza l’esperienza</h2><p>Regola racconto e percorso. La stima viene ricalcolata automaticamente dal backend.</p></div>
            <section class="presentation-panel">
              <div class="preference-section-heading"><strong>Come vuoi ascoltare</strong><small>Le modifiche vengono applicate automaticamente dopo una breve pausa.</small></div>
              <div class="presentation-controls">
                <label><span><strong>Approfondimento</strong><output>{{ depthLabel }}</output></span><input v-model.number="depthPreference" type="range" min="0" max="1" step="0.1" :disabled="updating || starting" @input="schedulePresentationUpdate"><small>Da una sintesi essenziale a un racconto più approfondito.</small></label>
                <label><span><strong>Complessità del linguaggio</strong><output>{{ complexityLabel }}</output></span><input v-model.number="complexityPreference" type="range" min="0" max="1" step="0.1" :disabled="updating || starting" @input="schedulePresentationUpdate"><small>Adatta il lessico al livello che preferisci.</small></label>
              </div>
              <p v-if="preparation.executionMode === 'synchronized'" class="group-note">Nella visita di gruppo queste preferenze restano personali: la durata condivisa continua a usare la baseline editoriale comune.</p>
              <button class="update-estimate" type="button" :disabled="updating || starting" @click="updatePresentation">{{ updating ? "Aggiornamento…" : "Ricalcola ora" }}</button>
            </section>

            <NavigationPreferencesPanel :navigation="preparation.navigation" :execution-mode="preparation.executionMode" :disabled="updating || starting" @apply="updateNavigation" />
          </section>
        </div>

        <aside class="previsit-summary">
          <p class="eyebrow">Riepilogo</p><h2>La tua visita</h2>
          <div class="duration-summary"><strong>{{ detailedDuration(preparation.logisticsPreview.estimatedTotalSeconds) }}</strong><span>circa</span></div>
          <dl aria-live="polite">
            <div><dt>Contenuti</dt><dd>{{ detailedDuration(preparation.logisticsPreview.breakdown.contentSeconds) }}</dd></div>
            <div><dt>Osservazione</dt><dd>{{ detailedDuration(preparation.logisticsPreview.breakdown.observationSeconds) }}</dd></div>
            <div><dt>Spostamenti</dt><dd>{{ detailedDuration(preparation.logisticsPreview.breakdown.travelSeconds) }}</dd></div>
            <div v-if="preparation.logisticsPreview.reservedSeconds"><dt>Riserva</dt><dd>+ {{ detailedDuration(preparation.logisticsPreview.reservedSeconds) }}</dd></div>
          </dl>
          <p v-if="preparation.logisticsPreview.routeSummary.venueCount" class="route-summary">{{ preparation.logisticsPreview.routeSummary.venueCount }} sedi · {{ preparation.logisticsPreview.routeSummary.stopCount }} tappe · {{ preparation.logisticsPreview.routeSummary.legCount }} spostamenti</p>

          <section class="execution-mode">
            <div class="execution-mode-intro"><strong>Modalità di avvio</strong><small>Scegli come eseguire questa visita. La scelta riguarda solo questa sessione.</small></div>
            <div class="execution-mode-options">
              <ChoiceCard :selected="preparation.executionMode === 'self_guided'" :disabled="updating || starting" title="Personale" description="Segui il percorso al tuo ritmo." @activate="selectExecutionMode('self_guided')" />
              <ChoiceCard v-if="synchronizedModeAvailable" :selected="preparation.executionMode === 'synchronized'" :disabled="updating || starting" title="Di gruppo" description="Guida i partecipanti sulla stessa tappa e sul percorso configurato." @activate="selectExecutionMode('synchronized')" />
            </div>
            <div v-if="preparation.executionMode === 'synchronized'" class="group-session-setup"><p><strong>Percorso dell’host</strong><span>Le tue esigenze fisiche e le opzioni di percorso diventano il percorso condiviso del gruppo.</span></p><label><span><strong>Nome per entrare</strong></span><input v-model="requestedJoinAlias" type="text" maxlength="80" autocomplete="off" :disabled="updating || starting" @change="updateGroupAlias"><small>I partecipanti useranno queste parole per entrare nella lobby.</small></label></div>
          </section>

          <div v-if="canStart" class="readiness ready"><span>✓</span>Nessun impedimento rilevato</div>
          <div v-else class="readiness blocked"><span>!</span>Controlla le indicazioni prima di iniziare</div>
          <ul v-if="preparation.readiness.warnings.length" class="readiness-list"><li v-for="warning in preparation.readiness.warnings" :key="warning.code">{{ warning.message }}</li></ul>
          <ul v-if="preparation.logisticsPreview.warnings.length" class="readiness-list"><li v-for="warning in preparation.logisticsPreview.warnings" :key="warning.code">{{ warning.message }}</li></ul>
          <ul v-if="preparation.readiness.blockers.length" class="readiness-list blocker-list"><li v-for="blocker in preparation.readiness.blockers" :key="blocker.code">{{ blocker.message }}</li></ul>
          <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
          <button class="start-visit" type="button" :disabled="starting || updating || !canStart" @click="start">{{ starting ? "Avvio…" : preparation.executionMode === "synchronized" ? "Crea la lobby →" : "Inizia visita →" }}</button>
        </aside>
      </div>
    </template>
  </main>
</template>

<style scoped>
.previsit-page{width:min(100%,72rem);margin:0 auto;padding:1rem 1rem 6rem;color:var(--navigator-ink)}
.previsit-state{padding:3rem 1rem;text-align:center}.error-state,.inline-error{color:#b64a3a}.previsit-hero{position:relative;min-height:18rem;overflow:hidden;border-radius:1.4rem;background:var(--navigator-surface-raised)}.previsit-hero>img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}.previsit-hero-overlay{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;padding:1.2rem;color:#fff;background:linear-gradient(180deg,rgba(0,0,0,.28),rgba(0,0,0,.72))}.previsit-hero-overlay h1{margin:.25rem 0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(2rem,7vw,3.5rem);font-weight:500}.back-link{color:inherit;text-decoration:none}.visit-meta{display:flex;flex-wrap:wrap;gap:.45rem}.visit-meta span{padding:.28rem .5rem;border-radius:999px;background:rgba(0,0,0,.35);font-size:.78rem}.previsit-layout{display:grid;gap:1rem;margin-top:1rem}.previsit-main{display:grid;gap:1rem}.previsit-card,.previsit-summary,.presentation-panel{border:1px solid var(--navigator-border);border-radius:1.1rem;background:var(--navigator-surface-raised)}.previsit-card{padding:1rem}.section-intro h2,.previsit-summary h2{margin:.2rem 0}.section-intro p{color:var(--navigator-muted)}.eyebrow{margin:0;color:var(--navigator-primary);font-size:.7rem;font-weight:820;letter-spacing:.08em;text-transform:uppercase}.information-list{padding-left:1.2rem}.venue-information{padding-top:.6rem;border-top:1px solid var(--navigator-border)}.presentation-panel{display:grid;gap:.8rem;padding:.9rem}.preference-section-heading{display:grid;gap:.2rem}.preference-section-heading small,.presentation-controls small,.group-note,.execution-mode-intro small,.group-session-setup small{color:var(--navigator-muted)}.presentation-controls{display:grid;gap:.9rem}.presentation-controls label{display:grid;gap:.4rem}.presentation-controls label>span{display:flex;justify-content:space-between;gap:1rem}.presentation-controls output{color:var(--navigator-primary);font-weight:800}.group-note{margin:0;padding:.65rem;border-radius:.75rem;background:color-mix(in srgb,var(--navigator-primary) 7%,var(--navigator-surface-raised));font-size:.78rem;line-height:1.45}.update-estimate,.start-visit{min-height:2.8rem}.previsit-summary{display:grid;align-content:start;gap:.85rem;padding:1rem}.duration-summary{display:flex;align-items:baseline;gap:.45rem}.duration-summary strong{font-size:2rem;font-family:Georgia,"Times New Roman",serif}.duration-summary span{color:var(--navigator-muted)}.previsit-summary dl{display:grid;gap:.45rem;margin:0}.previsit-summary dl div{display:flex;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--navigator-border);padding-bottom:.4rem}.previsit-summary dt{color:var(--navigator-muted)}.route-summary{color:var(--navigator-muted);font-size:.8rem}.execution-mode,.execution-mode-options,.group-session-setup{display:grid;gap:.65rem}.execution-mode-intro{display:grid;gap:.2rem}.group-session-setup{padding:.8rem;border:1px solid var(--navigator-border);border-radius:.8rem;background:color-mix(in srgb,var(--navigator-primary) 6%,var(--navigator-surface-raised))}.group-session-setup p,.group-session-setup label{display:grid;gap:.25rem;margin:0}.group-session-setup input{min-height:2.7rem;border:1px solid var(--navigator-border);border-radius:.7rem;padding:.6rem;color:var(--navigator-ink);background:var(--navigator-surface)}.readiness{display:flex;gap:.45rem;align-items:center;padding:.65rem;border-radius:.75rem}.readiness.ready{background:color-mix(in srgb,#3b8b5c 14%,var(--navigator-surface-raised))}.readiness.blocked{background:color-mix(in srgb,#c98a20 16%,var(--navigator-surface-raised))}.readiness-list{margin:0;padding-left:1.2rem;color:var(--navigator-muted);font-size:.8rem}.blocker-list{color:#b64a3a}.start-visit{width:100%;font-weight:800}
@media(min-width:60rem){.previsit-layout{grid-template-columns:minmax(0,1fr) 20rem;align-items:start}.previsit-summary{position:sticky;top:1rem}}
</style>
