<script setup lang="ts">
import { computed, ref } from "vue";

type ChoiceOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

const props = withDefaults(defineProps<{
  options: ChoiceOption[];
  label: string;
  disabled?: boolean;
}>(), { disabled: false });

const model = defineModel<string>({ required: true });
const details = ref<HTMLDetailsElement | null>(null);
const selectedLabel = computed(() => props.options.find((option) => option.value === model.value)?.label || "Scegli un'opzione");

function choose(value: string) {
  if (props.disabled) return;
  model.value = value;
  if (details.value) details.value.open = false;
  details.value?.querySelector("summary")?.focus({ preventScroll: true });
}
</script>

<template>
  <details ref="details" class="reliable-choice" name="navigator-reliable-select" :data-disabled="disabled">
    <summary
      :aria-label="label"
      aria-haspopup="listbox"
      :aria-disabled="disabled"
      @click="disabled && $event.preventDefault()"
    >
      <span>{{ selectedLabel }}</span>
    </summary>
    <div class="reliable-choice__options" role="listbox" :aria-label="label">
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        role="option"
        :aria-selected="option.value === model"
        :disabled="disabled || option.disabled"
        @click="choose(option.value)"
      >
        <span>{{ option.label }}</span>
        <strong v-if="option.value === model" aria-hidden="true">✓</strong>
      </button>
    </div>
  </details>
</template>

<style scoped>
.reliable-choice { position: relative; width: 100%; border: 0; border-radius: .75rem; }
.reliable-choice summary {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-height: 46px;
  align-items: center;
  justify-content: space-between;
  gap: .65rem;
  padding: .7rem .8rem;
  border: 1px solid var(--navigator-border);
  border-radius: .75rem;
  color: var(--navigator-ink);
  background: var(--navigator-surface-raised);
  font-weight: 500;
  list-style: none;
  cursor: pointer;
}
.reliable-choice summary::-webkit-details-marker { display: none; }
.reliable-choice summary::marker { content: ""; }
.reliable-choice summary::after { content: "⌄"; flex: 0 0 auto; font-weight: 850; transition: transform .15s ease; }
.reliable-choice[open] summary { border-color: var(--navigator-primary); outline: 3px solid color-mix(in srgb, var(--navigator-primary) 30%, transparent); }
.reliable-choice[open] summary::after { transform: rotate(180deg); }
.reliable-choice[data-disabled="true"] summary { cursor: not-allowed; opacity: .56; }
.reliable-choice__options {
  position: absolute;
  z-index: 30;
  top: calc(100% + .35rem);
  right: 0;
  left: 0;
  display: grid;
  max-height: min(18rem, 50vh);
  gap: .2rem;
  overflow: auto;
  padding: .3rem;
  border: 1px solid var(--navigator-border);
  border-radius: .75rem;
  background: var(--navigator-surface-raised);
  box-shadow: 0 14px 30px var(--navigator-shadow);
}
.reliable-choice__options button {
  display: flex;
  width: 100%;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: .5rem;
  border: 0;
  text-align: left;
}
.reliable-choice__options button:hover:not(:disabled),
.reliable-choice__options button[aria-selected="true"] {
  color: var(--navigator-on-primary);
  background: var(--navigator-primary);
}
</style>
