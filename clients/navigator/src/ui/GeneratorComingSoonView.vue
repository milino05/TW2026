<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { storeToRefs } from "pinia";
import { useConfiguredVenueStore } from "../application/stores";

const venueStore = useConfiguredVenueStore();
const { selectedVenueId } = storeToRefs(venueStore);
const returnTarget = computed(() => selectedVenueId.value
  ? { name: "museum-library", params: { venueId: selectedVenueId.value } }
  : { name: "museums" });
</script>

<template>
  <main class="generator-coming-soon">
    <section class="coming-soon-card" aria-labelledby="generator-coming-soon-title">
      <span class="coming-soon-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="42" height="42">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          <circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/>
        </svg>
      </span>
      <p class="eyebrow">Coming soon</p>
      <h1 id="generator-coming-soon-title">Il generatore di visite sta arrivando</h1>
      <p>Stiamo preparando un’esperienza più semplice per creare visite personalizzate. Questa funzione sarà disponibile prossimamente.</p>
      <RouterLink class="return-link" :to="returnTarget">Torna alle tue visite</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.generator-coming-soon {
  min-height:calc(100dvh - 5rem);
  display:grid;
  place-items:center;
  padding:clamp(1.25rem,5vw,4rem) 1rem;
}
.coming-soon-card {
  width:min(100%,38rem);
  display:grid;
  justify-items:center;
  gap:.85rem;
  padding:clamp(2rem,7vw,4.5rem);
  border:1px solid var(--navigator-border);
  border-radius:1.6rem;
  background:var(--navigator-surface-raised);
  box-shadow:0 18px 48px var(--navigator-shadow);
  text-align:center;
}
.coming-soon-mark {
  width:5rem;
  height:5rem;
  display:grid;
  place-items:center;
  margin-bottom:.35rem;
  border-radius:50%;
  color:var(--navigator-on-primary);
  background:var(--navigator-brand-primary);
}
.eyebrow {
  margin:0;
  color:var(--navigator-primary);
  font-size:.72rem;
  font-weight:850;
  letter-spacing:.1em;
  text-transform:uppercase;
}
h1 {
  margin:0;
  font-family:Georgia,"Times New Roman",serif;
  font-size:clamp(2.2rem,8vw,3.7rem);
  font-weight:500;
  line-height:1.04;
}
.coming-soon-card>p:last-of-type {
  max-width:31rem;
  margin:.2rem 0 .6rem;
  color:var(--navigator-muted);
  line-height:1.6;
}
.return-link {
  min-height:48px;
  display:inline-flex;
  align-items:center;
  justify-content:center;
  padding:.7rem 1.1rem;
  border-radius:.8rem;
  color:var(--navigator-on-primary);
  background:var(--navigator-brand-primary);
  font-weight:800;
  text-decoration:none;
}
</style>
