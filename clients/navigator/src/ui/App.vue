<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore, useConfiguredVenueStore, useRuntimeStore } from "../application/stores";
import { authRepository } from "../infrastructure/http/authRepository";

type NavigatorTheme = "light" | "dark";
const THEME_STORAGE_KEY = "artaround.navigator.theme";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const runtimeStore = useRuntimeStore();
const configuredVenueStore = useConfiguredVenueStore();
const { config, platformConfig, selectedVenueId } = storeToRefs(configuredVenueStore);
const { authenticated, user } = storeToRefs(authStore);
const immersive = computed(() => Boolean(route.meta.immersive));
const theme = ref<NavigatorTheme>("light");
const themeActionLabel = computed(() => theme.value === "dark" ? "Tema chiaro" : "Tema scuro");
const branding = computed(() => config.value?.branding || platformConfig.value?.branding || null);

function applyTheme(value: NavigatorTheme, persist = false) {
  theme.value = value;
  document.documentElement.dataset.navigatorTheme = value;
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, value);
}

function toggleTheme() {
  applyTheme(theme.value === "dark" ? "light" : "dark", true);
}

onMounted(() => {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  const initial = stored === "light" || stored === "dark"
    ? stored
    : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(initial);
});

const brandHome = computed(() => {
  if (!authenticated.value) return { name: "home" };
  return selectedVenueId.value
    ? { name: "museum-library", params: { venueId: selectedVenueId.value } }
    : { name: "museums" };
});
const marketplaceHref = computed(() =>
  selectedVenueId.value
    ? `/marketplace/catalog?selectedVenueIds=${encodeURIComponent(selectedVenueId.value)}`
    : "/marketplace/catalog"
);

async function logout() {
  await authRepository.logout().catch(() => {});
  authStore.clear();
  runtimeStore.clear();
  configuredVenueStore.resetCatalog();
  await router.replace("/");
}
</script>

<template>
  <div class="app-shell" :class="{ 'app-shell--immersive': immersive }">
    <header v-if="!immersive" class="navigator-header">
      <RouterLink class="brand-lockup" :to="brandHome" aria-label="Home Navigator">
        <img
          v-if="branding?.logo"
          class="brand-logo"
          :src="branding.logo.src"
          alt=""
          width="44"
          height="44"
        >
        <span class="brand-copy">
          <strong>{{ branding?.productTitle || "ArtAround" }}</strong>
          <small>{{ branding?.museumTitle }}</small>
        </span>
      </RouterLink>

      <nav v-if="authenticated" aria-label="Navigazione principale">
        <RouterLink :to="{ name: 'together-join' }">Entra in una visita</RouterLink>
        <RouterLink v-if="selectedVenueId" :to="{ name: 'museums' }">Cambia museo</RouterLink>
        <RouterLink
          v-if="selectedVenueId"
          :to="{ name: 'museum-library', params: { venueId: selectedVenueId } }"
        >Le mie visite</RouterLink>
        <a v-if="selectedVenueId" :href="marketplaceHref">Marketplace</a>
        <RouterLink
          v-if="selectedVenueId"
          :to="{ name: 'museum-generate', params: { venueId: selectedVenueId } }"
        >Genera</RouterLink>
        <a v-else href="/marketplace/catalog">Marketplace</a>
        <span class="signed-user">{{ user?.username }}</span>
        <button class="text-button" type="button" @click="logout">Esci</button>
      </nav>
    </header>
    <RouterView />
    <button
      v-if="!immersive"
      class="theme-toggle"
      type="button"
      :aria-label="'Passa a ' + themeActionLabel.toLowerCase()"
      :title="themeActionLabel"
      @click="toggleTheme"
    >
      <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/>
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <svg v-else viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <path d="M20.2 15.2A8.4 8.4 0 0 1 8.8 3.8 8.5 8.5 0 1 0 20.2 15.2Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      </svg>
      <span>{{ themeActionLabel }}</span>
    </button>
  </div>
</template>
