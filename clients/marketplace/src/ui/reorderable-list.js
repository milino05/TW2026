function itemId(element) { return String(element?.dataset?.reorderId || element?.id || ""); }

export function installReorderableList(root, {
  itemSelector = "[data-reorder-id]",
  handleSelector = "[data-reorder-handle]",
  onReorder,
  canReorder = () => true,
} = {}) {
  if (!(root instanceof HTMLElement) || typeof onReorder !== "function") throw new TypeError("installReorderableList requires a root and onReorder().");
  let dragging = null;
  const live = document.createElement("p");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  root.append(live);

  const handles = [...root.querySelectorAll(handleSelector)].filter((entry) => entry instanceof HTMLElement);
  const originalDraggable = new Map(handles.map((handle) => [handle, handle.getAttribute("draggable")]));
  handles.forEach((handle) => handle.setAttribute("draggable", "true"));

  const items = () => [...root.querySelectorAll(itemSelector)].filter((entry) => entry instanceof HTMLElement);
  const announce = (message) => { live.textContent = ""; requestAnimationFrame(() => { live.textContent = message; }); };
  const request = async ({ item, from, to, direction = null, focusTarget = null }) => {
    if (!item || from === to || canReorder({ item, from, to, direction }) === false) return;
    await onReorder({ item, from, to, direction });
    announce(`Elemento spostato dalla posizione ${from + 1} alla posizione ${to + 1}.`);
    requestAnimationFrame(() => {
      const updated = [...root.querySelectorAll(itemSelector)].find((entry) => itemId(entry) === item);
      const target = updated?.querySelector?.(focusTarget || "[data-reorder-handle], [data-reorder-move]") || updated;
      target?.focus?.({ preventScroll: true });
    });
  };

  const dragstart = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest(handleSelector);
    const item = handle?.closest(itemSelector);
    if (!(item instanceof HTMLElement) || !root.contains(item)) return;
    dragging = item;
    event.dataTransfer?.setData("text/plain", itemId(item));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  };
  const dragover = (event) => {
    if (!dragging) return;
    const target = event.target instanceof Element ? event.target.closest(itemSelector) : null;
    if (target && root.contains(target)) event.preventDefault();
  };
  const drop = (event) => {
    if (!dragging) return;
    const target = event.target instanceof Element ? event.target.closest(itemSelector) : null;
    if (!(target instanceof HTMLElement) || !root.contains(target)) return;
    event.preventDefault();
    const entries = items();
    const from = entries.indexOf(dragging);
    const to = entries.indexOf(target);
    const id = itemId(dragging);
    dragging = null;
    void request({ item: id, from, to, focusTarget: handleSelector });
  };
  const dragend = () => { dragging = null; };
  const click = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const move = target?.closest("[data-reorder-move]");
    const item = move?.closest(itemSelector);
    if (!(item instanceof HTMLElement) || !root.contains(item)) return;
    const entries = items();
    const from = entries.indexOf(item);
    const direction = move.dataset.reorderMove;
    const to = direction === "before" ? Math.max(0, from - 1) : Math.min(entries.length - 1, from + 1);
    void request({ item: itemId(item), from, to, direction, focusTarget: `[data-reorder-move="${direction}"]` });
  };
  const keydown = (event) => {
    if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
    const item = event.target instanceof Element ? event.target.closest(itemSelector) : null;
    if (!(item instanceof HTMLElement) || !root.contains(item)) return;
    const entries = items();
    const from = entries.indexOf(item);
    const direction = event.key === "ArrowUp" ? "before" : "after";
    const to = direction === "before" ? Math.max(0, from - 1) : Math.min(entries.length - 1, from + 1);
    event.preventDefault();
    void request({ item: itemId(item), from, to, direction, focusTarget: handleSelector });
  };

  root.addEventListener("dragstart", dragstart);
  root.addEventListener("dragover", dragover);
  root.addEventListener("drop", drop);
  root.addEventListener("dragend", dragend);
  root.addEventListener("click", click);
  root.addEventListener("keydown", keydown);
  return () => {
    root.removeEventListener("dragstart", dragstart);
    root.removeEventListener("dragover", dragover);
    root.removeEventListener("drop", drop);
    root.removeEventListener("dragend", dragend);
    root.removeEventListener("click", click);
    root.removeEventListener("keydown", keydown);
    for (const [handle, value] of originalDraggable) {
      if (value === null) handle.removeAttribute("draggable"); else handle.setAttribute("draggable", value);
    }
    live.remove();
  };
}
