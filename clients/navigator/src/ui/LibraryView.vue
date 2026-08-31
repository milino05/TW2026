<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useConfiguredVenueStore } from "../application/stores";
import { runUiCommand } from "../application/uiCommand";
import {
  navigatorVisitRepository,
  type LibraryVisit,
  type ResumableSession,
} from "../infrastructure/http/navigatorVisitRepository";
import ActionMenu from "./ActionMenu.vue";
import AsyncBoundary from "./AsyncBoundary.vue";
import FeedbackActionDialog from "./FeedbackActionDialog.vue";
import FeedbackCallout from "./FeedbackCallout.vue";
import FeedbackEmptyState from "./FeedbackEmptyState.vue";

const route = useRoute();
const configuredVenueStore = useConfiguredVenueStore();
const { config } = storeToRefs(configuredVenueStore);
const visits = ref<LibraryVisit[]>([]);
const resumableSessions = ref<ResumableSession[]>([]);
const busy = ref(true);
const error = ref<string | null>(null);
const venueId = computed(() => String(route.params.venueId));
const pendingRemoval = ref<ResumableSession | null>(null);
const removingSessionId = ref<string | null>(null);
const sessionActionError = ref<string | null>(null);

onMounted(() => {
  void runUiCommand({
    key: `library.load:${venueId.value}`,
    execute: () => Promise.all([
      navigatorVisitRepository.library(venueId.value),
      navigatorVisitRepository.resumableSessions(venueId.value),
    ]),
    lifecycle: {
      setPending: (pending) => { busy.value = pending; },
      clearError: () => { error.value = null; },
      setError: (message) => { error.value = message; },
    },
    errorFallback: "Impossibile caricare la Library",
    onSuccess: ([library, sessions]) => {
      visits.value = library.visits;
      resumableSessions.value = sessions.sessions;
    },
  });
});

function sessionStatus(status: ResumableSession["status"]) {
  if (status === "paused") return "In pausa";
  if (status === "route_completed") return "Percorso completato";
  return "In corso";
}

function requestSessionRemoval(session: ResumableSession) {
  pendingRemoval.value = session;
  sessionActionError.value = null;
}

function closeRemovalConfirm() {
  if (removingSessionId.value) return;
  pendingRemoval.value = null;
}

function confirmSessionRemoval() {
  const session = pendingRemoval.value;
  if (!session) return;
  void runUiCommand({
    key: `library.dismiss-session:${session.id}`,
    execute: () => navigatorVisitRepository.dismissResumableSession(session.id),
    lifecycle: {
      setPending: (pending) => { removingSessionId.value = pending ? session.id : null; },
      clearError: () => { sessionActionError.value = null; },
      setError: (message) => { sessionActionError.value = message; },
    },
    errorFallback: "Impossibile rimuovere la visita da quelle da riprendere",
    successFeedback: { tone: "success", message: "Visita rimossa da quelle da riprendere." },
    onSuccess: () => {
      resumableSessions.value = resumableSessions.value.filter((entry) => entry.id !== session.id);
      pendingRemoval.value = null;
    },
  });
}
</script>

<template>
  <main class="library-page">
    <section class="library-hero">
      <img
        v-if="config?.branding.heroImage"
        :src="config.branding.heroImage.src"
        :alt="config.branding.heroImage.alt"
      >
      <div class="library-hero-overlay">
        <div>
          <p class="eyebrow">La tua libreria</p>
          <h1>{{ config?.branding.museumTitle }}</h1>
          <p>{{ config?.branding.subtitle || "Visite acquistate, create e già iniziate per questo museo." }}</p>
        </div>
        <RouterLink class="change-museum-link" :to="{ name: 'museums' }">Cambia museo</RouterLink>
      </div>
    </section>

    <section class="library-content">
      <AsyncBoundary
        :loading="busy"
        :error="error"
        loading-message="Caricamento delle tue visite…"
        error-title="Library non disponibile"
      >
        <section v-if="resumableSessions.length" aria-labelledby="resume-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Continua da dove eri rimasto</p>
              <h2 id="resume-title">Visite da riprendere</h2>
            </div>
            <span>{{ resumableSessions.length }}</span>
          </div>
          <FeedbackCallout v-if="sessionActionError" tone="danger" semantic-role="alert">
            {{ sessionActionError }}
          </FeedbackCallout>
          <ul class="resume-list">
            <li v-for="session in resumableSessions" :key="session.id">
              <article class="resume-card">
                <div>
                  <p>{{ sessionStatus(session.status) }} · Contenuto {{ session.currentEntryIndex + 1 }}</p>
                  <h3>{{ session.title }}</h3>
                  <small>{{ session.physicalScope.map((venue) => venue.name).join(" · ") }}</small>
                </div>
                <div class="resume-actions">
                  <RouterLink
                    class="resume-link"
                    :to="{ name: 'museum-session', params: { venueId, sessionId: session.id } }"
                  >Riprendi visita</RouterLink>
                  <ActionMenu :label="'Opzioni per ' + session.title">
                    <template #trigger>
                      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.7" fill="currentColor"/>
                        <circle cx="12" cy="12" r="1.7" fill="currentColor"/>
                        <circle cx="19" cy="12" r="1.7" fill="currentColor"/>
                      </svg>
                    </template>
                    <button class="resume-delete-action" type="button" role="menuitem" @click="requestSessionRemoval(session)">
                      Elimina visita
                    </button>
                  </ActionMenu>
                </div>
              </article>
            </li>
          </ul>
        </section>

        <section aria-labelledby="library-title">
          <div class="section-heading visit-heading">
            <div>
              <p class="eyebrow">La tua raccolta</p>
              <h2 id="library-title">Le mie visite</h2>
              <p>{{ visits.length }} {{ visits.length === 1 ? "percorso disponibile" : "percorsi disponibili" }}</p>
            </div>
            <RouterLink
              class="generate-link"
              :to="{ name: 'museum-generate', params: { venueId } }"
            >+ Genera visita</RouterLink>
          </div>

          <FeedbackEmptyState v-if="!visits.length">
            <h3>Non possiedi ancora visite per questo museo</h3>
            <p>Genera una visita per aggiungerla alla tua raccolta.</p>
            <RouterLink
              class="generate-link"
              :to="{ name: 'museum-generate', params: { venueId } }"
            >Genera visita</RouterLink>
          </FeedbackEmptyState>
          <ul v-else class="visit-list">
            <li v-for="visit in visits" :key="visit.id">
              <RouterLink
                class="visit-card"
                :to="{ name: 'museum-visit-detail', params: { venueId, visitId: visit.id } }"
              >
                <span class="visit-count">{{ visit.stopCount }}</span>
                <span class="visit-copy">
                  <strong>{{ visit.title }}</strong>
                  <span v-if="visit.summary">{{ visit.summary }}</span>
                  <small>
                    {{ visit.stopCount }} tappe · Di {{ visit.owner.name }}
                    <template v-if="visit.physicalScope.length > 1">
                      · {{ visit.physicalScope.length }} musei
                    </template>
                  </small>
                </span>
                <span class="visit-arrow" aria-hidden="true">→</span>
              </RouterLink>
            </li>
          </ul>
        </section>
      </AsyncBoundary>
    </section>

    <FeedbackActionDialog
      :open="Boolean(pendingRemoval)"
      tone="danger"
      :dismissible="!removingSessionId"
      :title="pendingRemoval ? `Eliminare “${pendingRemoval.title}”?` : 'Eliminare visita?'"
      message="Verrà rimossa soltanto questa sessione interrotta. La visita resterà disponibile nella sezione “Le mie visite” e potrai iniziarla di nuovo."
      :confirm-label="removingSessionId ? 'Rimozione…' : 'Elimina visita'"
      cancel-label="Annulla"
      @cancel="closeRemovalConfirm"
      @confirm="confirmSessionRemoval"
    />
  </main>
</template>

<style scoped>
.library-page {
  width: min(100%, 70rem);
  margin: 0 auto;
  padding: 1rem 1rem clamp(3rem, 7vw, 5rem);
}

.library-hero {
  position: relative;
  min-height: clamp(18rem, 42vw, 28rem);
  overflow: hidden;
  display: flex;
  align-items: end;
  border-radius: 1.6rem;
  background: color-mix(in srgb, var(--navigator-brand-primary) 18%, var(--navigator-surface-raised));
  box-shadow: 0 18px 46px var(--navigator-shadow);
}

.library-hero > img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.library-hero::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 20%, color-mix(in srgb, #101514 86%, transparent) 100%);
}

.library-hero-overlay {
  position: relative;
  z-index: 1;
  width: 100%;
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 2rem;
  padding: clamp(1.25rem, 4vw, 2.5rem);
  color: #fff;
}

.library-hero-overlay .eyebrow { color: color-mix(in srgb, var(--navigator-brand-accent) 70%, #fff); }
.library-hero-overlay h1 {
  max-width: 46rem;
  margin: .35rem 0 .55rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2.35rem, 7vw, 4.8rem);
  font-weight: 500;
  line-height: .98;
}
.library-hero-overlay p:last-child { max-width: 38rem; margin: 0; color: rgba(255,255,255,.82); }
.change-museum-link {
  flex: 0 0 auto;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: .7rem 1rem;
  border: 1px solid rgba(255,255,255,.48);
  border-radius: .75rem;
  color: #fff;
  background: rgba(255,255,255,.1);
  font-weight: 750;
  text-decoration: none;
}

.library-content { display: grid; gap: clamp(2.5rem, 6vw, 4rem); padding-top: clamp(2rem, 5vw, 3.5rem); }
.section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 1rem;
}
.section-heading h2 {
  margin: .2rem 0 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  font-weight: 500;
}
.section-heading > span {
  min-width: 2.5rem;
  height: 2.5rem;
  display: grid;
  place-items: center;
  border-radius: 50%;
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
}
.visit-heading > div > p:last-child { margin: .2rem 0 0; color: var(--navigator-muted); }

.resume-list,
.visit-list { display: grid; gap: .75rem; margin: 0; padding: 0; list-style: none; }
.resume-card {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 1.25rem;
  padding: 1.25rem;
  border-radius: 1.15rem;
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
  box-shadow: 0 10px 26px var(--navigator-shadow);
}
.resume-card p { margin: 0 0 .3rem; opacity: .78; font-size: .78rem; font-weight: 700; text-transform: uppercase; }
.resume-card h3 { margin: 0 0 .3rem; font-family: Georgia, "Times New Roman", serif; font-size: 1.4rem; font-weight: 500; }
.resume-card small { opacity: .78; }
.resume-link {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: .7rem 1rem;
  border: 1px solid color-mix(in srgb, var(--navigator-on-primary) 45%, transparent);
  border-radius: .75rem;
  color: var(--navigator-on-primary);
  background: color-mix(in srgb, var(--navigator-on-primary) 10%, transparent);
  font-weight: 750;
  text-decoration: none;
}
.resume-actions { display: flex; align-items: center; gap: .5rem; }
.resume-actions :deep(.action-menu-trigger) {
  border-color: color-mix(in srgb, var(--navigator-on-primary) 45%, transparent);
  color: var(--navigator-on-primary);
  background: color-mix(in srgb, var(--navigator-on-primary) 10%, transparent);
}
.resume-delete-action { color: #b33138 !important; font-weight: 750; }

.generate-link {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  padding: .7rem 1rem;
  border-radius: .75rem;
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
  font-weight: 750;
  text-decoration: none;
}
.visit-card {
  min-height: 6.5rem;
  display: grid;
  grid-template-columns: 3.6rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 1rem;
  padding: 1rem;
  border: 1px solid var(--navigator-border);
  border-radius: 1.1rem;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
  text-decoration: none;
  box-shadow: 0 7px 20px color-mix(in srgb, var(--navigator-shadow) 70%, transparent);
}
.visit-card:hover { border-color: color-mix(in srgb, var(--navigator-primary) 55%, var(--navigator-border)); }
.visit-count {
  width: 3.5rem;
  height: 3.5rem;
  display: grid;
  place-items: center;
  border-radius: .9rem;
  color: var(--navigator-primary);
  background: color-mix(in srgb, var(--navigator-primary) 11%, var(--navigator-surface));
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.3rem;
}
.visit-copy { min-width: 0; display: grid; gap: .28rem; }
.visit-copy strong { font-family: Georgia, "Times New Roman", serif; font-size: 1.2rem; font-weight: 500; }
.visit-copy > span { overflow: hidden; color: var(--navigator-muted); text-overflow: ellipsis; white-space: nowrap; }
.visit-copy small { color: var(--navigator-muted); }
.visit-arrow { color: var(--navigator-primary); font-size: 1.4rem; }

@media (max-width: 620px) {
  .library-page { padding-inline: .75rem; }
  .library-hero { min-height: 23rem; }
  .library-hero-overlay { align-items: flex-start; flex-direction: column; }
  .resume-card { grid-template-columns: 1fr; }
  .resume-actions { width: 100%; }
  .resume-link { flex: 1; justify-content: center; }
  .section-heading { align-items: flex-start; }
  .visit-heading { flex-direction: column; }
  .generate-link { width: 100%; justify-content: center; }
  .visit-card { grid-template-columns: 3.1rem minmax(0, 1fr); }
  .visit-count { width: 3rem; height: 3rem; }
  .visit-arrow { display: none; }
}
</style>