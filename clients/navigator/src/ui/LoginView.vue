<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "../application/stores";
import { authRepository } from "../infrastructure/http/authRepository";

const router = useRouter();
const authStore = useAuthStore();
const username = ref("");
const password = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

async function submit() {
  busy.value = true;
  error.value = null;
  try {
    const response = await authRepository.login(username.value, password.value);
    authStore.setUser(response.user);
    await router.replace("/library");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Accesso non riuscito";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="page narrow">
    <h1>Accedi</h1>
    <form @submit.prevent="submit">
      <label>
        Username
        <input v-model="username" autocomplete="username" required>
      </label>
      <label>
        Password
        <input v-model="password" type="password" autocomplete="current-password" required>
      </label>
      <button type="submit" :disabled="busy">{{ busy ? "Accesso…" : "Accedi" }}</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
  </main>
</template>
