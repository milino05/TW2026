<script setup lang="ts">
import type { FeedbackTone } from "../application/uiFeedback";
withDefaults(defineProps<{ tone?: FeedbackTone }>(), { tone: "info" });
</script>

<template>
  <span class="feedback-progress" :data-tone="tone" role="status" aria-live="polite"><slot /></span>
</template>

<style scoped>
.feedback-progress{display:inline-flex;align-items:center;gap:.55rem;color:var(--navigator-muted);font-size:.84rem;font-weight:700}.feedback-progress[data-tone="info"]{color:#47799a}.feedback-progress[data-tone="success"]{color:#36785c}.feedback-progress[data-tone="warning"]{color:#9a681d}.feedback-progress[data-tone="danger"]{color:#b33e45}
</style>
