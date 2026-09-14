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
  border: 1px solid rgba(38, 67, 55, .18);
  border-radius: 1rem;
  background: rgba(255, 255, 255, .88);
  color: inherit;
  text-align: left;
  box-shadow: 0 .15rem .6rem rgba(16, 39, 29, .05);
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease, transform .16s ease;
}
.choice-card:not(:disabled):hover { transform: translateY(-1px); }
.choice-card:focus-visible { outline: 3px solid rgba(74, 123, 101, .3); outline-offset: 2px; }
.choice-card.selected {
  border-color: rgba(38, 101, 74, .55);
  background: rgba(235, 246, 239, .96);
  box-shadow: 0 0 0 2px rgba(85, 139, 115, .12), 0 .25rem .8rem rgba(16, 39, 29, .07);
}
.choice-card:disabled { opacity: .6; cursor: not-allowed; }
.choice-card__indicator {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: .65rem;
  background: rgba(46, 84, 66, .09);
  color: #264f3d;
  font-weight: 900;
  line-height: 1;
}
.selected .choice-card__indicator { background: #285b45; color: #fff; }
.choice-card__copy { display: grid; gap: .28rem; min-width: 0; }
.choice-card__copy strong { font-size: .95rem; line-height: 1.25; }
.choice-card__copy small { color: #617168; font-size: .8rem; line-height: 1.4; }
.choice-card__details { display: block; margin-top: .25rem; color: #56675e; font-size: .75rem; line-height: 1.4; }
</style>
