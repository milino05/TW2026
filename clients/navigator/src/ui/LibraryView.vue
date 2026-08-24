<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useConfiguredVenueStore } from "../application/stores";
import {
  navigatorVisitRepository,
  type LibraryVisit,
  type ResumableSession,
} from "../infrastructure/http/navigatorVisitRepository";

const route = useRoute();
const configuredVenueStore = useConfiguredVenueStore();
const { config } = storeToRefs(configuredVenueStore);
const visits = ref<LibraryVisit[]>([]);
const resumableSessions = ref<ResumableSession[]>([]);
const busy = ref(true);
const error = ref<string | null>(null);
const venueId = computed(() => String(route.params.venueId));
const openSessionMenuId = ref<string | null>(null);
const pendingRemoval = ref<ResumableSession | null>(null);
const removingSessionId = ref<string | null>(null);
const sessionActionError = ref<string | null>(null);

onMounted(async () => {
  try {
    const [library, sessions] = await Promise.all([
      navigatorVisitRepository.library(venueId.value),
      navigatorVisitRepository.resumableSessions(venueId.value),
    ]);
    visits.value = library.visits;
    resumableSessions.value = sessions.sessions;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile caricare la Library";
  } finally {
    busy.value = false;
  }
});

function sessionStatus(status: ResumableSession["status"]) {
  if (status === "paused") return "In pausa";
  if (status === "route_completed") return "Percorso completato";
  return "In corso";
}

function toggleSessionMenu(sessionId: string) {
  openSessionMenuId.value = openSessionMenuId.value === sessionId ? null : sessionId;
}

function requestSessionRemoval(session: ResumableSession) {
  openSessionMenuId.value = null;
  pendingRemoval.value = session;
  sessionActionError.value = null;
}

function closeRemovalConfirm() {
  if (removingSessionId.value) return;
  pendingRemoval.value = null;
}

async function confirmSessionRemoval() {
  const session = pendingRemoval.value;
  if (!session || removingSessionId.value) return;
  removingSessionId.value = session.id;
  sessionActionError.value = null;
  try {
    await navigatorVisitRepository.dismissResumableSession(session.id);
    resumableSessions.value = resumableSessions.value.filter((entry) => entry.id !== session.id);
    pendingRemoval.value = null;
  } catch (cause) {
    sessionActionError.value = cause instanceof Error
      ? cause.message
      : "Impossibile rimuovere la visita da quelle da riprendere";
  } finally {
    removingSessionId.value = null;
  }
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
      <p v-if="busy" class="library-state">Caricamento delle tue visite…</p>
      <p v-else-if="error" class="library-state error-state" role="alert">{{ error }}</p>

      <template v-else>
        <section v-if="resumableSessions.length" aria-labelledby="resume-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">Continua da dove eri rimasto</p>
              <h2 id="resume-title">Visite da riprendere</h2>
            </div>
            <span>{{ resumableSessions.length }}</span>
          </div>
          <p v-if="sessionActionError" class="session-action-error" role="alert">{{ sessionActionError }}</p>
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
                  <div class="resume-menu">
                    <button
                      class="resume-menu-trigger"
                      type="button"
                      :aria-expanded="openSessionMenuId === session.id"
                      :aria-controls="'resume-menu-' + session.id"
                      :aria-label="'Opzioni per ' + session.title"
                      @click="toggleSessionMenu(session.id)"
                    >
                      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                        <circle cx="5" cy="12" r="1.7" fill="currentColor"/>
                        <circle cx="12" cy="12" r="1.7" fill="currentColor"/>
                        <circle cx="19" cy="12" r="1.7" fill="currentColor"/>
                      </svg>
                    </button>
                    <div v-if="openSessionMenuId === session.id" :id="'resume-menu-' + session.id" class="resume-popover" role="menu">
                      <button type="button" role="menuitem" @click="requestSessionRemoval(session)">Elimina visita</button>
                    </div>
                  </div>
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

          <p v-if="!visits.length" class="library-empty">
            Non possiedi ancora visite per questo museo.
          </p>
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
      </template>
    </section>

    <div v-if="pendingRemoval" class="removal-overlay" @click.self="closeRemovalConfirm">
      <section class="removal-dialog" role="alertdialog" aria-modal="true" aria-labelledby="removal-title">
        <p class="eyebrow">Rimuovi dalle visite da riprendere</p>
        <h2 id="removal-title">Eliminare “{{ pendingRemoval.title }}”?</h2>
        <p>
          Verrà rimossa soltanto questa sessione interrotta. La visita resterà disponibile
          nella sezione “Le mie visite” e potrai iniziarla di nuovo.
        </p>
        <div>
          <button type="button" :disabled="Boolean(removingSessionId)" @click="closeRemovalConfirm">Annulla</button>
          <button class="confirm-removal" type="button" :disabled="Boolean(removingSessionId)" @click="confirmSessionRemoval">
            {{ removingSessionId ? "Rimozione…" : "Elimina visita" }}
          </button>
        </div>
      </section>
    </div>
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
.resume-menu { position: relative; }
.resume-menu-trigger {
  width: 44px;
  height: 44px;
  padding: 0;
  display: grid;
  place-items: center;
  border-color: color-mix(in srgb, var(--navigator-on-primary) 45%, transparent);
  color: var(--navigator-on-primary);
  background: color-mix(in srgb, var(--navigator-on-primary) 10%, transparent);
}
.resume-popover {
  position: absolute;
  z-index: 12;
  right: 0;
  top: calc(100% + .45rem);
  min-width: 12rem;
  padding: .35rem;
  border: 1px solid var(--navigator-border);
  border-radius: .8rem;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
  box-shadow: 0 14px 34px var(--navigator-shadow);
}
.resume-popover button {
  width: 100%;
  border: 0;
  color: #b33138;
  background: transparent;
  font-weight: 750;
  text-align: left;
}
.resume-popover button:hover { background: color-mix(in srgb, #b33138 9%, transparent); }
.session-action-error {
  margin: -.35rem 0 .8rem;
  padding: .7rem .8rem;
  border: 1px solid color-mix(in srgb, #b33138 45%, var(--navigator-border));
  border-radius: .75rem;
  color: #b33138;
  background: color-mix(in srgb, #b33138 7%, var(--navigator-surface-raised));
}

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
.library-state,
.library-empty { padding: 1.5rem; border: 1px solid var(--navigator-border); border-radius: 1rem; background: var(--navigator-surface-raised); }
.error-state { color: #b33138; }

.removal-overlay {
  position: fixed;
  z-index: 60;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: rgba(7, 12, 11, .58);
}
.removal-dialog {
  width: min(100%, 31rem);
  padding: clamp(1.25rem, 4vw, 2rem);
  border: 1px solid var(--navigator-border);
  border-radius: 1.3rem;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
  box-shadow: 0 22px 60px rgba(0, 0, 0, .32);
}
.removal-dialog h2 {
  margin: .25rem 0 .8rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.65rem, 5vw, 2.2rem);
  font-weight: 500;
}
.removal-dialog > p:not(.eyebrow) { color: var(--navigator-muted); line-height: 1.55; }
.removal-dialog > div {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: .65rem;
  margin-top: 1.25rem;
}
.confirm-removal {
  border-color: #a72e36;
  color: #fff;
  background: #a72e36;
  font-weight: 760;
}

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
