import { authoringRepository } from "../infrastructure/http/authoring-repository.js";
import { visitSequenceRepository } from "../infrastructure/http/visit-sequence-repository.js";
import { installReorderableList } from "./reorderable-list.js";

const EDITOR_SELECTOR = "artaround-visit-authoring-view";
const installations = new WeakMap();
let observer = null;
let scanQueued = false;

function annotateMoveButtons(root, legacyAttribute) {
  for (const button of root.querySelectorAll(`button[${legacyAttribute}]`)) {
    const direction = Number(button.dataset.direction) || 0;
    button.dataset.reorderMove = direction < 0 ? "before" : "after";
    button.removeAttribute(legacyAttribute);
  }
}

function annotateItems(root, { itemSelector, idAttribute }) {
  for (const item of root.querySelectorAll(itemSelector)) {
    item.dataset.reorderId = item.getAttribute(idAttribute) || "";
    const handle = item.querySelector(".drag-handle");
    if (handle instanceof HTMLElement) {
      handle.dataset.reorderHandle = "";
      handle.tabIndex = 0;
      handle.setAttribute("role", "button");
      handle.setAttribute("aria-label", "Riordina elemento. Usa Alt+Freccia su o giù per spostarlo.");
    }
  }
}

function disableLegacyDrag(editor) {
  editor.dataset.artaroundSharedReorder = "true";
  for (const [eventName, handlerName] of [
    ["dragstart", "onDragStart"],
    ["dragover", "onDragOver"],
    ["drop", "onDrop"],
    ["dragend", "onDragEnd"],
  ]) {
    const handler = editor[handlerName];
    if (typeof handler === "function") editor.removeEventListener(eventName, handler);
  }
  editor.dragState = null;
}

function registerInstallation(state, root, cleanup) {
  state.entries.push({ root, cleanup });
}

function cleanupDetachedRoots(state) {
  state.entries = state.entries.filter((entry) => {
    if (entry.root?.isConnected) return true;
    entry.cleanup?.();
    return false;
  });
}

function installStops(editor, root, state) {
  if (!(root instanceof HTMLElement) || root.dataset.artaroundReorderInstalled === "true") return;
  const stopSelector = ':scope > .sequence-group[data-drag-kind="stop"]';
  annotateItems(root, { itemSelector: stopSelector, idAttribute: "data-stop-id" });
  annotateMoveButtons(root, "data-move-stop");
  root.dataset.artaroundReorderInstalled = "true";
  registerInstallation(state, root, installReorderableList(root, {
    itemSelector: stopSelector,
    handleSelector: "[data-reorder-handle]",
    canReorder: () => Boolean(editor.editable && !editor.busy),
    onReorder: ({ item, to }) => editor.execute(
      () => authoringRepository.reorderVisitStop(editor.visitId, item, to),
      "Ordine delle tappe aggiornato",
    ),
  }));
}

function installContentGroup(editor, root, state) {
  if (!(root instanceof HTMLElement) || root.dataset.artaroundReorderInstalled === "true") return;
  const contentSelector = ':scope > .sequence-entry[data-drag-kind="content"]';
  annotateItems(root, { itemSelector: contentSelector, idAttribute: "data-content-id" });
  annotateMoveButtons(root, "data-move-content");
  root.dataset.artaroundReorderInstalled = "true";
  registerInstallation(state, root, installReorderableList(root, {
    itemSelector: contentSelector,
    handleSelector: "[data-reorder-handle]",
    canReorder: () => Boolean(editor.editable && !editor.busy),
    onReorder: ({ item, to }) => editor.execute(
      () => visitSequenceRepository.reorderContent(editor.visitId, item, to),
      "Ordine dei contenuti aggiornato",
    ),
  }));
}

function clearContentDropTargets(editor) {
  for (const group of editor.querySelectorAll('[data-content-drop-target="true"]')) {
    group.removeAttribute("data-content-drop-target");
  }
}

function installContentHierarchy(editor, state) {
  if (state.hierarchyCleanup) return;
  let dragging = null;

  const dragstart = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const entry = target?.closest('.sequence-entry[data-drag-kind="content"]');
    if (!(entry instanceof HTMLElement) || !target.closest(".drag-handle") || !editor.editable || editor.busy) return;
    dragging = {
      id: entry.dataset.contentId || "",
      anchorKey: entry.dataset.anchorKey || "contextual",
    };
  };
  const dragover = (event) => {
    if (!dragging) return;
    const target = event.target instanceof Element ? event.target : null;
    const group = target?.closest(".sequence-group[data-drop-anchor]");
    if (!(group instanceof HTMLElement) || !editor.contains(group)) return;
    const destinationKey = group.dataset.dropAnchor || "contextual";
    if (destinationKey === dragging.anchorKey) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    clearContentDropTargets(editor);
    group.dataset.contentDropTarget = "true";
  };
  const dragleave = (event) => {
    const group = event.target instanceof Element ? event.target.closest(".sequence-group[data-drop-anchor]") : null;
    if (!(group instanceof HTMLElement) || (event.relatedTarget instanceof Node && group.contains(event.relatedTarget))) return;
    group.removeAttribute("data-content-drop-target");
  };
  const drop = (event) => {
    if (!dragging) return;
    const target = event.target instanceof Element ? event.target : null;
    const group = target?.closest(".sequence-group[data-drop-anchor]");
    if (!(group instanceof HTMLElement) || !editor.contains(group)) return;
    const destinationKey = group.dataset.dropAnchor || "contextual";
    if (destinationKey === dragging.anchorKey) return;
    event.preventDefault();
    const destinationEntries = [...group.querySelectorAll(':scope > .sequence-entry-list > .sequence-entry[data-drag-kind="content"]')];
    const targetEntry = target.closest('.sequence-entry[data-drag-kind="content"]');
    const targetIndex = targetEntry ? destinationEntries.indexOf(targetEntry) : destinationEntries.length;
    const contentId = dragging.id;
    dragging = null;
    clearContentDropTargets(editor);
    void editor.execute(
      () => visitSequenceRepository.moveContent(editor.visitId, contentId, {
        deliveryAnchorId: destinationKey === "contextual" ? null : destinationKey,
        toIndex: Math.max(0, targetIndex),
      }),
      destinationKey === "contextual" ? "Contenuto spostato nel contesto generale" : "Contenuto aggiunto alla tappa",
    );
  };
  const dragend = () => {
    dragging = null;
    clearContentDropTargets(editor);
  };

  editor.addEventListener("dragstart", dragstart);
  editor.addEventListener("dragover", dragover);
  editor.addEventListener("dragleave", dragleave);
  editor.addEventListener("drop", drop);
  editor.addEventListener("dragend", dragend);
  state.hierarchyCleanup = () => {
    editor.removeEventListener("dragstart", dragstart);
    editor.removeEventListener("dragover", dragover);
    editor.removeEventListener("dragleave", dragleave);
    editor.removeEventListener("drop", drop);
    editor.removeEventListener("dragend", dragend);
    clearContentDropTargets(editor);
  };
}

function synchronizeEditor(editor) {
  disableLegacyDrag(editor);
  let state = installations.get(editor);
  if (!state) {
    state = { entries: [] };
    installations.set(editor, state);
  }
  cleanupDetachedRoots(state);
  installContentHierarchy(editor, state);

  const sequence = editor.querySelector(".visit-sequence");
  installStops(editor, sequence, state);
  for (const group of editor.querySelectorAll(".sequence-entry-list")) installContentGroup(editor, group, state);
}

function scanEditors() {
  for (const editor of document.querySelectorAll(EDITOR_SELECTOR)) synchronizeEditor(editor);
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    scanEditors();
  });
}

export function installVisitReorderAdapter() {
  if (observer || typeof document === "undefined") return;
  queueScan();
  observer = new MutationObserver(queueScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

installVisitReorderAdapter();
