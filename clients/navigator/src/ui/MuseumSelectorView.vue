<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore, useConfiguredVenueStore } from "../application/stores";

const router = useRouter();
const authStore = useAuthStore();
const venueStore = useConfiguredVenueStore();
const { user } = storeToRefs(authStore);
const {
  museums,
  configsByVenue,
  fallbackVenueIds,
  loadingCatalog,
  error,
} = storeToRefs(venueStore);
const openingVenueId = ref<string | null>(null);
const totalVisits = computed(() => museums.value.reduce((total, museum) => total + museum.visitCount, 0));

onMounted(() => {
  void venueStore.loadMuseums().catch(() => {});
});

async function openMuseum(venueId: string) {
  if (openingVenueId.value) return;
  openingVenueId.value = venueId;
  try {
    await venueStore.selectVenue(venueId);
    await router.push({ name: "museum-library", params: { venueId } });
  } finally {
    openingVenueId.value = null;
  }
}
</script>

<template>
  <main class="museum-selector-page">
    <section class="museum-selector-intro">
      <div>
        <p class="eyebrow">Ciao, {{ user?.username }}</p>
        <h1>I tuoi musei</h1>
        <p>Scegli un museo per caricare la sua identità e vedere soltanto le visite che possiedi per quella sede.</p>
      </div>
      <p v-if="museums.length" class="museum-total">
        <strong>{{ museums.length }}</strong>
        <span>{{ museums.length === 1 ? "museo" : "musei" }} · {{ totalVisits }} visite</span>
      </p>
    </section>

    <p v-if="loadingCatalog && !museums.length" class="museum-state">Caricamento dei tuoi musei…</p>
    <p v-else-if="error && !museums.length" class="museum-state error-state" role="alert">{{ error }}</p>
    <section v-else-if="!museums.length" class="museum-empty">
      <p class="eyebrow">La tua raccolta è vuota</p>
      <h2>Non possiedi ancora visite</h2>
      <p>Acquisisci una visita dal Marketplace; il relativo museo comparirà automaticamente qui.</p>
      <a class="primary-link" href="/marketplace/catalog">Esplora il Marketplace</a>
    </section>

    <ul v-else class="museum-grid" aria-label="Musei disponibili">
      <li v-for="museum in museums" :key="museum.id">
        <button
          class="museum-card"
          type="button"
          :disabled="openingVenueId !== null"
          @click="openMuseum(museum.id)"
        >
          <span class="museum-visual">
            <img
              v-if="configsByVenue[museum.id]?.branding.heroImage"
              :src="configsByVenue[museum.id].branding.heroImage?.src"
              :alt="configsByVenue[museum.id].branding.heroImage?.alt"
            >
            <span v-else class="museum-visual-fallback" aria-hidden="true">{{ museum.name.slice(0, 1) }}</span>
          </span>
          <span class="museum-card-body">
            <span class="museum-identity">
              <img
                v-if="configsByVenue[museum.id]?.branding.logo"
                :src="configsByVenue[museum.id].branding.logo?.src"
                alt=""
                width="42"
                height="42"
              >
              <span>
                <strong>{{ configsByVenue[museum.id]?.branding.museumTitle || museum.name }}</strong>
                <small v-if="configsByVenue[museum.id]?.branding.subtitle">
                  {{ configsByVenue[museum.id].branding.subtitle }}
                </small>
              </span>
            </span>
            <span class="museum-card-meta">
              <span>
                {{ museum.visitCount }} {{ museum.visitCount === 1 ? "visita" : "visite" }}
                <template v-if="museum.resumableSessionCount">
                  · {{ museum.resumableSessionCount }} da riprendere
                </template>
              </span>
              <em>{{ openingVenueId === museum.id ? "Apertura…" : "Apri →" }}</em>
            </span>
            <small v-if="fallbackVenueIds.includes(museum.id)" class="config-fallback-note">
              Identità museale predefinita
            </small>
          </span>
        </button>
      </li>
    </ul>
  </main>
</template>

<style scoped>
.museum-selector-page {
  width: min(100%, 70rem);
  margin: 0 auto;
  padding: clamp(2rem, 5vw, 4.5rem) 1rem;
}

.museum-selector-intro {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 2rem;
  margin-bottom: 2rem;
}

.museum-selector-intro h1 {
  margin: .3rem 0 .75rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2.5rem, 7vw, 4.5rem);
  font-weight: 500;
  line-height: 1;
}

.museum-selector-intro > div > p:last-child {
  max-width: 42rem;
  margin: 0;
  color: var(--navigator-muted);
  font-size: 1.05rem;
}

.museum-total {
  min-width: 9rem;
  margin: 0;
  padding: 1rem 1.1rem;
  border-radius: 1rem;
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
}

.museum-total strong,
.museum-total span { display: block; }
.museum-total strong { font-family: Georgia, "Times New Roman", serif; font-size: 2rem; font-weight: 500; }
.museum-total span { margin-top: .2rem; font-size: .78rem; }

.museum-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.museum-card {
  width: 100%;
  min-height: 100%;
  overflow: hidden;
  padding: 0;
  display: grid;
  grid-template-rows: 14rem 1fr;
  text-align: left;
  border-radius: 1.4rem;
  background: var(--navigator-surface-raised);
  box-shadow: 0 10px 30px var(--navigator-shadow);
}

.museum-visual {
  display: block;
  overflow: hidden;
  background: color-mix(in srgb, var(--navigator-brand-primary) 12%, var(--navigator-surface));
}

.museum-visual img { width: 100%; height: 100%; display: block; object-fit: cover; }
.museum-visual-fallback {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--navigator-primary);
  font-family: Georgia, "Times New Roman", serif;
  font-size: 6rem;
}

.museum-card-body { display: grid; gap: 1rem; padding: 1.1rem; }
.museum-identity { display: flex; align-items: center; gap: .75rem; }
.museum-identity img { flex: 0 0 auto; border-radius: .65rem; }
.museum-identity > span { min-width: 0; display: grid; gap: .2rem; }
.museum-identity strong {
  font-family: Georgia, "Times New Roman", serif;
  font-size: 1.25rem;
  font-weight: 500;
}
.museum-identity small { color: var(--navigator-muted); }
.museum-card-meta { display: flex; justify-content: space-between; gap: 1rem; color: var(--navigator-muted); }
.museum-card-meta em { color: var(--navigator-primary); font-style: normal; font-weight: 750; }
.config-fallback-note { color: var(--navigator-muted); }
.museum-state,
.museum-empty {
  padding: 2rem;
  border: 1px solid var(--navigator-border);
  border-radius: 1.2rem;
  background: var(--navigator-surface-raised);
}
.museum-empty h2 { font-family: Georgia, "Times New Roman", serif; font-weight: 500; }
.primary-link {
  display: inline-flex;
  min-height: 44px;
  align-items: center;
  padding: .7rem 1rem;
  border-radius: .75rem;
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
  font-weight: 750;
  text-decoration: none;
}
.error-state { color: #b33138; }

@media (max-width: 680px) {
  .museum-selector-intro { align-items: stretch; flex-direction: column; }
  .museum-total { display: none; }
  .museum-grid { grid-template-columns: 1fr; }
  .museum-card { grid-template-rows: 11rem 1fr; }
}
</style>
