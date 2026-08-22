<script setup lang="ts">
import { RouterLink, RouterView } from "vue-router";
import { storeToRefs } from "pinia";
import { useConfiguredVenueStore } from "../application/stores";

const configuredVenueStore = useConfiguredVenueStore();
const { config } = storeToRefs(configuredVenueStore);
</script>

<template>
  <div class="app-shell">
    <header>
      <strong>{{ config?.branding.title || "ArtAround" }}</strong>
      <nav aria-label="Navigazione principale">
        <RouterLink to="/library">Library</RouterLink>
        <RouterLink to="/generate">Genera</RouterLink>
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
.app-shell > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem;
  border-bottom: 1px solid currentColor;
}
.app-shell nav {
  display: flex;
  gap: 1rem;
}
</style>
