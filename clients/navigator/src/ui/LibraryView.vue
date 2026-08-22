<script setup lang="ts">
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useConfiguredVenueStore } from "../application/stores";
import { navigatorVisitRepository, type LibraryVisit } from "../infrastructure/http/navigatorVisitRepository";

const configuredVenueStore = useConfiguredVenueStore();
const visits = ref<LibraryVisit[]>([]);
const busy = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const response = await navigatorVisitRepository.library(configuredVenueStore.config?.venueId);
    visits.value = response.visits;
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
    <p v-else-if="!visits.length">Nessuna visita disponibile per la sede configurata.</p>
    <ul v-else class="cards">
      <li v-for="visit in visits" :key="visit.id">
        <article>
          <h2><RouterLink :to="`/visits/${visit.id}`">{{ visit.title }}</RouterLink></h2>
          <p>{{ visit.summary }}</p>
          <p>{{ visit.stopCount }} tappe · {{ visit.physicalScope.map((venue) => venue.name).join(" · ") }}</p>
        </article>
      </li>
    </ul>
  </main>
</template>
