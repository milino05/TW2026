<script setup lang="ts">
import { ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { synchronizedVisitRepository } from "../infrastructure/http/synchronizedVisitRepository";

const router = useRouter();
const joinAlias = ref("");
const busy = ref(false);
const error = ref<string | null>(null);

async function join() {
  if (!joinAlias.value.trim() || busy.value) return;
  busy.value = true;
  error.value = null;
  try {
    const projection = await synchronizedVisitRepository.join(joinAlias.value);
    await router.push({
      name: "together-session",
      params: { synchronizedSessionId: projection.synchronizedSession.id },
    });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Non riesco a trovare questa visita";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="join-page">
    <section class="join-card">
      <div class="join-symbol" aria-hidden="true">✦</div>
      <p class="eyebrow">Visita insieme</p>
      <h1>Entra nella visita</h1>
      <p>Scrivi le parole mostrate dalla guida. Non servono codici o numeri.</p>
      <form @submit.prevent="join">
        <label for="join-alias">Nome della visita</label>
        <input
          id="join-alias"
          v-model="joinAlias"
          autocomplete="off"
          maxlength="80"
          placeholder="Per esempio: Fenice rossa"
          autofocus
        >
        <p v-if="error" class="join-error" role="alert">{{ error }}</p>
        <button type="submit" :disabled="busy || !joinAlias.trim()">
          {{ busy ? "Sto entrando…" : "Entra" }}
        </button>
      </form>
      <RouterLink :to="{ name: 'museums' }">Torna alle tue visite</RouterLink>
    </section>
  </main>
</template>

<style scoped>
.join-page{min-height:calc(100vh - 5rem);display:grid;place-items:center;padding:1rem}.join-card{width:min(100%,34rem);display:grid;justify-items:center;gap:.75rem;padding:clamp(1.4rem,5vw,3rem);border:1px solid var(--navigator-border);border-radius:1.6rem;background:var(--navigator-surface-raised);box-shadow:0 18px 48px var(--navigator-shadow);text-align:center}.join-symbol{display:grid;place-items:center;width:4rem;height:4rem;border-radius:1.2rem;background:var(--navigator-brand-primary);color:#fff;font-size:1.8rem}.join-card h1,.join-card p{margin:0}.join-card>p:not(.eyebrow){max-width:27rem;color:var(--navigator-muted);font-size:1.05rem;line-height:1.55}.join-card form{width:100%;display:grid;gap:.65rem;margin-top:.8rem;text-align:left}.join-card label{font-weight:800}.join-card input{width:100%;min-height:3.6rem;padding:.8rem 1rem;border:2px solid var(--navigator-border);border-radius:.9rem;background:var(--navigator-surface);color:var(--navigator-text);font:inherit;font-size:1.1rem}.join-card input:focus{outline:3px solid color-mix(in srgb,var(--navigator-brand-primary) 24%,transparent);border-color:var(--navigator-brand-primary)}.join-card button{min-height:3.5rem;border:0;border-radius:.9rem;background:var(--navigator-brand-primary);color:#fff;font:inherit;font-weight:850;font-size:1.05rem}.join-card a{color:var(--navigator-brand-primary);font-weight:750}.join-error{padding:.65rem;border-radius:.65rem;background:#fbe9e8;color:#9f2f36;text-align:left}
</style>
