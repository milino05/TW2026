<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useConfiguredVenueStore, useRuntimeStore } from "../application/stores";
import { navigatorVisitRepository, type NavigatorVisitDetail } from "../infrastructure/http/navigatorVisitRepository";
import {
  executionPreparationRepository,
  type ExecutionPreparationProjection,
  type RoutingProfileSelection,
} from "../infrastructure/http/executionPreparationRepository";

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
const movementPacePreference = ref(0.5);
const selectedRoutingProfiles = ref<Record<string, string>>({});
const venueId = computed(() => String(route.params.venueId || ""));

const canStart = computed(() => Boolean(
  preparation.value &&
  preparation.value.status === "active" &&
  preparation.value.readiness.status === "ready" &&
  preparation.value.readiness.blockers.length === 0,
));

function preferenceLabel(value: number, labels: [string, string, string]) {
  return labels[Math.min(2, Math.floor(value * 3))];
}

const depthLabel = computed(() => preferenceLabel(
  depthPreference.value,
  ["Essenziale", "Equilibrato", "Approfondito"],
));
const complexityLabel = computed(() => preferenceLabel(
  complexityPreference.value,
  ["Accessibile", "Intermedio", "Specialistico"],
));
const movementPaceLabel = computed(() => preferenceLabel(
  movementPacePreference.value,
  ["Rilassato", "Regolare", "Sostenuto"],
));

function minutes(seconds: number) {
  return Math.max(0, Math.ceil(seconds / 60));
}

function preparationVenueLabel(targetVenueId: string) {
  return preparation.value?.preVisit.venues.find((venue) => String(venue.id) === String(targetVenueId))?.name || "Sede";
}

function selectedProfile(group: ExecutionPreparationProjection["navigation"]["profilesByVenue"][number]) {
  const selectedId = selectedRoutingProfiles.value[String(group.venueId)] || "";
  return group.profiles.find((profile) => profile.definitionId === selectedId) || null;
}

function routingProfileSelections(): RoutingProfileSelection[] {
  const availableByVenue = new Map((preparation.value?.navigation.profilesByVenue || []).map((group) => [
    String(group.venueId),
    new Set(group.profiles.map((profile) => profile.definitionId)),
  ]));
  return Object.entries(selectedRoutingProfiles.value)
    .filter(([targetVenueId, profileId]) => Boolean(profileId) && availableByVenue.get(targetVenueId)?.has(profileId))
    .map(([targetVenueId, routingProfileDefinitionId]) => ({ venueId: targetVenueId, routingProfileDefinitionId }));
}

function syncPreparationControls(value: ExecutionPreparationProjection) {
  depthPreference.value = value.effectivePresentationPreference?.depthPreference ?? 0.5;
  complexityPreference.value = value.effectivePresentationPreference?.languageComplexityPreference ?? 0.5;
  movementPacePreference.value = value.navigation.movementPacePreference;
  selectedRoutingProfiles.value = Object.fromEntries(
    (value.navigation.routingProfileSelections || []).map((selection) => [String(selection.venueId), selection.routingProfileDefinitionId]),
  );
}

onMounted(async () => {
  try {
    detail.value = await navigatorVisitRepository.detail(
      String(route.params.visitId),
      venueId.value,
    );
    preparation.value = await executionPreparationRepository.createForVisit(detail.value.visit.id);
    syncPreparationControls(preparation.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile preparare la visita";
  } finally {
    busy.value = false;
  }
});

async function updatePreparation() {
  if (!preparation.value || preparation.value.status !== "active" || updating.value) return;
  updating.value = true;
  error.value = null;
  try {
    preparation.value = await executionPreparationRepository.update(preparation.value, {
      presentationPreference: {
        depthPreference: depthPreference.value,
        languageComplexityPreference: complexityPreference.value,
      },
      movementPacePreference: movementPacePreference.value,
      routingProfileSelections: routingProfileSelections(),
    });
    syncPreparationControls(preparation.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile aggiornare la preparazione";
  } finally {
    updating.value = false;
  }
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
      await router.push({
        name: "together-session",
        params: { synchronizedSessionId: response.synchronized.synchronizedSession.id },
      });
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
        <img
          v-if="config?.branding.heroImage"
          :src="config.branding.heroImage.src"
          :alt="config.branding.heroImage.alt"
        >
        <div class="previsit-hero-overlay">
          <RouterLink class="back-link" :to="{ name: 'museum-library', params: { venueId } }">← Torna alla libreria</RouterLink>
          <div>
            <p class="eyebrow">Prepara la visita</p>
            <h1>{{ detail.visit.title }}</h1>
            <p v-if="detail.visit.description">{{ detail.visit.description }}</p>
            <div class="visit-meta" aria-label="Dettagli della visita">
              <span>{{ detail.visit.stopCount }} tappe</span>
              <span>{{ detail.visit.contentCount }} contenuti</span>
              <span>Di {{ detail.context.owner.name }}</span>
            </div>
            <p v-if="detail.visit.physicalScope.length" class="venue-list">
              {{ detail.visit.physicalScope.map((venue) => venue.name).join(" · ") }}
            </p>
          </div>
        </div>
      </section>

      <div v-if="preparation" class="previsit-layout">
        <div class="previsit-main">
          <section class="previsit-card" aria-labelledby="previsit-title">
            <div class="section-intro">
              <p class="eyebrow">Prima di iniziare</p>
              <h2 id="previsit-title">Informazioni utili</h2>
              <p>Leggi le indicazioni del museo prima di iniziare il percorso.</p>
            </div>

            <ul v-if="preparation.preVisit.visitNotes.length" class="information-list">
              <li v-for="note in preparation.preVisit.visitNotes" :key="note">{{ note }}</li>
            </ul>
            <article v-for="venue in preparation.preVisit.venues" :key="venue.id" class="venue-information">
              <h3>{{ venue.name }}</h3>
              <ul v-if="venue.information.length" class="information-list">
                <li v-for="information in venue.information" :key="information">{{ information }}</li>
              </ul>
              <p v-else>Nessuna indicazione aggiuntiva per questa sede.</p>
            </article>
            <p v-if="!preparation.preVisit.visitNotes.length && !preparation.preVisit.venues.length" class="empty-information">
              Non ci sono indicazioni particolari per questa visita.
            </p>
          </section>

          <section class="previsit-card" aria-labelledby="preparation-title">
            <div class="section-intro">
              <p class="eyebrow">Adatta la visita</p>
              <h2 id="preparation-title">Personalizza l’esperienza</h2>
              <p>Regola racconto e percorso: durata, readiness e logistica vengono ricalcolati dal backend.</p>
            </div>
            <div class="preparation-controls">
              <label>
                <span><strong>Approfondimento</strong><output>{{ depthLabel }}</output></span>
                <input v-model.number="depthPreference" type="range" min="0" max="1" step="0.1">
                <small>Da una sintesi essenziale a un racconto più approfondito.</small>
              </label>
              <label>
                <span><strong>Complessità del linguaggio</strong><output>{{ complexityLabel }}</output></span>
                <input v-model.number="complexityPreference" type="range" min="0" max="1" step="0.1">
                <small>Adatta il lessico al livello che preferisci.</small>
              </label>

              <section v-if="preparation.navigation.profilesByVenue.length" class="routing-profile-section">
                <div class="routing-profile-intro">
                  <strong>Profilo di percorso</strong>
                  <small>I profili sono definiti separatamente da ciascuna sede e non vengono confrontati per nome.</small>
                </div>
                <article v-for="group in preparation.navigation.profilesByVenue" :key="group.venueId" class="routing-profile-card">
                  <label>
                    <span><strong>{{ preparationVenueLabel(group.venueId) }}</strong></span>
                    <select v-model="selectedRoutingProfiles[group.venueId]" :disabled="updating || starting" @change="updatePreparation">
                      <option value="">Nessun profilo specifico</option>
                      <option v-for="profile in group.profiles" :key="profile.definitionId" :value="profile.definitionId">{{ profile.label }}</option>
                    </select>
                  </label>
                  <template v-if="selectedProfile(group)">
                    <p>{{ selectedProfile(group)?.description }}</p>
                    <ul v-if="selectedProfile(group)?.requirements.length">
                      <li v-for="requirement in selectedProfile(group)?.requirements" :key="`${requirement.label}-${requirement.operator}-${JSON.stringify(requirement.value)}-${requirement.priority}`">
                        {{ requirement.label }} · {{ requirement.priority === "required" ? "necessario" : requirement.priority === "avoid" ? "da evitare" : "preferito" }}
                      </li>
                    </ul>
                  </template>
                </article>
              </section>

              <label>
                <span><strong>Ritmo di spostamento</strong><output>{{ movementPaceLabel }}</output></span>
                <input v-model.number="movementPacePreference" type="range" min="0" max="1" step="0.1">
                <small>Influisce sul tempo previsto tra una tappa e la successiva.</small>
              </label>
              <button class="update-estimate" type="button" :disabled="updating || starting" @click="updatePreparation">
                {{ updating ? "Aggiornamento…" : "Aggiorna stima" }}
              </button>
            </div>
          </section>
        </div>

        <aside class="previsit-summary" aria-labelledby="summary-title">
          <p class="eyebrow">Riepilogo</p>
          <h2 id="summary-title">La tua visita</h2>
          <div class="duration-summary">
            <strong>{{ minutes(preparation.logisticsPreview.estimatedTotalSeconds) }}</strong>
            <span>minuti circa</span>
          </div>
          <dl>
            <div><dt>Contenuti</dt><dd>{{ minutes(preparation.logisticsPreview.breakdown.contentSeconds) }} min</dd></div>
            <div><dt>Osservazione</dt><dd>{{ minutes(preparation.logisticsPreview.breakdown.observationSeconds) }} min</dd></div>
            <div><dt>Spostamenti</dt><dd>{{ minutes(preparation.logisticsPreview.breakdown.travelSeconds) }} min</dd></div>
            <div v-if="preparation.logisticsPreview.reservedSeconds"><dt>Riserva</dt><dd>+ {{ minutes(preparation.logisticsPreview.reservedSeconds) }} min</dd></div>
          </dl>
          <p v-if="preparation.logisticsPreview.routeSummary.venueCount" class="route-summary">
            {{ preparation.logisticsPreview.routeSummary.venueCount }} sedi ·
            {{ preparation.logisticsPreview.routeSummary.stopCount }} tappe ·
            {{ preparation.logisticsPreview.routeSummary.legCount }} spostamenti
          </p>

          <div v-if="canStart" class="readiness ready"><span aria-hidden="true">✓</span>Nessun impedimento rilevato</div>
          <div v-else class="readiness blocked"><span aria-hidden="true">!</span>Controlla le indicazioni prima di iniziare</div>

          <ul v-if="preparation.readiness.warnings.length" class="readiness-list warning-list">
            <li v-for="warning in preparation.readiness.warnings" :key="warning.code">{{ warning.message }}</li>
          </ul>
          <ul v-if="preparation.logisticsPreview.warnings.length" class="readiness-list warning-list">
            <li v-for="warning in preparation.logisticsPreview.warnings" :key="warning.code">{{ warning.message }}</li>
          </ul>
          <ul v-if="preparation.readiness.blockers.length" class="readiness-list blocker-list" role="alert">
            <li v-for="blocker in preparation.readiness.blockers" :key="blocker.code">{{ blocker.message }}</li>
          </ul>
          <p v-if="error" class="inline-error" role="alert">{{ error }}</p>

          <button class="start-visit" type="button" :disabled="starting || updating || !canStart" @click="start">
            {{ starting ? "Avvio…" : detail.visit.deliveryMode === "synchronized" ? "Crea la lobby →" : "Inizia visita →" }}
          </button>
        </aside>
      </div>
      <p v-else-if="error" class="previsit-state error-state" role="alert">{{ error }}</p>
    </template>
  </main>
</template>

<style scoped>
.previsit-page {
  width: min(100%, 72rem);
  margin: 0 auto;
  padding: 1rem 1rem clamp(5rem, 8vw, 7rem);
}

.previsit-state {
  margin: clamp(2rem, 8vw, 6rem) auto;
  padding: 1.25rem;
  border: 1px solid var(--navigator-border);
  border-radius: 1rem;
  color: var(--navigator-muted);
  background: var(--navigator-surface-raised);
  text-align: center;
}

.error-state,
.inline-error { color: #b33138; }

.previsit-hero {
  position: relative;
  min-height: clamp(22rem, 46vw, 31rem);
  overflow: hidden;
  display: flex;
  align-items: end;
  border-radius: 1.6rem;
  background: color-mix(in srgb, var(--navigator-brand-primary) 20%, var(--navigator-surface-raised));
  box-shadow: 0 18px 46px var(--navigator-shadow);
}

.previsit-hero > img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.previsit-hero::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, rgba(11, 16, 15, .24), rgba(11, 16, 15, .9));
}

.previsit-hero-overlay {
  position: relative;
  z-index: 1;
  width: 100%;
  padding: clamp(1.35rem, 5vw, 3rem);
  color: #fff;
}

.back-link {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  margin-bottom: clamp(2rem, 6vw, 4rem);
  padding: .65rem .85rem;
  border: 1px solid rgba(255, 255, 255, .42);
  border-radius: .75rem;
  color: #fff;
  background: rgba(255, 255, 255, .1);
  font-size: .85rem;
  font-weight: 750;
  text-decoration: none;
  backdrop-filter: blur(10px);
}

.previsit-hero .eyebrow { color: color-mix(in srgb, var(--navigator-brand-accent) 72%, #fff); }
.previsit-hero h1 {
  max-width: 50rem;
  margin: .25rem 0 .65rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2.35rem, 7vw, 4.7rem);
  font-weight: 500;
  line-height: .98;
}

.previsit-hero-overlay > div > p:not(.eyebrow):not(.venue-list) {
  max-width: 43rem;
  margin: 0 0 1rem;
  color: rgba(255, 255, 255, .82);
  line-height: 1.55;
}

.visit-meta { display: flex; flex-wrap: wrap; gap: .5rem; }
.visit-meta span {
  padding: .38rem .65rem;
  border: 1px solid rgba(255, 255, 255, .35);
  border-radius: 999px;
  background: rgba(255, 255, 255, .1);
  font-size: .75rem;
  font-weight: 720;
}
.venue-list { margin: .8rem 0 0; color: rgba(255, 255, 255, .72); font-size: .82rem; }

.previsit-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(17rem, .8fr);
  gap: clamp(1rem, 3vw, 1.5rem);
  align-items: start;
  padding-top: clamp(1.5rem, 4vw, 2.5rem);
}

.previsit-main { display: grid; gap: 1.25rem; }
.previsit-card,
.previsit-summary {
  border: 1px solid var(--navigator-border);
  border-radius: 1.25rem;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
  box-shadow: 0 9px 26px color-mix(in srgb, var(--navigator-shadow) 70%, transparent);
}
.previsit-card { padding: clamp(1.25rem, 4vw, 2rem); }
.section-intro { margin-bottom: 1.25rem; }
.section-intro h2,
.previsit-summary h2 {
  margin: .2rem 0 .4rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.65rem, 4vw, 2.25rem);
  font-weight: 500;
}
.section-intro > p:last-child { margin: 0; color: var(--navigator-muted); line-height: 1.5; }

.information-list {
  display: grid;
  gap: .65rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.information-list li {
  position: relative;
  padding: .8rem .9rem .8rem 2.2rem;
  border-radius: .8rem;
  background: color-mix(in srgb, var(--navigator-accent) 8%, var(--navigator-surface));
  line-height: 1.45;
}
.information-list li::before {
  content: "i";
  position: absolute;
  left: .75rem;
  top: .8rem;
  width: 1rem;
  height: 1rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
  font-family: Georgia, serif;
  font-size: .68rem;
  font-weight: 700;
}
.venue-information { margin-top: 1.35rem; padding-top: 1.2rem; border-top: 1px solid var(--navigator-border); }
.venue-information h3 { margin: 0 0 .7rem; font-family: Georgia, "Times New Roman", serif; font-size: 1.25rem; font-weight: 500; }
.venue-information > p,
.empty-information { margin: 0; color: var(--navigator-muted); }

.preparation-controls {
  display: grid;
  gap: 0;
}
.preparation-controls > label {
  display: grid;
  gap: .55rem;
  padding: 1.1rem 0;
  border-top: 1px solid var(--navigator-border);
}
.preparation-controls label > span { display: flex; justify-content: space-between; gap: 1rem; }
.preparation-controls output { color: var(--navigator-primary); font-size: .82rem; font-weight: 750; }
.preparation-controls input { width: 100%; accent-color: var(--navigator-brand-primary); cursor: pointer; }
.preparation-controls small { color: var(--navigator-muted); line-height: 1.4; }
.routing-profile-section {
  display: grid;
  gap: .8rem;
  padding: 1.1rem 0;
  border-top: 1px solid var(--navigator-border);
}
.routing-profile-intro { display: grid; gap: .35rem; }
.routing-profile-card {
  display: grid;
  gap: .55rem;
  padding: .9rem;
  border: 1px solid var(--navigator-border);
  border-radius: .85rem;
  background: color-mix(in srgb, var(--navigator-brand-primary) 5%, var(--navigator-surface-raised));
}
.routing-profile-card label { display: grid; gap: .5rem; }
.routing-profile-card select {
  width: 100%;
  min-height: 46px;
  padding: .65rem .75rem;
  border: 1px solid var(--navigator-border);
  border-radius: .7rem;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
}
.routing-profile-card p { margin: 0; color: var(--navigator-muted); line-height: 1.45; }
.routing-profile-card ul { margin: 0; padding-left: 1.15rem; color: var(--navigator-muted); font-size: .8rem; line-height: 1.45; }
.update-estimate {
  justify-self: start;
  margin-top: .6rem;
  border-color: color-mix(in srgb, var(--navigator-primary) 38%, var(--navigator-border));
  color: var(--navigator-primary);
  background: color-mix(in srgb, var(--navigator-primary) 7%, var(--navigator-surface-raised));
  font-weight: 750;
}

.previsit-summary {
  position: sticky;
  top: 1rem;
  padding: 1.4rem;
}
.duration-summary {
  display: flex;
  align-items: baseline;
  gap: .55rem;
  margin: 1.1rem 0;
  padding: 1rem;
  border-radius: 1rem;
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
}
.duration-summary strong { font-family: Georgia, "Times New Roman", serif; font-size: 3rem; font-weight: 500; line-height: 1; }
.duration-summary span { opacity: .82; font-size: .82rem; }
.previsit-summary dl { margin: 0; }
.previsit-summary dl div { display: flex; justify-content: space-between; gap: 1rem; padding: .7rem 0; border-bottom: 1px solid var(--navigator-border); }
.previsit-summary dt { color: var(--navigator-muted); }
.previsit-summary dd { margin: 0; font-weight: 750; }
.route-summary { color: var(--navigator-muted); font-size: .78rem; line-height: 1.45; }
.readiness {
  display: flex;
  align-items: center;
  gap: .55rem;
  margin-top: 1rem;
  padding: .75rem;
  border-radius: .8rem;
  font-size: .8rem;
  font-weight: 720;
}
.readiness span { width: 1.25rem; height: 1.25rem; display: grid; place-items: center; border-radius: 50%; color: #fff; }
.readiness.ready { color: #347159; background: color-mix(in srgb, #4c9775 11%, var(--navigator-surface-raised)); }
.readiness.ready span { background: #347159; }
.readiness.blocked { color: #9a5d13; background: color-mix(in srgb, #c5832e 12%, var(--navigator-surface-raised)); }
.readiness.blocked span { background: #9a5d13; }
.readiness-list { margin: .7rem 0 0; padding-left: 1.15rem; font-size: .78rem; line-height: 1.45; }
.warning-list { color: #9a5d13; }
.blocker-list { color: #b33138; }
.inline-error { padding: .65rem; border-radius: .7rem; background: color-mix(in srgb, #b33138 8%, var(--navigator-surface-raised)); font-size: .82rem; }
.start-visit {
  width: 100%;
  min-height: 52px;
  margin-top: 1rem;
  border-color: var(--navigator-brand-primary);
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
  font-weight: 780;
}

@media (max-width: 820px) {
  .previsit-layout { grid-template-columns: 1fr; }
  .previsit-summary { position: static; }
}

@media (max-width: 620px) {
  .previsit-page { padding-inline: .75rem; }
  .previsit-hero { min-height: 30rem; }
  .previsit-hero-overlay { padding: 1.25rem; }
  .back-link { margin-bottom: 3rem; }
  .visit-meta { gap: .35rem; }
  .previsit-card,
  .previsit-summary { border-radius: 1rem; }
  .preparation-controls label > span { align-items: flex-start; flex-direction: column; gap: .25rem; }
  .update-estimate { width: 100%; }
}
</style>
