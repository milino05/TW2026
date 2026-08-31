<script setup lang="ts">
import type { FeedbackTone } from "../application/uiFeedback";
withDefaults(defineProps<{ tone?: FeedbackTone; label?: string }>(), { tone: "warning", label: "Problemi da risolvere" });
</script>

<template>
  <section class="feedback-issue-panel" :data-tone="tone" role="region" :aria-label="label"><slot /></section>
</template>

<style scoped>
.feedback-issue-panel{--feedback-accent:#9a681d;display:grid;gap:.65rem;padding:.85rem 1rem;border:1px solid var(--navigator-border);border-left:.22rem solid var(--feedback-accent);border-radius:.85rem;background:var(--navigator-surface-raised);color:var(--navigator-ink)}
.feedback-issue-panel[data-tone="info"]{--feedback-accent:#47799a}.feedback-issue-panel[data-tone="success"]{--feedback-accent:#36785c}.feedback-issue-panel[data-tone="warning"]{--feedback-accent:#9a681d}.feedback-issue-panel[data-tone="danger"]{--feedback-accent:#b33e45}
</style>
