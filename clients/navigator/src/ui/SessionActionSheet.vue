<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import type { SessionActionGroups } from "../domain/sessionPresentation";
import type { AvailableAction } from "../infrastructure/http/sessionRepository";

const props = defineProps<{
  open: boolean;
  groups: SessionActionGroups;
  busyActionId: string | null;
  interactionBusy: boolean;
}>();

const emit = defineEmits<{
  close: [];
  select: [action: AvailableAction];
}>();

const closeButton = ref<HTMLButtonElement | null>(null);
const dismissedChoiceSignature = ref("");
const semanticChoices = computed(() => props.groups.semantic.filter((action) => action.semanticChoice === true));
const semanticChoiceSignature = computed(() => semanticChoices.value
  .map((action) => `${action.actionId}@${action.semanticChoiceRequestVersion ?? ""}`)
  .join("|"));
const autoChoiceOpen = computed(() => Boolean(
  semanticChoices.value.length
  && semanticChoiceSignature.value !== dismissedChoiceSignature.value,
));
const visible = computed(() => props.open || autoChoiceOpen.value);
const choiceMode = computed(() => autoChoiceOpen.value && !props.open);
const sections = computed(() => {
  if (choiceMode.value) return [{ key: "semantic-choice", title: "Scegli un approfondimento", actions: semanticChoices.value }];
  return [
    { key: "presentation", title: "Adatta il contenuto", actions: props.groups.presentation },
    { key: "semantic", title: "Approfondisci", actions: props.groups.semantic },
    { key: "navigation", title: "Muoviti nel museo", actions: props.groups.navigation },
    { key: "lifecycle", title: "Sessione", actions: props.groups.lifecycle },
    { key: "other", title: "Altre azioni", actions: props.groups.other },
  ].filter((section) => section.actions.length);
});
const title = computed(() => choiceMode.value ? "Quale approfondimento vuoi aprire?" : "Cosa vuoi fare?");

watch(visible, async (open) => {
  if (!open) return;
  await nextTick();
  closeButton.value?.focus();
});
watch(semanticChoiceSignature, (signature, previous) => {
  if (signature && signature !== previous) dismissedChoiceSignature.value = "";
});

function closeSheet() {
  if (choiceMode.value) dismissedChoiceSignature.value = semanticChoiceSignature.value;
  emit("close");
}
</script>

<template>
  <div v-if="visible" class="action-overlay" @click.self="closeSheet" @keydown.esc.stop.prevent="closeSheet">
    <section
      class="action-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-actions-title"
    >
      <div class="sheet-grip" aria-hidden="true"></div>
      <header>
        <div>
          <h2 id="session-actions-title">{{ title }}</h2>
          <p v-if="choiceMode" class="sheet-intro">Più contenuti sono pertinenti alla relazione richiesta. Scegli quello che vuoi ascoltare.</p>
        </div>
        <button ref="closeButton" class="close-button" type="button" aria-label="Chiudi azioni" @click="closeSheet">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </header>

      <div v-for="section in sections" :key="section.key" class="action-section">
        <h3>{{ section.title }}</h3>
        <div class="action-grid">
          <button
            v-for="action in section.actions"
            :key="action.actionId"
            type="button"
            class="sheet-action"
            :class="{ danger: action.type === 'COMPLETE' }"
            :disabled="interactionBusy"
            @click="emit('select', action)"
          >
            <span>{{ action.label }}</span>
            <span v-if="busyActionId === action.actionId" class="busy-mark" aria-label="Operazione in corso">…</span>
          </button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.action-overlay {
  position: fixed;
  z-index: 30;
  inset: 0;
  display: grid;
  align-items: end;
  justify-items: center;
  padding-top: 4rem;
  background: rgba(7, 12, 11, .5);
}

.action-sheet {
  width: min(100%, 38rem);
  max-height: min(78dvh, 46rem);
  overflow-y: auto;
  padding: .7rem 1.25rem max(1.5rem, env(safe-area-inset-bottom));
  border: 1px solid var(--navigator-border);
  border-bottom: 0;
  border-radius: 1.6rem 1.6rem 0 0;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
  box-shadow: 0 -20px 56px rgba(0, 0, 0, .28);
}

.sheet-grip {
  width: 3rem;
  height: .3rem;
  margin: 0 auto .75rem;
  border-radius: 999px;
  background: var(--navigator-border);
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

header > div {
  min-width: 0;
}

h2 {
  margin: 0;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.6rem, 6vw, 2rem);
  font-weight: 500;
}

.sheet-intro {
  margin: .4rem 0 0;
  color: var(--navigator-muted);
  font-size: .82rem;
  line-height: 1.45;
}

.close-button {
  width: 44px;
  min-width: 44px;
  padding: 0;
  display: grid;
  place-items: center;
  border: 0;
  background: transparent;
}

.action-section h3 {
  margin: 1.35rem 0 .55rem;
  color: var(--navigator-muted);
  font-family: inherit;
  font-size: .7rem;
  font-weight: 780;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .55rem;
}

.sheet-action {
  min-height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: .5rem;
  padding: .75rem;
  text-align: left;
  font-size: .87rem;
  font-weight: 720;
}

.sheet-action:hover {
  border-color: color-mix(in srgb, var(--navigator-primary) 44%, var(--navigator-border));
}

.sheet-action.danger {
  color: #b33138;
}

.busy-mark {
  color: var(--navigator-primary);
  font-size: 1.15rem;
}

@media (max-width: 420px) {
  .action-sheet { max-height: 82dvh; }
  .action-grid { grid-template-columns: 1fr; }
}
</style>