<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore, useConfiguredVenueStore, useRuntimeStore } from "../application/stores";
import { authRepository } from "../infrastructure/http/authRepository";

const router = useRouter();
const authStore = useAuthStore();
const runtimeStore = useRuntimeStore();
const configuredVenueStore = useConfiguredVenueStore();
const { config } = storeToRefs(configuredVenueStore);
const { authenticated, user } = storeToRefs(authStore);
const marketplaceHref = computed(() => {
  const venueId = config.value?.venueId;
  return venueId ? `/marketplace/catalog?selectedVenueIds=${encodeURIComponent(venueId)}` : "/marketplace/catalog";
});

async function logout() {
  await authRepository.logout().catch(() => {});
  authStore.clear();
  runtimeStore.clear();
  await router.replace("/");
}
</script>

<template>
  <div class="app-shell">
    <header>
      <strong>{{ config?.branding.title || "ArtAround" }}</strong>
      <nav v-if="authenticated" aria-label="Navigazione principale">
        <RouterLink to="/library">Library</RouterLink>
        <a :href="marketplaceHref">Marketplace</a>
        <RouterLink to="/generate">Genera</RouterLink>
        <span>{{ user?.username }}</span>
        <button type="button" @click="logout">Esci</button>
      </nav>
    </header>
    <RouterView />
  </div>
</template>

<style>
:root {
  font-family: system-ui, sans-serif;
  color-scheme: light dark;
}
body {
  margin: 0;
}
button,
input {
  font: inherit;
}
button {
  padding: .6rem .9rem;
}
.app-shell > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid currentColor;
}
.app-shell nav,
.session-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
.page {
  max-width: 52rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}
.narrow {
  max-width: 28rem;
}
.page form {
  display: grid;
  gap: 1rem;
}
.page label {
  display: grid;
  gap: .35rem;
}
.cards {
  list-style: none;
  padding: 0;
}
.cards li {
  padding: 1rem 0;
  border-bottom: 1px solid currentColor;
}
.presentation-text {
  font-size: 1.25rem;
  line-height: 1.6;
}
.eyebrow {
  opacity: .7;
}
</style>
