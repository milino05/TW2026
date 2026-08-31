<script setup lang="ts">
import type { FeedbackTone } from "../application/uiFeedback";
withDefaults(defineProps<{ tone?: FeedbackTone }>(), { tone: "neutral" });
</script>

<template>
  <aside class="feedback-callout" :data-tone="tone" role="note"><slot /></aside>
</template>

<style scoped>
.feedback-callout{--feedback-accent:var(--navigator-primary);display:block;padding:.85rem 1rem;border:1px solid var(--navigator-border);border-left:.22rem solid var(--feedback-accent);border-radius:.85rem;background:var(--navigator-surface-raised);color:var(--navigator-ink)}
.feedback-callout[data-tone="info"]{--feedback-accent:#47799a}.feedback-callout[data-tone="success"]{--feedback-accent:#36785c}.feedback-callout[data-tone="warning"]{--feedback-accent:#9a681d}.feedback-callout[data-tone="danger"]{--feedback-accent:#b33e45}
</style>
