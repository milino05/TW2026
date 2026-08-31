<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { FeedbackTone } from "../application/uiFeedback";

const props = withDefaults(defineProps<{
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: FeedbackTone;
  dismissible?: boolean;
}>(), {
  message: "",
  confirmLabel: "Conferma",
  cancelLabel: "Annulla",
  tone: "neutral",
  dismissible: true,
});

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const panel = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;

function focusables() {
  if (!panel.value) return [] as HTMLElement[];
  return [...panel.value.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
}

function cancel() {
  if (props.dismissible) emit("cancel");
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && props.dismissible) {
    event.preventDefault();
    emit("cancel");
    return;
  }
  if (event.key !== "Tab") return;
  const nodes = focusables();
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

watch(() => props.open, async (open) => {
  if (open) {
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.documentElement.classList.add("artaround-dialog-open");
    document.body.classList.add("artaround-dialog-open");
    await nextTick();
    panel.value?.querySelector<HTMLButtonElement>('[data-feedback-dialog-cancel]')?.focus({ preventScroll: true });
  } else {
    document.documentElement.classList.remove("artaround-dialog-open");
    document.body.classList.remove("artaround-dialog-open");
    returnFocus?.focus?.({ preventScroll: true });
    returnFocus = null;
  }
}, { immediate: true });

onBeforeUnmount(() => {
  document.documentElement.classList.remove("artaround-dialog-open");
  document.body.classList.remove("artaround-dialog-open");
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="feedback-dialog-layer" :data-tone="tone" @keydown="onKeydown">
      <div class="feedback-dialog-backdrop" @click="cancel"></div>
      <section
        ref="panel"
        class="feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
      >
        <header>
          <span class="feedback-dialog__icon" aria-hidden="true">{{ tone === "danger" || tone === "warning" ? "!" : tone === "success" ? "✓" : "i" }}</span>
          <div>
            <h2 id="feedback-dialog-title">{{ title }}</h2>
            <p v-if="message">{{ message }}</p>
          </div>
        </header>
        <div class="feedback-dialog__actions">
          <button data-feedback-dialog-cancel type="button" @click="emit('cancel')">{{ cancelLabel }}</button>
          <button type="button" :class="{ danger: tone === 'danger' }" @click="emit('confirm')">{{ confirmLabel }}</button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.feedback-dialog-layer {
  position: fixed;
  z-index: var(--artaround-layer-dialog, 2147483200);
  inset: 0;
  display: grid;
  place-items: center;
  padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
}

.feedback-dialog-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(7, 12, 11, .62);
  backdrop-filter: blur(3px);
}

.feedback-dialog {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 1.15rem;
  width: min(34rem, 100%);
  max-height: calc(100dvh - 2rem);
  overflow: auto;
  padding: 1.25rem;
  border: 1px solid var(--navigator-border);
  border-radius: 1.1rem;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
  box-shadow: 0 24px 64px rgba(0, 0, 0, .32);
}

.feedback-dialog header {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: .8rem;
}
.feedback-dialog h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; }
.feedback-dialog p { margin: .4rem 0 0; color: var(--navigator-muted); line-height: 1.5; }
.feedback-dialog__icon {
  display: grid;
  place-items: center;
  width: 2.35rem;
  height: 2.35rem;
  border-radius: 999px;
  color: var(--navigator-surface-raised);
  background: var(--navigator-primary);
  font-weight: 900;
}
.feedback-dialog-layer[data-tone="warning"] .feedback-dialog__icon { background: #9a681d; }
.feedback-dialog-layer[data-tone="danger"] .feedback-dialog__icon { background: #b33e45; }
.feedback-dialog-layer[data-tone="success"] .feedback-dialog__icon { background: #36785c; }
.feedback-dialog__actions { display: flex; justify-content: flex-end; gap: .65rem; flex-wrap: wrap; }
.feedback-dialog__actions .danger { border-color: #b33e45; color: white; background: #b33e45; }

@media (max-width: 520px) {
  .feedback-dialog__actions { flex-direction: column-reverse; }
  .feedback-dialog__actions button { width: 100%; }
}
</style>
