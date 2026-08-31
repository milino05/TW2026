<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from "vue";

const props = withDefaults(defineProps<{
  label: string;
  disabled?: boolean;
  align?: "start" | "end";
}>(), {
  disabled: false,
  align: "end",
});

const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
let menuSequence = Math.random().toString(36).slice(2, 9);
const menuId = `artaround-action-menu-${menuSequence}`;

function focusables() {
  if (!panel.value) return [] as HTMLElement[];
  return [...panel.value.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"]), button:not(:disabled), a[href]')];
}

function positionPanel() {
  if (!open.value || !trigger.value || !panel.value) return;
  const rect = trigger.value.getBoundingClientRect();
  const menu = panel.value;
  const gutter = 8;
  const width = menu.offsetWidth;
  const height = menu.offsetHeight;
  const preferredLeft = props.align === "start" ? rect.left : rect.right - width;
  menu.style.left = `${Math.min(window.innerWidth - width - gutter, Math.max(gutter, preferredLeft))}px`;
  menu.style.top = `${Math.min(window.innerHeight - height - gutter, Math.max(gutter, rect.bottom + 6))}px`;
}

async function show({ focus = true, last = false } = {}) {
  if (props.disabled || open.value) return;
  open.value = true;
  await nextTick();
  positionPanel();
  if (focus) {
    const items = focusables();
    (last ? items.at(-1) : items[0])?.focus({ preventScroll: true });
  }
}

function close({ restoreFocus = true } = {}) {
  if (!open.value) return;
  open.value = false;
  if (restoreFocus) nextTick(() => trigger.value?.focus({ preventScroll: true }));
}

function toggle() {
  if (open.value) close(); else void show({ focus: false });
}

function onTriggerKeydown(event: KeyboardEvent) {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    void show({ focus: true });
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    void show({ focus: true, last: true });
  }
}

function onPanelKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  const items = focusables();
  if (!items.length) return;
  const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
  const next = event.key === "Home"
    ? 0
    : event.key === "End"
      ? items.length - 1
      : event.key === "ArrowDown"
        ? (current + 1) % items.length
        : (current - 1 + items.length) % items.length;
  event.preventDefault();
  items[next]?.focus({ preventScroll: true });
}

function onPanelClick(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest('[role="menuitem"], button, a[href]') : null;
  if (target) close({ restoreFocus: false });
}

function onPointerDown(event: PointerEvent) {
  if (!open.value) return;
  const target = event.target;
  if (target instanceof Node && (trigger.value?.contains(target) || panel.value?.contains(target))) return;
  close();
}

function onViewportChange() {
  if (open.value) positionPanel();
}

document.addEventListener("pointerdown", onPointerDown, true);
window.addEventListener("resize", onViewportChange);
window.addEventListener("scroll", onViewportChange, true);

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerDown, true);
  window.removeEventListener("resize", onViewportChange);
  window.removeEventListener("scroll", onViewportChange, true);
});
</script>

<template>
  <span class="action-menu-anchor">
    <button
      ref="trigger"
      class="action-menu-trigger"
      type="button"
      :disabled="disabled"
      :aria-label="label"
      :aria-expanded="open"
      :aria-controls="menuId"
      aria-haspopup="menu"
      @click="toggle"
      @keydown="onTriggerKeydown"
    >
      <slot name="trigger">•••</slot>
    </button>
  </span>

  <Teleport to="body">
    <div
      v-if="open"
      :id="menuId"
      ref="panel"
      class="action-menu-panel"
      role="menu"
      @keydown="onPanelKeydown"
      @click="onPanelClick"
    >
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.action-menu-anchor { display: inline-flex; }
.action-menu-trigger {
  width: 44px;
  min-width: 44px;
  height: 44px;
  padding: 0;
  display: grid;
  place-items: center;
}
.action-menu-panel {
  position: fixed;
  z-index: var(--artaround-layer-popover, 100000);
  min-width: 12rem;
  max-width: min(22rem, calc(100vw - 1rem));
  padding: .35rem;
  border: 1px solid var(--navigator-border);
  border-radius: .8rem;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
  box-shadow: 0 14px 34px var(--navigator-shadow);
}
.action-menu-panel :deep([role="menuitem"]),
.action-menu-panel :deep(button),
.action-menu-panel :deep(a[href]) {
  width: 100%;
  min-height: 2.5rem;
  display: flex;
  align-items: center;
  border: 0;
  border-radius: .55rem;
  padding: .55rem .7rem;
  color: var(--navigator-ink);
  background: transparent;
  text-align: left;
  text-decoration: none;
}
.action-menu-panel :deep([role="menuitem"]:hover),
.action-menu-panel :deep([role="menuitem"]:focus-visible),
.action-menu-panel :deep(button:hover),
.action-menu-panel :deep(button:focus-visible) {
  background: color-mix(in srgb, var(--navigator-primary) 9%, transparent);
}
</style>