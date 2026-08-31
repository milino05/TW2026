<script setup lang="ts">
import FeedbackCallout from "./FeedbackCallout.vue";
import FeedbackEmptyState from "./FeedbackEmptyState.vue";
import FeedbackProgressState from "./FeedbackProgressState.vue";

withDefaults(defineProps<{
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  loadingMessage?: string;
  errorTitle?: string;
  emptyTitle?: string;
  emptyMessage?: string;
}>(), {
  loading: false,
  error: null,
  empty: false,
  loadingMessage: "Caricamento…",
  errorTitle: "Operazione non disponibile",
  emptyTitle: "Nessun contenuto",
  emptyMessage: "Non ci sono elementi da mostrare.",
});
</script>

<template>
  <FeedbackProgressState v-if="loading" tone="info">{{ loadingMessage }}</FeedbackProgressState>
  <FeedbackCallout v-else-if="error" tone="danger" semantic-role="alert">
    <strong>{{ errorTitle }}</strong>
    <p>{{ error }}</p>
  </FeedbackCallout>
  <FeedbackEmptyState v-else-if="empty">
    <h2>{{ emptyTitle }}</h2>
    <p>{{ emptyMessage }}</p>
    <slot name="empty-action" />
  </FeedbackEmptyState>
  <slot v-else />
</template>
