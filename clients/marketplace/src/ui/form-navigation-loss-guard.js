import { registerNavigationLossBlocker } from "../application/navigation-loss-guard.js";
import { openActionDialog } from "./feedback-primitives.js";

const PROTECTED_HOST_SELECTOR = [
  "artaround-profile-view",
  "artaround-organization-view",
  "artaround-venue-editor-view",
  "artaround-visit-authoring-view",
  "artaround-item-authoring-view",
  "artaround-context-release-composer",
  "artaround-commerce-management-view",
].join(",");

const dirtyForms = new Set();
const dirtyItemSelections = new Set();
const TRANSIENT_FIELD_NAME = /^(?:q|query|search|filter|sort|page|tab)$/i;

function mutableNamedControls(form) {
  return [...form.elements].filter((control) => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return false;
    if (!control.name || control.disabled) return false;
    if (control instanceof HTMLInputElement && ["hidden", "submit", "button", "reset"].includes(control.type)) return false;
    return true;
  });
}

function shouldProtect(form) {
  if (!(form instanceof HTMLFormElement) || !form.closest(PROTECTED_HOST_SELECTOR)) return false;
  if (form.matches('[role="search"], [data-search], [data-filter], [data-query]')) return false;
  const controls = mutableNamedControls(form);
  if (!controls.length) return false;
  if (controls.every((control) => TRANSIENT_FIELD_NAME.test(control.name))) return false;
  return Boolean(form.querySelector('button:not([type]), button[type="submit"], input[type="submit"]'));
}

function pruneDirtyState() {
  for (const form of dirtyForms) if (!form.isConnected) dirtyForms.delete(form);
  for (const editor of dirtyItemSelections) {
    if (!editor.isConnected || editor.itemId) dirtyItemSelections.delete(editor);
  }
}

function formHasDedicatedDraftBlocker(form) {
  const itemEditor = form.closest("artaround-item-authoring-view");
  return Boolean(itemEditor?.readWorkingDraft?.());
}

function hasUncoveredDirtyState() {
  pruneDirtyState();
  return dirtyItemSelections.size > 0 || [...dirtyForms].some((form) => !formHasDedicatedDraftBlocker(form));
}

function markFromEvent(event) {
  const control = event.target;
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return;
  const form = control.form;
  if (shouldProtect(form)) dirtyForms.add(form);
}

document.addEventListener("input", markFromEvent, true);
document.addEventListener("change", markFromEvent, true);
document.addEventListener("subject-selected", (event) => {
  const target = event.target instanceof Element ? event.target : null;
  const editor = target?.closest("artaround-item-authoring-view");
  if (editor && !editor.itemId) dirtyItemSelections.add(editor);
}, true);
document.addEventListener("reset", (event) => {
  if (event.target instanceof HTMLFormElement) dirtyForms.delete(event.target);
}, true);

const observerStart = () => {
  const observer = new MutationObserver(pruneDirtyState);
  observer.observe(document.body, { childList: true, subtree: true });
};
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", observerStart, { once: true });
else observerStart();

registerNavigationLossBlocker({
  isBlocking: hasUncoveredDirtyState,
  confirm: () => openActionDialog({
    tone: "danger",
    title: "Uscire senza salvare?",
    message: "Hai modifiche non ancora salvate in questo modulo.",
    confirmLabel: "Esci senza salvare",
    cancelLabel: "Resta nella pagina",
  }),
  discard: () => { dirtyForms.clear(); dirtyItemSelections.clear(); },
});
