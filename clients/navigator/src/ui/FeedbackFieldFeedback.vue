<script setup lang="ts">
import type { FeedbackTone } from "../application/uiFeedback";
withDefaults(defineProps<{ tone?: FeedbackTone }>(), { tone: "danger" });
</script>

<template>
  <small class="feedback-field" :data-tone="tone" aria-live="polite"><slot /></small>
</template>

<style scoped>
.feedback-field{display:block;margin-top:.32rem;color:#b33e45;font-size:.78rem;font-weight:700;line-height:1.35}.feedback-field[data-tone="warning"]{color:#9a681d}.feedback-field[data-tone="info"]{color:#47799a}.feedback-field[data-tone="success"]{color:#36785c}
</style>
