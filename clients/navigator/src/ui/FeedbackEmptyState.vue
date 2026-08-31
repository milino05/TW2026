<template>
  <section class="feedback-empty-state" role="region"><slot /></section>
</template>

<style scoped>
.feedback-empty-state{display:grid;place-items:center;gap:.65rem;min-height:9rem;padding:1.25rem;border:1px dashed var(--navigator-border);border-radius:1rem;background:var(--navigator-surface-raised);text-align:center}
</style>
