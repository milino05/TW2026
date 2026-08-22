<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useConfiguredVenueStore } from "../application/stores";
import {
  navigatorVisitRepository,
  type LibraryVisit,
  type ResumableSession,
} from "../infrastructure/http/navigatorVisitRepository";

const configuredVenueStore = useConfiguredVenueStore();
const visits = ref<LibraryVisit[]>([]);
const resumableSessions = ref<ResumableSession[]>([]);
const busy = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const [library, sessions] = await Promise.all([
      navigatorVisitRepository.library(configuredVenueStore.config?.venueId),
      navigatorVisitRepository.resumableSessions(),
    ]);
    visits.value = library.visits;
    resumableSessions.value = sessions.sessions;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile caricare la Library";
  } finally {
    busy.value = false;
  }
});
</script>

<template>
  <main class="page">
    <h1>Le mie visite</h1>
    <p v-if="busy">Caricamento…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <template v-else>
      <section v-if="resumableSessions.length" aria-labelledby="resume-title">
        <h2 id="resume-title">Visite da riprendere</h2>
        <ul class="cards">
          <li v-for="session in resumableSessions" :key="session.id">
            <article>
              <h3>{{ session.title }}</h3>
              <p>Stato: {{ session.status }} · contenuto {{ session.currentEntryIndex + 1 }}</p>
              <RouterLink :to="`/sessions/${session.id}`">Riprendi</RouterLink>
            </article>
          </li>
        </ul>
      </section>

      <section aria-labelledby="library-title">
        <h2 id="library-title">Visite disponibili</h2>
        <p v-if="!visits.length">Nessuna visita disponibile per la sede configurata.</p>
        <ul v-else class="cards">
          <li v-for="visit in visits" :key="visit.id">
            <article>
              <h3><RouterLink :to="`/visits/${visit.id}`">{{ visit.title }}</RouterLink></h3>
              <p>{{ visit.summary }}</p>
              <p>Di {{ visit.owner.name }}</p>
              <p>{{ visit.stopCount }} tappe · {{ visit.physicalScope.map((venue) => venue.name).join(" · ") }}</p>
            </article>
          </li>
        </ul>
      </section>
    </template>
  </main>
</template>
