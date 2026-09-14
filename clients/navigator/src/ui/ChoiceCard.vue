<script setup lang="ts">
withDefaults(defineProps<{
  selected: boolean;
  disabled?: boolean;
  title: string;
  description?: string;
  indicator?: "radio" | "check";
}>(), {
  disabled: false,
  description: "",
  indicator: "radio",
});

const emit = defineEmits<{ activate: [] }>();
</script>

<template>
  <button
    type="button"
    class="choice-card"
    :class="{ selected }"
    :aria-pressed="selected"
    :disabled="disabled"
    @click="emit('activate')"
  >
    <span class="choice-card__indicator" aria-hidden="true">
      {{ indicator === "check" ? (selected ? "✓" : "+") : (selected ? "●" : "○") }}
    </span>
    <span class="choice-card__copy">
      <strong>{{ title }}</strong>
      <small v-if="description">{{ description }}</small>
      <span v-if="$slots.details" class="choice-card__details"><slot name="details" /></span>
    </span>
  </button>
</template>

<style scoped>
.choice-card {
  display: grid;
  grid-template-columns: 2rem minmax(0, 1fr);
  gap: .7rem;
  align-items: start;
  width: 100%;
  min-height: 4.6rem;
  padding: .9rem;
  border: 1px solid var(--navigator-border);
  border-radius: 1rem;
  background: var(--navigator-surface-raised);
  color: var(--navigator-ink);
  text-align: left;
  box-shadow: 0 .15rem .6rem var(--navigator-shadow);
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, transform .16s ease;
}
.choice-card:not(:disabled):hover { transform: translateY(-1px); border-color: color-mix(in srgb, var(--navigator-primary) 42%, var(--navigator-border)); }
.choice-card:focus-visible { outline: 3px solid color-mix(in srgb, var(--navigator-primary) 30%, transparent); outline-offset: 2px; }
.choice-card.selected {
  border-color: color-mix(in srgb, var(--navigator-primary) 62%, var(--navigator-border));
  background: color-mix(in srgb, var(--navigator-primary) 11%, var(--navigator-surface-raised));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--navigator-primary) 14%, transparent), 0 .25rem .8rem var(--navigator-shadow);
}
.choice-card:disabled { opacity: .6; cursor: not-allowed; }
.choice-card__indicator {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: .65rem;
  background: color-mix(in srgb, var(--navigator-primary) 10%, var(--navigator-surface-raised));
  color: var(--navigator-primary);
  font-weight: 900;
  line-height: 1;
}
.selected .choice-card__indicator { background: var(--navigator-primary); color: var(--navigator-on-primary); }
.choice-card__copy { display: grid; gap: .28rem; min-width: 0; }
.choice-card__copy strong { font-size: .95rem; line-height: 1.25; }
.choice-card__copy small,
.choice-card__details { color: var(--navigator-muted); }
.choice-card__copy small { font-size: .8rem; line-height: 1.4; }
.choice-card__details { display: block; margin-top: .25rem; font-size: .75rem; line-height: 1.4; }
</style>
