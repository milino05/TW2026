<script setup lang="ts">
import type { FeedbackTone } from "../application/uiFeedback";
withDefaults(defineProps<{ tone?: FeedbackTone; semanticRole?: "note" | "status" | "alert" }>(), { tone: "neutral", semanticRole: "note" });
</script>

<template>
  <aside class="feedback-callout" :data-tone="tone" :role="semanticRole" :aria-live="semanticRole === 'alert' ? 'assertive' : undefined"><slot /></aside>
</template>

<style scoped>
.feedback-callout{--feedback-accent:var(--navigator-primary);display:block;padding:.85rem 1rem;border:1px solid var(--navigator-border);border-left:.22rem solid var(--feedback-accent);border-radius:.85rem;background:var(--navigator-surface-raised);color:var(--navigator-ink)}
.feedback-callout[data-tone="info"]{--feedback-accent:#47799a}.feedback-callout[data-tone="success"]{--feedback-accent:#36785c}.feedback-callout[data-tone="warning"]{--feedback-accent:#9a681d}.feedback-callout[data-tone="danger"]{--feedback-accent:#b33e45}
</style>
