<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { notify, type FeedbackTone } from "../application/uiFeedback";
import FeedbackActionDialog from "./FeedbackActionDialog.vue";

type DialogBridge = {
  overlay: HTMLElement;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmSelector: string;
  cancelSelector: string;
};

type NoticeMapping = {
  surface: "toast" | "callout";
  tone: FeedbackTone;
};

const dialogBridge = ref<DialogBridge | null>(null);
const lastNodeText = new WeakMap<Element, string>();
let observer: MutationObserver | null = null;
let scanQueued = false;

function text(element: Element | null) {
  return String(element?.textContent || "").replace(/\s+/g, " ").trim();
}

function toneAttribute(element: Element, tone: FeedbackTone) {
  element.setAttribute("data-artaround-feedback-tone", tone);
}

function markSurface(element: Element, surface: "callout" | "issue-panel", tone: FeedbackTone) {
  element.setAttribute("data-artaround-feedback-surface", surface);
  toneAttribute(element, tone);
}

function sessionNoticeMapping(message: string): NoticeMapping {
  if (/^Percorso verso\b/i.test(message)) return { surface: "toast", tone: "info" };
  if (/^Visita completata\.?$/i.test(message)) return { surface: "toast", tone: "success" };
  if (/^Ascolto annullato\.?$/i.test(message)) return { surface: "toast", tone: "info" };
  if (/^Comando riconosciuto:/i.test(message)) return { surface: "toast", tone: "info" };
  if (/^(Comando non disponibile|Nessun comando riconosciuto)/i.test(message)) return { surface: "toast", tone: "warning" };
  if (/Sintesi vocale non supportata|non supporta il riconoscimento vocale/i.test(message)) return { surface: "callout", tone: "warning" };
  /* Obstacle checks and other unrecognized session notices describe the current
   * route/context, so the safe default is persistent contextual warning. */
  return { surface: "callout", tone: "warning" };
}

function consumeSessionNotice(element: Element) {
  const message = text(element);
  if (!message) return;
  const mapping = sessionNoticeMapping(message);
  const previous = lastNodeText.get(element);
  lastNodeText.set(element, message);

  if (mapping.surface === "toast") {
    if (previous !== message) notify[mapping.tone](message);
    if (element instanceof HTMLElement) element.hidden = true;
    element.setAttribute("data-artaround-feedback-consumed", "toast");
    return;
  }

  if (element instanceof HTMLElement) element.hidden = false;
  markSurface(element, "callout", mapping.tone);
}

function bridgeDialog(root: ParentNode, {
  dialogSelector,
  overlaySelector,
  confirmSelector,
  cancelSelector = "button",
}: {
  dialogSelector: string;
  overlaySelector: string;
  confirmSelector: string;
  cancelSelector?: string;
}) {
  const legacy = root.querySelector?.(dialogSelector);
  if (!(legacy instanceof HTMLElement)) return;
  const overlay = legacy.closest(overlaySelector);
  if (!(overlay instanceof HTMLElement) || overlay.dataset.artaroundFeedbackDialogBridged === "true") return;

  overlay.dataset.artaroundFeedbackDialogBridged = "true";
  overlay.hidden = true;
  const buttons = [...legacy.querySelectorAll<HTMLButtonElement>("button")];
  dialogBridge.value = {
    overlay,
    title: text(legacy.querySelector("h2")) || "Conferma azione",
    message: text(legacy.querySelector("h2")?.nextElementSibling ?? null),
    cancelLabel: text(legacy.querySelector(cancelSelector)) || text(buttons[0] ?? null) || "Annulla",
    confirmLabel: text(legacy.querySelector(confirmSelector)) || text(buttons.at(-1) ?? null) || "Conferma",
    confirmSelector,
    cancelSelector,
  };
}

function bridgeKnownDialogs(root: ParentNode) {
  if (dialogBridge.value) return;
  bridgeDialog(root, {
    dialogSelector: '.confirm-sheet[role="alertdialog"]',
    overlaySelector: ".modal-overlay",
    confirmSelector: ".confirm-completion",
  });
  if (dialogBridge.value) return;
  bridgeDialog(root, {
    dialogSelector: '.removal-dialog[role="alertdialog"]',
    overlaySelector: ".removal-overlay",
    confirmSelector: ".confirm-removal",
  });
}

function scan(root: ParentNode = document) {
  for (const notice of root.querySelectorAll?.('.session-feedback[role="status"]') || []) consumeSessionNotice(notice);

  for (const error of root.querySelectorAll?.('.session-feedback.error-feedback[role="alert"], .error-card[role="alert"], .previsit-state.error-state[role="alert"], .inline-error[role="alert"], .library-state.error-state[role="alert"], .session-action-error[role="alert"]') || []) {
    markSurface(error, "callout", "danger");
  }

  for (const capability of root.querySelectorAll?.(".capability-note") || []) markSurface(capability, "callout", "warning");
  for (const warning of root.querySelectorAll?.('.semantic-notice[role="status"], .session-map > p[role="status"]') || []) markSurface(warning, "callout", "warning");
  for (const warningList of root.querySelectorAll?.(".warning-list, .session-map > ul") || []) markSurface(warningList, "issue-panel", "warning");
  for (const blockerList of root.querySelectorAll?.('.blocker-list[role="alert"]') || []) markSurface(blockerList, "issue-panel", "danger");

  bridgeKnownDialogs(root);
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    scan(document);
  });
}

function resolveDialog(confirmed: boolean) {
  const bridge = dialogBridge.value;
  if (!bridge) return;
  dialogBridge.value = null;
  const legacy = bridge.overlay.querySelector<HTMLElement>(confirmed ? bridge.confirmSelector : bridge.cancelSelector);
  legacy?.click();
}

onMounted(() => {
  scan(document);
  observer = new MutationObserver(queueScan);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <FeedbackActionDialog
    :open="Boolean(dialogBridge)"
    tone="danger"
    :title="dialogBridge?.title || 'Conferma azione'"
    :message="dialogBridge?.message || ''"
    :confirm-label="dialogBridge?.confirmLabel || 'Conferma'"
    :cancel-label="dialogBridge?.cancelLabel || 'Annulla'"
    @confirm="resolveDialog(true)"
    @cancel="resolveDialog(false)"
  />
</template>