<script setup lang="ts">
defineProps<{ title: string }>();
</script>

<template>
  <main class="placeholder-view">
    <h1>{{ title }}</h1>
    <p>Slice 0: shell applicativa pronta. Le projection e i flussi reali arrivano nei vertical slice successivi.</p>
  </main>
</template>

<style scoped>
.placeholder-view {
  max-width: 48rem;
  margin: 0 auto;
  padding: 2rem 1rem;
}
</style>
