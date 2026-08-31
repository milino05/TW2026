<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { useAuthStore, useConfiguredVenueStore } from "../application/stores";
import { authRepository } from "../infrastructure/http/authRepository";
import FeedbackCallout from "./FeedbackCallout.vue";

const router = useRouter();
const authStore = useAuthStore();
const configuredVenueStore = useConfiguredVenueStore();
const { platformConfig } = storeToRefs(configuredVenueStore);
const username = ref("");
const password = ref("");
const busy = ref(false);
const error = ref<string | null>(null);
const mode = ref<"login" | "register">("login");

const isRegistering = computed(() => mode.value === "register");

function switchMode() {
  mode.value = isRegistering.value ? "login" : "register";
  error.value = null;
}

async function submit() {
  busy.value = true;
  error.value = null;
  try {
    const response = isRegistering.value
      ? await authRepository.register(username.value, password.value)
      : await authRepository.login(username.value, password.value);
    authStore.setUser(response.user);
    await router.replace({ name: "museums" });
  } catch (cause) {
    error.value = cause instanceof Error
      ? cause.message
      : isRegistering.value
        ? "Registrazione non riuscita"
        : "Accesso non riuscito";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="login-page">
    <figure v-if="platformConfig?.branding.heroImage" class="login-hero">
      <img :src="platformConfig.branding.heroImage.src" :alt="platformConfig.branding.heroImage.alt">
    </figure>
    <section class="login-panel" aria-labelledby="auth-title">
      <p class="eyebrow">{{ platformConfig?.branding.museumTitle }}</p>
      <h1 id="auth-title">{{ isRegistering ? "Crea il tuo account" : "Inizia la tua visita" }}</h1>
      <p class="login-subtitle">
        {{ isRegistering
          ? "Scegli username e password. Potrai usare le stesse credenziali nei prossimi accessi."
          : platformConfig?.branding.subtitle }}
      </p>
      <form @submit.prevent="submit">
        <label>
          Username
          <input v-model="username" autocomplete="username" required>
        </label>
        <label>
          Password
          <input
            v-model="password"
            type="password"
            :autocomplete="isRegistering ? 'new-password' : 'current-password'"
            minlength="8"
            maxlength="128"
            required
          >
        </label>
        <button class="login-submit" type="submit" :disabled="busy">
          {{ busy ? (isRegistering ? "Creazione account…" : "Accesso…") : (isRegistering ? "Registrati" : "Accedi") }}
        </button>
      </form>
      <FeedbackCallout v-if="error" tone="danger" semantic-role="alert">{{ error }}</FeedbackCallout>
      <div class="auth-switch">
        <span>{{ isRegistering ? "Hai già un account?" : "Non hai ancora un account?" }}</span>
        <button type="button" class="auth-switch-button" :disabled="busy" @click="switchMode">
          {{ isRegistering ? "Accedi" : "Registrati" }}
        </button>
      </div>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  width: min(100% - 2rem, 68rem);
  min-height: calc(100vh - 76px);
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(19rem, .75fr);
  align-items: stretch;
  gap: clamp(1rem, 4vw, 3rem);
  margin: 0 auto;
  padding: clamp(1rem, 4vw, 3rem) 0;
}

.login-hero {
  min-height: 31rem;
  margin: 0;
  overflow: hidden;
  border-radius: 1.5rem;
  background: var(--navigator-surface-raised);
  box-shadow: 0 20px 46px var(--navigator-shadow);
}

.login-hero img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.login-panel {
  align-self: center;
  padding: clamp(1.25rem, 4vw, 2rem);
  border: 1px solid var(--navigator-border);
  border-radius: 1.35rem;
  background: var(--navigator-surface-raised);
  box-shadow: 0 16px 40px var(--navigator-shadow);
}

.login-panel h1 {
  margin: .35rem 0 .5rem;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(2rem, 5vw, 2.75rem);
  line-height: 1.05;
}

.login-subtitle {
  margin: 0 0 1.5rem;
  color: var(--navigator-muted);
}

.login-panel form,
.login-panel label {
  display: grid;
  gap: .45rem;
}

.login-panel form { gap: 1rem; }

.login-panel input {
  min-height: 48px;
  padding: .7rem .8rem;
  border: 1px solid var(--navigator-border);
  border-radius: .75rem;
  background: var(--navigator-surface);
}

.login-submit {
  border-color: var(--navigator-brand-primary);
  color: var(--navigator-on-primary);
  background: var(--navigator-brand-primary);
  font-weight: 780;
}

.auth-switch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: .45rem;
  margin-top: 1rem;
  color: var(--navigator-muted);
  font-size: .92rem;
}

.auth-switch-button {
  min-height: auto;
  padding: .25rem .4rem;
  border: 0;
  background: transparent;
  color: var(--navigator-brand-primary);
  font-weight: 780;
  text-decoration: underline;
  text-underline-offset: .18em;
}

@media (max-width: 760px) {
  .login-page { grid-template-columns: 1fr; }

  .login-hero {
    min-height: 14rem;
    max-height: 35vh;
  }
}
</style>
