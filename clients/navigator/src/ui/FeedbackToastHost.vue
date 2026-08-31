<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  UI_NOTIFICATION_DISMISS_EVENT,
  UI_NOTIFICATION_EVENT,
  type FeedbackTone,
  type NotificationDetail,
} from "../application/uiFeedback";

type VisibleNotification = NotificationDetail & { state: "visible" | "exiting" };

const notifications = ref<VisibleNotification[]>([]);
const timers = new Map<string, number>();

function dismiss(id: string) {
  const current = notifications.value.find((entry) => entry.id === id);
  if (!current || current.state === "exiting") return;
  const timer = timers.get(id);
  if (timer) window.clearTimeout(timer);
  timers.delete(id);
  current.state = "exiting";
  window.setTimeout(() => {
    notifications.value = notifications.value.filter((entry) => entry.id !== id);
  }, 180);
}

function onNotification(event: Event) {
  const detail = (event as CustomEvent<NotificationDetail>).detail;
  if (!detail?.id || !detail.message) return;
  const existing = notifications.value.findIndex((entry) => entry.id === detail.id);
  if (existing >= 0) notifications.value.splice(existing, 1);
  notifications.value.push({ ...detail, state: "visible" });

  if (detail.duration > 0) {
    const previous = timers.get(detail.id);
    if (previous) window.clearTimeout(previous);
    timers.set(detail.id, window.setTimeout(() => dismiss(detail.id), detail.duration));
  }
}

function onExternalDismiss(event: Event) {
  dismiss(String((event as CustomEvent<{ id?: string }>).detail?.id || ""));
}

function iconFor(tone: FeedbackTone) {
  if (tone === "success") return "✓";
  if (tone === "warning" || tone === "danger") return "!";
  return "i";
}

onMounted(() => {
  window.addEventListener(UI_NOTIFICATION_EVENT, onNotification);
  window.addEventListener(UI_NOTIFICATION_DISMISS_EVENT, onExternalDismiss);
});

onBeforeUnmount(() => {
  window.removeEventListener(UI_NOTIFICATION_EVENT, onNotification);
  window.removeEventListener(UI_NOTIFICATION_DISMISS_EVENT, onExternalDismiss);
  for (const timer of timers.values()) window.clearTimeout(timer);
  timers.clear();
});
</script>

<template>
  <Teleport to="body">
    <aside class="feedback-toast-host" aria-label="Notifiche">
      <div class="feedback-toast-stack">
        <section
          v-for="entry in notifications"
          :key="entry.id"
          class="feedback-toast"
          :data-tone="entry.tone"
          :data-state="entry.state"
          :role="entry.tone === 'danger' ? 'alert' : 'status'"
          :aria-live="entry.tone === 'danger' ? 'assertive' : 'polite'"
        >
          <span class="feedback-toast__icon" aria-hidden="true">{{ iconFor(entry.tone) }}</span>
          <p>{{ entry.message }}</p>
          <button
            v-if="entry.dismissible"
            type="button"
            class="feedback-toast__dismiss"
            aria-label="Chiudi notifica"
            @click="dismiss(entry.id)"
          >×</button>
        </section>
      </div>
    </aside>
  </Teleport>
</template>

<style scoped>
.feedback-toast-host {
  position: fixed;
  z-index: var(--artaround-layer-toast, 2147483400);
  top: max(1rem, env(safe-area-inset-top));
  right: max(1rem, env(safe-area-inset-right));
  width: min(30rem, calc(100vw - 2rem));
  pointer-events: none;
}

.feedback-toast-stack {
  display: flex;
  flex-direction: column;
  gap: .6rem;
}

.feedback-toast {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: .7rem;
  width: 100%;
  padding: .82rem .88rem;
  border: 1px solid color-mix(in srgb, var(--feedback-accent, var(--navigator-border)) 36%, var(--navigator-border));
  border-left: .22rem solid var(--feedback-accent, var(--navigator-primary));
  border-radius: .9rem;
  color: var(--navigator-ink);
  background: color-mix(in srgb, var(--navigator-surface-raised) 97%, transparent);
  box-shadow: 0 18px 46px rgba(0, 0, 0, .24);
  backdrop-filter: blur(16px);
  pointer-events: auto;
  animation: feedback-toast-enter .18s ease-out both;
  transition: opacity .18s ease, transform .18s ease;
}

.feedback-toast[data-tone="info"] { --feedback-accent: #47799a; }
.feedback-toast[data-tone="success"] { --feedback-accent: #36785c; }
.feedback-toast[data-tone="warning"] { --feedback-accent: #9a681d; }
.feedback-toast[data-tone="danger"] { --feedback-accent: #b33e45; }
.feedback-toast[data-state="exiting"] { opacity: 0; transform: translateX(.8rem); }

.feedback-toast__icon {
  display: grid;
  place-items: center;
  width: 1.55rem;
  height: 1.55rem;
  border-radius: 999px;
  color: var(--navigator-surface-raised);
  background: var(--feedback-accent, var(--navigator-primary));
  font-size: .78rem;
  font-weight: 900;
}

.feedback-toast p { margin: 0; line-height: 1.45; }

.feedback-toast__dismiss {
  display: grid;
  place-items: center;
  width: 1.8rem;
  height: 1.8rem;
  min-height: 0;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--navigator-muted);
  background: transparent;
  font-size: 1.25rem;
  line-height: 1;
}

.feedback-toast__dismiss:hover,
.feedback-toast__dismiss:focus-visible {
  color: var(--navigator-ink);
  background: color-mix(in srgb, var(--navigator-primary) 9%, transparent);
}

@keyframes feedback-toast-enter {
  from { opacity: 0; transform: translateX(.8rem); }
  to { opacity: 1; transform: translateX(0); }
}

@media (max-width: 640px) {
  .feedback-toast-host {
    right: max(.65rem, env(safe-area-inset-right));
    left: max(.65rem, env(safe-area-inset-left));
    width: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .feedback-toast { animation: none; transition: none; }
}
</style>
