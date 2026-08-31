<script setup lang="ts">
import type { FeedbackTone } from "../application/uiFeedback";
withDefaults(defineProps<{ tone?: FeedbackTone }>(), { tone: "neutral" });
</script>

<template>
  <span class="feedback-status" :data-tone="tone"><slot /></span>
</template>

<style scoped>
.feedback-status{display:inline-flex;align-items:center;gap:.35rem;min-height:1.75rem;padding:.2rem .55rem;border:1px solid var(--navigator-border);border-radius:999px;background:var(--navigator-surface-raised);color:var(--navigator-muted);font-size:.76rem;font-weight:750}.feedback-status[data-tone="info"]{color:#47799a}.feedback-status[data-tone="success"]{color:#36785c}.feedback-status[data-tone="warning"]{color:#9a681d}.feedback-status[data-tone="danger"]{color:#b33e45}
</style>
