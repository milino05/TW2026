<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { storeToRefs } from "pinia";
import { useConfiguredVenueStore, useNavigationStore, useRuntimeStore } from "../application/stores";
import { browserTts } from "../capabilities/browserTts";
import type { TextToSpeechState } from "../capabilities";
import { browserControlledVoice } from "../capabilities/controlledVoice";
import {
  actionOfType,
  groupSessionActions,
  presentationDurationLabel,
  quickPresentationActions,
  resolveSessionStopContext,
} from "../domain/sessionPresentation";
import { navigationRepository } from "../infrastructure/http/navigationRepository";
import { sessionRepository, type AvailableAction } from "../infrastructure/http/sessionRepository";
import SessionActionSheet from "./SessionActionSheet.vue";
import SessionMap from "./SessionMap.vue";

type InteractionChannel = "button" | "controlled_voice";

const route = useRoute();
const runtimeStore = useRuntimeStore();
const navigationStore = useNavigationStore();
const configuredVenueStore = useConfiguredVenueStore();
const { snapshot } = storeToRefs(runtimeStore);
const { map, navigation } = storeToRefs(navigationStore);
const { config } = storeToRefs(configuredVenueStore);

const activeView = ref<"content" | "map">("content");
const busyActionId = ref<string | null>(null);
const voiceBusy = ref(false);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const actionSheetOpen = ref(false);
const voiceSheetOpen = ref(false);
const mediaOpen = ref(false);
const semanticChoices = ref<AvailableAction[]>([]);
const completionConfirmOpen = ref(false);
const pendingCompletion = ref<{ action: AvailableAction; channel: InteractionChannel } | null>(null);
const ttsState = ref<TextToSpeechState>(browserTts.state);
const completionCancelButton = ref<HTMLButtonElement | null>(null);
let unsubscribeTts: (() => void) | null = null;
let voiceSequence = 0;

const sessionId = computed(() => String(route.params.sessionId));
const venueId = computed(() => String(route.params.venueId || ""));
const currentAnchorId = computed(() =>
  snapshot.value?.current?.anchor?.visitAnchorId
  || map.value?.logicalCurrentStop?.visitAnchorId
  || null);
const stopContext = computed(() => resolveSessionStopContext(map.value, currentAnchorId.value));
const actionGroups = computed(() => groupSessionActions(snapshot.value?.availableActions || []));
const quickActions = computed(() => quickPresentationActions(snapshot.value?.availableActions || []));
const previousAction = computed(() => actionOfType(snapshot.value?.availableActions || [], "PROGRESS_PREVIOUS"));
const nextAction = computed(() => actionOfType(snapshot.value?.availableActions || [], "PROGRESS_NEXT"));
const interactionBusy = computed(() => busyActionId.value !== null || voiceBusy.value);
const isCompleted = computed(() => ["completed", "abandoned"].includes(snapshot.value?.session.status || ""));
const isSemantic = computed(() => snapshot.value?.current?.presentation.kind === "semantic_exploration");
const currentMedia = computed(() => snapshot.value?.current?.illustrativeMedia?.[0] || null);
const mediaAttribution = computed(() => {
  const media = currentMedia.value;
  return [media?.rights?.attribution || media?.rights?.creator, media?.rights?.licenseName].filter(Boolean).join(" · ");
});
const mediaSourceUrl = computed(() => {
  const value = currentMedia.value?.source?.pageUrl;
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch { return null; }
});
const hasActionSheetActions = computed(() =>
  actionGroups.value.presentation.length
  + actionGroups.value.semantic.length
  + actionGroups.value.navigation.length
  + actionGroups.value.lifecycle.length
  + actionGroups.value.other.length > 0);
const displayTitle = computed(() => {
  if (isSemantic.value) return snapshot.value?.current?.label || "Approfondimento";
  return stopContext.value.current?.label || snapshot.value?.current?.label || "Contenuto della visita";
});
const displaySubtitle = computed(() => {
  const contentLabel = snapshot.value?.current?.label;
  if (isSemantic.value) {
    return stopContext.value.current ? "Approfondimento dalla tappa " + stopContext.value.current.label : "Approfondimento";
  }
  return contentLabel && contentLabel !== displayTitle.value ? contentLabel : null;
});
const physicalContext = computed(() => {
  const current = stopContext.value.current;
  if (!current) return null;
  return current.venueName + " · " + current.floorLabel;
});
const progressLabel = computed(() => {
  const current = stopContext.value.current;
  return current && stopContext.value.total
    ? "Tappa " + current.order + " di " + stopContext.value.total
    : "Visita in corso";
});
const progressPercent = computed(() => {
  const current = stopContext.value.current;
  return current && stopContext.value.total ? Math.min(100, (current.order / stopContext.value.total) * 100) : 0;
});
const sessionStatusLabel = computed(() => {
  const labels: Record<string, string> = {
    active: "In corso",
    paused: "In pausa",
    route_completed: "Percorso completato",
    completed: "Completata",
    abandoned: "Terminata",
  };
  return labels[snapshot.value?.session.status || ""] || snapshot.value?.session.status || "";
});
const audioDetail = computed(() => {
  const presentation = snapshot.value?.current?.presentation;
  if (!presentation) return "";
  const locale = (presentation.locale || "it-IT").toUpperCase();
  return presentationDurationLabel(presentation.estimatedContentSeconds) + " · " + locale;
});
const audioTitle = computed(() => {
  if (ttsState.value === "speaking") return "Lettura in corso";
  if (ttsState.value === "paused") return "Lettura in pausa";
  return "Ascolta la descrizione";
});
const audioButtonLabel = computed(() => {
  if (ttsState.value === "speaking") return "Metti in pausa";
  if (ttsState.value === "paused") return "Riprendi lettura";
  return "Ascolta il testo";
});
const voiceExamples = computed(() => (snapshot.value?.availableActions || []).slice(0, 3));

watch(() => snapshot.value?.session.runtimeVersion, () => {
  browserTts.stop();
  mediaOpen.value = false;
});
watch(completionConfirmOpen, async (open) => {
  if (!open) return;
  await nextTick();
  completionCancelButton.value?.focus();
});

onMounted(async () => {
  unsubscribeTts = browserTts.subscribe((state) => { ttsState.value = state; });
  window.addEventListener("keydown", handleKeydown);
  error.value = null;
  navigationStore.clear();
  const hasCurrentSnapshot = snapshot.value?.session.id === sessionId.value;
  if (!hasCurrentSnapshot) runtimeStore.clear();
  try {
    const requests: Promise<unknown>[] = [];
    if (!hasCurrentSnapshot) {
      requests.push(sessionRepository.current(sessionId.value).then((value) => runtimeStore.applySnapshot(value)));
    }
    requests.push(navigationRepository.map(sessionId.value).then((value) => navigationStore.setMap(value)));
    await Promise.all(requests);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Impossibile riprendere la sessione";
  }
});

onUnmounted(() => {
  voiceSequence += 1;
  unsubscribeTts?.();
  browserTts.stop();
  browserControlledVoice.stop();
  window.removeEventListener("keydown", handleKeydown);
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (mediaOpen.value) mediaOpen.value = false;
  else if (voiceSheetOpen.value) cancelVoice();
  else if (semanticChoices.value.length) semanticChoices.value = [];
  else if (completionConfirmOpen.value) closeCompletionConfirm();
  else actionSheetOpen.value = false;
}

function closeOverlays() {
  actionSheetOpen.value = false;
  voiceSheetOpen.value = false;
  mediaOpen.value = false;
  semanticChoices.value = [];
}

async function dispatch(action: AvailableAction, channel: InteractionChannel = "button") {
  if (!snapshot.value || interactionBusy.value) return;
  closeOverlays();
  browserTts.stop();
  busyActionId.value = action.actionId;
  error.value = null;
  notice.value = null;
  try {
    const response = await sessionRepository.dispatchAction(
      sessionId.value,
      action.actionId,
      snapshot.value.session.runtimeVersion,
      channel,
    );
    runtimeStore.applySnapshot(response.runtime);

    if (action.family === "progress") {
      navigationStore.setNavigation(null);
      activeView.value = "content";
      await navigationRepository.map(sessionId.value)
        .then((value) => navigationStore.setMap(value))
        .catch(() => {});
    } else if (action.family === "presentation" || action.family === "semantic") {
      activeView.value = "content";
    }

    if (response.effect?.type === "navigation_requested" && response.effect.navigation) {
      navigationStore.setNavigation(response.effect.navigation);
      activeView.value = "map";
      notice.value = "Percorso verso " + response.effect.navigation.destination.label;
    } else if (response.effect?.type === "obstacle_check" && response.effect.obstacleCheck) {
      notice.value = response.effect.obstacleCheck.message;
    } else if (response.effect?.type === "semantic_choices" && response.effect.choices?.length) {
      semanticChoices.value = response.effect.choices;
      activeView.value = "content";
      notice.value = "Sono disponibili più approfondimenti pertinenti: scegli quello che vuoi aprire.";
    } else if (response.effect?.type === "completion") {
      navigationStore.setNavigation(null);
      notice.value = "Visita completata";
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Operazione non disponibile";
    try {
      runtimeStore.applySnapshot(await sessionRepository.current(sessionId.value));
    } catch {
      runtimeStore.clear();
    }
  } finally {
    busyActionId.value = null;
  }
}

function requestAction(action: AvailableAction, channel: InteractionChannel = "button") {
  if (action.type !== "COMPLETE") {
    void dispatch(action, channel);
    return;
  }
  closeOverlays();
  pendingCompletion.value = { action, channel };
  completionConfirmOpen.value = true;
}

async function confirmCompletion() {
  const pending = pendingCompletion.value;
  closeCompletionConfirm();
  if (pending) await dispatch(pending.action, pending.channel);
}

function closeCompletionConfirm() {
  completionConfirmOpen.value = false;
  pendingCompletion.value = null;
}

function toggleSpeech() {
  const presentation = snapshot.value?.current?.presentation;
  if (!presentation) return;
  if (ttsState.value === "speaking") {
    browserTts.pause();
    return;
  }
  if (ttsState.value === "paused") {
    browserTts.resume();
    return;
  }
  if (!browserTts.speak(presentation.text, presentation.locale || "it-IT")) {
    notice.value = "Sintesi vocale non supportata dal browser";
  }
}

function cancelVoice() {
  voiceSequence += 1;
  browserControlledVoice.stop();
  voiceBusy.value = false;
  voiceSheetOpen.value = false;
  notice.value = "Ascolto annullato";
}

async function listenControlledVoice() {
  if (!snapshot.value || voiceBusy.value) return;
  if (!browserControlledVoice.supported) {
    notice.value = "Il browser non supporta il riconoscimento vocale; usa i bottoni equivalenti.";
    return;
  }
  const requestId = ++voiceSequence;
  voiceBusy.value = true;
  voiceSheetOpen.value = true;
  actionSheetOpen.value = false;
  error.value = null;
  try {
    const result = await browserControlledVoice.listen(
      snapshot.value.availableActions,
      snapshot.value.current?.presentation.locale || "it-IT",
    );
    if (requestId !== voiceSequence) return;
    voiceSheetOpen.value = false;
    if (!result.action) {
      notice.value = result.transcript
        ? "Comando non disponibile o ambiguo: “" + result.transcript + "”"
        : "Nessun comando riconosciuto";
      return;
    }
    notice.value = "Comando riconosciuto: “" + result.transcript + "”";
    requestAction(result.action, "controlled_voice");
  } catch (cause) {
    if (requestId !== voiceSequence) return;
    voiceSheetOpen.value = false;
    error.value = cause instanceof Error ? cause.message : "Comando vocale non disponibile";
  } finally {
    if (requestId === voiceSequence) voiceBusy.value = false;
  }
}
</script>

<template>
  <main class="session-experience">
    <header class="session-header">
      <RouterLink class="session-back" :to="{ name: 'museum-library', params: { venueId } }" aria-label="Torna alle visite">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="m15 18-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </RouterLink>
      <div class="session-brand">
        <img v-if="config?.branding.logo" :src="config.branding.logo.src" alt="" width="36" height="36">
        <span>
          <strong>{{ config?.branding.productTitle || "ArtAround" }}</strong>
          <small>{{ config?.branding.museumTitle }}</small>
        </span>
      </div>
      <button
        class="session-menu"
        type="button"
        aria-label="Apri opzioni visita"
        :disabled="!snapshot || !hasActionSheetActions"
        @click="actionSheetOpen = true"
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7" fill="currentColor"/>
          <circle cx="12" cy="12" r="1.7" fill="currentColor"/>
          <circle cx="19" cy="12" r="1.7" fill="currentColor"/>
        </svg>
      </button>
    </header>

    <section v-if="snapshot" class="session-progress" aria-label="Avanzamento visita">
      <div>
        <span>{{ progressLabel }}</span>
        <span>{{ sessionStatusLabel }}</span>
      </div>
      <div class="progress-track" aria-hidden="true">
        <span :style="{ width: progressPercent + '%' }"></span>
      </div>
    </section>

    <div v-if="snapshot && !isCompleted" class="view-tabs" role="tablist" aria-label="Vista visita">
      <button type="button" role="tab" :aria-selected="activeView === 'content'" aria-controls="session-content-panel" @click="activeView = 'content'">Contenuto</button>
      <button type="button" role="tab" :aria-selected="activeView === 'map'" aria-controls="session-map-panel" :disabled="!map?.venues.length" @click="activeView = 'map'">Mappa</button>
    </div>

    <p v-if="error" class="session-feedback error-feedback" role="alert">{{ error }}</p>
    <p v-else-if="notice" class="session-feedback" role="status" aria-live="polite">{{ notice }}</p>

    <div class="session-scroll">
      <p v-if="!snapshot && !error" class="session-loading">Preparazione della visita…</p>

      <section v-else-if="snapshot && isCompleted" class="completion-state">
        <span aria-hidden="true">✓</span>
        <p class="eyebrow">Sessione {{ sessionStatusLabel }}</p>
        <h1>La visita è terminata</h1>
        <p>Puoi tornare alla tua raccolta oppure iniziare un’altra visita.</p>
        <RouterLink class="completion-link" :to="{ name: 'museum-library', params: { venueId } }">Torna alle mie visite</RouterLink>
      </section>

      <template v-else-if="snapshot?.current">
        <section v-show="activeView === 'content'" id="session-content-panel" class="content-panel" role="tabpanel">
          <p v-if="physicalContext" class="physical-context">
            <span aria-hidden="true"></span>{{ physicalContext }}
            <em v-if="isSemantic">Approfondimento</em>
          </p>
          <h1>{{ displayTitle }}</h1>
          <p v-if="displaySubtitle" class="content-label">{{ displaySubtitle }}</p>

          <figure v-if="currentMedia" class="content-media">
            <button type="button" aria-label="Apri l'immagine a schermo intero" @click="mediaOpen = true">
              <img :src="currentMedia.url" :alt="currentMedia.altText" :width="currentMedia.width || undefined" :height="currentMedia.height || undefined">
            </button>
            <figcaption v-if="mediaAttribution || mediaSourceUrl">
              <span v-if="mediaAttribution">{{ mediaAttribution }}</span>
              <a v-if="mediaSourceUrl" :href="mediaSourceUrl" target="_blank" rel="noreferrer">Fonte dell'immagine</a>
            </figcaption>
          </figure>

          <section class="audio-panel" aria-label="Lettura del contenuto">
            <button class="audio-toggle" type="button" :aria-label="audioButtonLabel" :aria-pressed="ttsState !== 'idle'" :disabled="!browserTts.supported" @click="toggleSpeech">
              <svg v-if="ttsState === 'speaking'" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor"/>
                <rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                <path d="M8 5.6v12.8L18 12 8 5.6Z" fill="currentColor"/>
              </svg>
            </button>
            <div>
              <strong>{{ audioTitle }}</strong>
              <span>{{ audioDetail }}</span>
            </div>
            <button v-if="ttsState !== 'idle'" class="audio-stop" type="button" @click="browserTts.stop()">Ferma</button>
          </section>
          <p v-if="!browserTts.supported" class="capability-note">Sintesi vocale non disponibile in questo browser.</p>

          <p class="presentation-copy">{{ snapshot.current.presentation.text }}</p>

          <template v-if="quickActions.length">
            <h2 class="quick-title">Adatta il racconto</h2>
            <div class="quick-actions">
              <button v-for="action in quickActions" :key="action.actionId" type="button" :disabled="interactionBusy" @click="requestAction(action)">{{ busyActionId === action.actionId ? "…" : action.label }}</button>
            </div>
          </template>

          <button v-if="hasActionSheetActions" class="all-actions" type="button" @click="actionSheetOpen = true">Tutte le azioni disponibili</button>
        </section>

        <section v-show="activeView === 'map'" id="session-map-panel" class="map-panel" role="tabpanel">
          <SessionMap v-if="map?.venues.length" :map="map" :navigation="navigation" :current-visit-anchor-id="currentAnchorId" />
          <p v-else>La mappa della visita non è disponibile.</p>
        </section>
      </template>

      <p v-else-if="snapshot">La sessione non contiene un contenuto corrente.</p>
    </div>

    <nav v-if="snapshot && !isCompleted" class="session-bottom" aria-label="Avanzamento della visita">
      <button v-if="previousAction" class="progress-action previous-action" type="button" :disabled="interactionBusy" @click="requestAction(previousAction)">← {{ previousAction.label }}</button>
      <span v-else aria-hidden="true"></span>

      <button class="voice-action" type="button" aria-label="Usa un comando vocale" :disabled="interactionBusy || !browserControlledVoice.supported || !snapshot.availableActions.length" @click="listenControlledVoice">
        <svg viewBox="0 0 24 24" width="27" height="27" aria-hidden="true">
          <rect x="8" y="3" width="8" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>

      <button v-if="nextAction" class="progress-action next-action" type="button" :disabled="interactionBusy" @click="requestAction(nextAction)">{{ nextAction.label }} →</button>
      <span v-else aria-hidden="true"></span>
    </nav>

    <div v-if="mediaOpen && currentMedia" class="modal-overlay media-overlay" @click.self="mediaOpen = false">
      <figure class="media-lightbox" role="dialog" aria-modal="true" aria-label="Immagine del contenuto">
        <button type="button" aria-label="Chiudi immagine" @click="mediaOpen = false">×</button>
        <img :src="currentMedia.originalUrl || currentMedia.url" :alt="currentMedia.altText">
        <figcaption>
          <span>{{ currentMedia.altText }}</span>
          <small v-if="mediaAttribution">{{ mediaAttribution }}</small>
        </figcaption>
      </figure>
    </div>

    <SessionActionSheet :open="actionSheetOpen" :groups="actionGroups" :busy-action-id="busyActionId" :interaction-busy="interactionBusy" @close="actionSheetOpen = false" @select="requestAction" />

    <div v-if="voiceSheetOpen" class="modal-overlay" @click.self="cancelVoice">
      <section class="voice-sheet" role="dialog" aria-modal="true" aria-labelledby="voice-title">
        <div class="voice-orb" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="34" height="34">
            <rect x="8" y="3" width="8" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>
        <h2 id="voice-title">Ti ascolto…</h2>
        <p>Pronuncia uno dei comandi disponibili</p>
        <div class="voice-examples" aria-label="Esempi di comandi disponibili">
          <span v-for="action in voiceExamples" :key="action.actionId">“{{ action.label }}”</span>
        </div>
        <button type="button" @click="cancelVoice">Annulla</button>
      </section>
    </div>

    <div v-if="semanticChoices.length" class="modal-overlay" @click.self="semanticChoices = []">
      <section class="confirm-sheet semantic-choice-sheet" role="dialog" aria-modal="true" aria-labelledby="semantic-choice-title">
        <p class="eyebrow">Approfondimento</p>
        <h2 id="semantic-choice-title">Quale contenuto vuoi aprire?</h2>
        <p>La relazione porta a più risultati ugualmente validi. Scegli esplicitamente quello che ti interessa.</p>
        <div class="semantic-choice-list">
          <button v-for="choice in semanticChoices" :key="choice.actionId" type="button" :disabled="interactionBusy" @click="requestAction(choice)">{{ choice.label }}</button>
        </div>
        <button class="semantic-choice-cancel" type="button" @click="semanticChoices = []">Annulla</button>
      </section>
    </div>

    <div v-if="completionConfirmOpen" class="modal-overlay" @click.self="closeCompletionConfirm">
      <section class="confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="completion-title">
        <p class="eyebrow">Conferma richiesta</p>
        <h2 id="completion-title">Terminare la visita?</h2>
        <p>La sessione verrà completata e non comparirà più tra quelle da riprendere.</p>
        <div>
          <button ref="completionCancelButton" type="button" @click="closeCompletionConfirm">Continua la visita</button>
          <button class="confirm-completion" type="button" @click="confirmCompletion">Termina visita</button>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.session-experience { position:relative;width:min(100%,52rem);height:100dvh;min-height:0;max-height:100dvh;display:flex;flex-direction:column;margin:0 auto;overflow:hidden;color:var(--navigator-ink);background:var(--navigator-surface);box-shadow:0 0 42px var(--navigator-shadow);overscroll-behavior:none }
.session-header{min-height:68px;display:grid;grid-template-columns:46px minmax(0,1fr) 46px;align-items:center;gap:.55rem;padding:max(.55rem,env(safe-area-inset-top)) 1rem .45rem}
.session-back,.session-menu{width:44px;height:44px;padding:0;display:grid;place-items:center;border:0;border-radius:.8rem;color:var(--navigator-ink);background:transparent}.session-back:hover,.session-menu:hover{background:color-mix(in srgb,var(--navigator-primary) 9%,transparent)}
.session-brand{min-width:0;display:flex;align-items:center;justify-content:center;gap:.55rem}.session-brand img{flex:0 0 auto;border-radius:.55rem}.session-brand span{min-width:0;display:grid}.session-brand strong{color:var(--navigator-primary);font-family:Georgia,"Times New Roman",serif;font-size:1rem;font-weight:600;text-align:left}.session-brand small{max-width:20rem;overflow:hidden;color:var(--navigator-muted);font-size:.62rem;font-weight:740;letter-spacing:.05em;text-overflow:ellipsis;text-transform:uppercase;white-space:nowrap}
.session-progress{padding:.25rem 1.25rem .7rem}.session-progress>div:first-child{display:flex;justify-content:space-between;gap:1rem;color:var(--navigator-muted);font-size:.72rem;font-weight:740}.progress-track{height:4px;margin-top:.45rem;overflow:hidden;border-radius:999px;background:var(--navigator-border)}.progress-track span{display:block;height:100%;border-radius:inherit;background:var(--navigator-brand-primary);transition:width .25s ease}
.view-tabs{display:grid;grid-template-columns:1fr 1fr;gap:.25rem;margin:0 1.25rem .65rem;padding:.25rem;border-radius:.85rem;background:color-mix(in srgb,var(--navigator-ink) 8%,transparent)}.view-tabs button{min-height:40px;border:0;border-radius:.68rem;color:var(--navigator-muted);background:transparent;font-weight:750}.view-tabs button[aria-selected="true"]{color:var(--navigator-ink);background:var(--navigator-surface-raised);box-shadow:0 2px 7px var(--navigator-shadow)}
.session-feedback{margin:0 1.25rem .55rem;padding:.65rem .75rem;border:1px solid color-mix(in srgb,var(--navigator-accent) 45%,var(--navigator-border));border-radius:.75rem;color:color-mix(in srgb,var(--navigator-accent) 70%,var(--navigator-ink));background:color-mix(in srgb,var(--navigator-accent) 10%,var(--navigator-surface-raised));font-size:.78rem}.error-feedback{border-color:color-mix(in srgb,#b33138 52%,var(--navigator-border));color:#b33138;background:color-mix(in srgb,#b33138 8%,var(--navigator-surface-raised))}
.session-scroll{min-height:0;flex:1;overflow-y:auto;overscroll-behavior:contain;padding:.35rem 1.25rem calc(7rem + env(safe-area-inset-bottom));scrollbar-width:thin}.content-panel,.map-panel{width:min(100%,44rem);margin:0 auto}
.physical-context{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;margin:.2rem 0;color:var(--navigator-muted);font-size:.75rem;font-weight:720}.physical-context>span{width:.45rem;height:.45rem;border-radius:50%;background:var(--navigator-accent)}.physical-context em{padding:.22rem .45rem;border-radius:999px;color:var(--navigator-primary);background:color-mix(in srgb,var(--navigator-primary) 10%,transparent);font-size:.65rem;font-style:normal;letter-spacing:.04em;text-transform:uppercase}
.content-panel h1{margin:.55rem 0 .25rem;font-family:Georgia,"Times New Roman",serif;font-size:clamp(2rem,8vw,3.3rem);font-weight:500;line-height:1.04;letter-spacing:-.025em}.content-label{margin:0;color:var(--navigator-muted);font-size:.92rem}
.content-media{overflow:hidden;margin:1rem 0 0;border:1px solid var(--navigator-border);border-radius:1.1rem;background:color-mix(in srgb,var(--navigator-ink) 5%,var(--navigator-surface-raised))}.content-media>button{width:100%;max-height:35vh;display:grid;place-items:center;padding:0;border:0;background:transparent;cursor:zoom-in}.content-media img{display:block;width:100%;height:auto;max-height:35vh;object-fit:contain}.content-media figcaption{display:flex;align-items:center;justify-content:space-between;gap:.6rem;padding:.55rem .7rem;border-top:1px solid var(--navigator-border);color:var(--navigator-muted);background:var(--navigator-surface-raised);font-size:.68rem}.content-media figcaption a{flex:0 0 auto;color:var(--navigator-primary);font-weight:760}
.audio-panel{display:grid;grid-template-columns:56px minmax(0,1fr) auto;align-items:center;gap:.8rem;margin:1.25rem 0 1.1rem;padding:.75rem;border:1px solid var(--navigator-border);border-radius:1.1rem;background:var(--navigator-surface-raised)}.audio-toggle{width:56px;height:56px;padding:0;display:grid;place-items:center;border:0;border-radius:50%;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);box-shadow:0 6px 16px var(--navigator-shadow)}.audio-panel div{min-width:0;display:grid;gap:.18rem}.audio-panel strong{font-size:.9rem}.audio-panel span{color:var(--navigator-muted);font-size:.74rem}.audio-stop{padding-inline:.45rem;border:0;color:var(--navigator-primary);background:transparent;font-size:.75rem;font-weight:770}.capability-note{margin-top:-.7rem;color:var(--navigator-muted);font-size:.75rem}
.presentation-copy{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(1.12rem,4.5vw,1.35rem);line-height:1.65}.quick-title{margin:1.45rem 0 .55rem;color:var(--navigator-muted);font-family:inherit;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase}.quick-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem}.quick-actions button{min-height:50px;text-align:left;font-size:.84rem;font-weight:720}.all-actions{width:100%;margin-top:.6rem;border:0;color:var(--navigator-primary);background:color-mix(in srgb,var(--navigator-primary) 9%,var(--navigator-surface-raised));font-weight:770}
.session-bottom{position:absolute;z-index:10;left:0;right:0;bottom:0;min-height:84px;display:grid;grid-template-columns:minmax(0,1fr) 72px minmax(0,1fr);align-items:center;gap:.65rem;padding:.7rem 1.1rem max(.9rem,env(safe-area-inset-bottom));border-top:1px solid var(--navigator-border);background:color-mix(in srgb,var(--navigator-surface-raised) 94%,transparent);backdrop-filter:blur(16px)}.progress-action{min-height:50px;padding-inline:.65rem;font-size:.82rem;font-weight:760}.next-action{border-color:var(--navigator-brand-primary);color:var(--navigator-on-primary);background:var(--navigator-brand-primary)}.voice-action{width:66px;height:66px;justify-self:center;padding:0;display:grid;place-items:center;border:5px solid var(--navigator-surface);border-radius:50%;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);box-shadow:0 7px 20px var(--navigator-shadow)}
.modal-overlay{position:fixed;z-index:40;inset:0;display:grid;align-items:end;justify-items:center;padding-top:4rem;background:rgba(7,12,11,.52)}.media-overlay{padding:1rem;background:color-mix(in srgb,#07110e 88%,transparent)}.media-lightbox{position:relative;width:min(100%,48rem);max-height:calc(100dvh - 2rem);display:grid;gap:.65rem;margin:auto;padding:.75rem;border-radius:1rem;background:var(--navigator-surface-raised)}.media-lightbox>button{position:absolute;z-index:1;top:.9rem;right:.9rem;width:42px;height:42px;display:grid;place-items:center;padding:0;border:0;border-radius:50%;color:var(--navigator-ink);background:color-mix(in srgb,var(--navigator-surface-raised) 88%,transparent);box-shadow:0 3px 14px var(--navigator-shadow);font-size:1.7rem}.media-lightbox img{width:100%;max-height:calc(100dvh - 9rem);display:block;object-fit:contain;border-radius:.65rem;background:color-mix(in srgb,var(--navigator-ink) 7%,var(--navigator-surface))}.media-lightbox figcaption{display:grid;gap:.18rem;color:var(--navigator-ink);font-size:.82rem}.media-lightbox figcaption small{color:var(--navigator-muted)}
.voice-sheet,.confirm-sheet{width:min(100%,38rem);padding:1.25rem 1.25rem max(1.5rem,env(safe-area-inset-bottom));border:1px solid var(--navigator-border);border-bottom:0;border-radius:1.6rem 1.6rem 0 0;color:var(--navigator-ink);background:var(--navigator-surface-raised);box-shadow:0 -20px 56px rgba(0,0,0,.3)}.voice-sheet{text-align:center}.voice-orb{width:88px;height:88px;display:grid;place-items:center;margin:.35rem auto 1rem;border-radius:50%;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);box-shadow:0 0 0 13px color-mix(in srgb,var(--navigator-primary) 12%,transparent);animation:listening 1.5s ease-in-out infinite}.voice-sheet h2,.confirm-sheet h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:1.8rem;font-weight:500}.voice-sheet>p,.confirm-sheet>p{color:var(--navigator-muted);font-size:.85rem;line-height:1.45}.voice-examples{display:flex;justify-content:center;gap:.4rem;flex-wrap:wrap;margin:1rem 0}.voice-examples span{padding:.45rem .65rem;border:1px solid var(--navigator-border);border-radius:999px;font-size:.72rem}.confirm-sheet>div{display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-top:1.1rem}.confirm-completion{border-color:#a72e36;color:#fff;background:#a72e36;font-weight:760}
.semantic-choice-sheet .semantic-choice-list{display:grid;grid-template-columns:1fr;gap:.55rem}.semantic-choice-list button{min-height:50px;text-align:left}.semantic-choice-cancel{width:100%;margin-top:.7rem;color:var(--navigator-primary);background:transparent}
.completion-state{width:min(100%,32rem);margin:8vh auto 0;text-align:center}.completion-state>span{width:72px;height:72px;display:grid;place-items:center;margin:0 auto 1rem;border-radius:50%;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);font-size:2rem}.completion-state h1{margin:.25rem 0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(2rem,8vw,3rem);font-weight:500}.completion-state>p:not(.eyebrow){color:var(--navigator-muted)}.completion-link{min-height:48px;display:inline-flex;align-items:center;margin-top:.75rem;padding:0 1rem;border-radius:.75rem;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);font-weight:760;text-decoration:none}.session-loading{margin-top:20vh;color:var(--navigator-muted);text-align:center}
@keyframes listening{0%,100%{transform:scale(1)}50%{transform:scale(1.055)}}
@media (min-width:53rem){.session-experience{border-inline:1px solid var(--navigator-border)}}
@media (max-width:420px){.session-header{padding-inline:.75rem}.session-progress,.session-scroll{padding-inline:1rem}.view-tabs,.session-feedback{margin-inline:1rem}.session-brand small{max-width:12rem}.audio-panel{grid-template-columns:54px minmax(0,1fr) auto}.session-bottom{padding-inline:.8rem}.progress-action{font-size:.76rem}}
@media (max-width:350px){.session-brand img{display:none}.audio-panel{grid-template-columns:52px minmax(0,1fr)}.audio-stop{grid-column:2;justify-self:start}}
</style>