<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { notify } from "../application/uiFeedback";
import { browserTts } from "../capabilities/browserTts";
import { browserControlledVoice } from "../capabilities/controlledVoice";
import type { TextToSpeechState } from "../capabilities";
import {
  actionOfType,
  groupSessionActions,
  presentationDurationLabel,
  quickPresentationActions,
} from "../domain/sessionPresentation";
import { sessionRepository, type AvailableAction, type SessionProjection } from "../infrastructure/http/sessionRepository";
import {
  synchronizedVisitRepository,
  type SynchronizedQuizProjection,
  type SynchronizedVisitProjection,
} from "../infrastructure/http/synchronizedVisitRepository";
import { subscribeToSynchronizedVisit, type SynchronizedRealtimeSubscription } from "../infrastructure/realtime/synchronizedVisitRealtime";
import FeedbackActionDialog from "./FeedbackActionDialog.vue";
import FeedbackCallout from "./FeedbackCallout.vue";
import FeedbackProgressState from "./FeedbackProgressState.vue";
import SessionActionSheet from "./SessionActionSheet.vue";

type InteractionChannel = "button" | "controlled_voice";

const route = useRoute();
const group = ref<SynchronizedVisitProjection | null>(null);
const runtime = ref<SessionProjection | null>(null);
const busy = ref(true);
const actionBusy = ref(false);
const error = ref<string | null>(null);
const quiz = ref<SynchronizedQuizProjection | null>(null);
const quizAnswers = ref<Record<string, number>>({});
const evaluationDrafts = ref<Record<string, string>>({});
const confirmingCancel = ref(false);
const notice = ref<string | null>(null);
const voiceBusy = ref(false);
const voiceSheetOpen = ref(false);
const groupPanelOpen = ref(false);
const actionSheetOpen = ref(false);
const ttsState = ref<TextToSpeechState>(browserTts.state);
const groupPanel = ref<HTMLElement | null>(null);
const groupPanelClose = ref<HTMLButtonElement | null>(null);
const voicePanel = ref<HTMLElement | null>(null);
const voiceCancel = ref<HTMLButtonElement | null>(null);
let refreshTimer: number | null = null;
let realtimeSubscription: SynchronizedRealtimeSubscription | null = null;
let unsubscribeTts: (() => void) | null = null;
let voiceSequence = 0;
let groupReturnFocus: HTMLElement | null = null;
let voiceReturnFocus: HTMLElement | null = null;
const onlineUserIds = ref(new Set<string>());

function modalFocusables(root: HTMLElement | null) {
  if (!root) return [] as HTMLElement[];
  return [...root.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
}

function trapModalFocus(event: KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== "Tab") return;
  const nodes = modalFocusables(root);
  if (!nodes.length) { event.preventDefault(); return; }
  const first = nodes[0];
  const last = nodes.at(-1)!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function syncModalScrollLock() {
  const locked = groupPanelOpen.value || voiceSheetOpen.value;
  document.documentElement.classList.toggle("artaround-layer-open", locked);
  document.body.classList.toggle("artaround-layer-open", locked);
}

watch(groupPanelOpen, async (open) => {
  if (open) {
    groupReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    syncModalScrollLock();
    await nextTick();
    groupPanelClose.value?.focus({ preventScroll: true });
    return;
  }
  syncModalScrollLock();
  groupReturnFocus?.focus?.({ preventScroll: true });
  groupReturnFocus = null;
});

watch(voiceSheetOpen, async (open) => {
  if (open) {
    voiceReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    syncModalScrollLock();
    await nextTick();
    voiceCancel.value?.focus({ preventScroll: true });
    return;
  }
  syncModalScrollLock();
  voiceReturnFocus?.focus?.({ preventScroll: true });
  voiceReturnFocus = null;
});

function onGroupPanelKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    groupPanelOpen.value = false;
    return;
  }
  trapModalFocus(event, groupPanel.value);
}

function onVoicePanelKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelVoice();
    return;
  }
  trapModalFocus(event, voicePanel.value);
}

const synchronizedSessionId = computed(() => String(route.params.synchronizedSessionId || ""));
const isHost = computed(() => group.value?.membership.role === "host");
const groupActions = computed(() => (runtime.value?.availableActions || []).filter((action) =>
  action.runtimeScope === "synchronized_visit_session" || action.family === "progress" || action.family === "synchronization"
));
const personalActions = computed(() => (runtime.value?.availableActions || []).filter((action) => {
  if (action.runtimeScope === "synchronized_visit_session") return false;
  const excludedFamilies = isHost.value
    ? ["progress", "synchronization", "lifecycle", "quiz"]
    : ["progress", "synchronization", "navigation", "lifecycle", "quiz"];
  return !excludedFamilies.includes(action.family);
}));
const voiceActions = computed(() => isHost.value
  ? (runtime.value?.availableActions || []).filter((action) => action.type !== "SYNCHRONIZED_CANCEL")
  : [...personalActions.value, participantPlaybackVoiceAction.value].filter(Boolean) as AvailableAction[]);
const voiceExamples = computed(() => voiceActions.value
  .filter((action) => action.controlledVoiceAliases?.length)
  .slice(0, 3));
const primaryMedia = computed(() => runtime.value?.current?.illustrativeMedia?.[0] || null);
const cancelAction = computed(() => groupActions.value.find((action) => action.type === "SYNCHRONIZED_CANCEL") || null);
const previousAction = computed(() => actionOfType(groupActions.value, "PROGRESS_PREVIOUS"));
const nextAction = computed(() => actionOfType(groupActions.value, "PROGRESS_NEXT"));
const playbackPrimaryAction = computed(() => groupActions.value.find((action) => [
  "SYNCHRONIZED_PLAYBACK_PLAY",
  "SYNCHRONIZED_PLAYBACK_PAUSE",
  "SYNCHRONIZED_PLAYBACK_RESUME",
].includes(action.type)) || null);
const playbackStopAction = computed(() => actionOfType(groupActions.value, "SYNCHRONIZED_PLAYBACK_STOP"));
const groupPanelActions = computed(() => groupActions.value.filter((action) =>
  !["SYNCHRONIZED_CANCEL", "SYNCHRONIZED_PLAYBACK_PLAY", "SYNCHRONIZED_PLAYBACK_PAUSE", "SYNCHRONIZED_PLAYBACK_RESUME", "SYNCHRONIZED_PLAYBACK_STOP"].includes(action.type)
));
const personalActionGroups = computed(() => groupSessionActions(personalActions.value));
const quickActions = computed(() => quickPresentationActions(personalActions.value));
const interactionBusy = computed(() => actionBusy.value || voiceBusy.value);
const currentPresentation = computed(() => runtime.value?.current?.presentation || null);
const audioDetail = computed(() => {
  const presentation = currentPresentation.value;
  if (!presentation) return "";
  return `${presentationDurationLabel(presentation.estimatedContentSeconds)} · ${(presentation.locale || "it-IT").toUpperCase()}`;
});
const audioTitle = computed(() => {
  if (ttsState.value === "speaking") return "Lettura in corso";
  if (ttsState.value === "paused") return "Lettura in pausa";
  return "Ascolta il contenuto";
});
const audioButtonLabel = computed(() => {
  if (ttsState.value === "speaking") return "Metti in pausa";
  if (ttsState.value === "paused") return "Riprendi lettura";
  return "Ascolta il contenuto";
});
const progressLabel = computed(() => {
  const current = (group.value?.synchronizedSession.currentEntryIndex || 0) + 1;
  const total = group.value?.synchronizedSession.contentEntryCount || 0;
  return total ? `Contenuto ${current} di ${total}` : "Visita in corso";
});
const progressPercent = computed(() => {
  const total = group.value?.synchronizedSession.contentEntryCount || 0;
  return total ? Math.min(100, (((group.value?.synchronizedSession.currentEntryIndex || 0) + 1) / total) * 100) : 0;
});
const participantPlaybackVoiceAction = computed<AvailableAction | null>(() => {
  if (isHost.value) return null;
  if (ttsState.value === "speaking") return {
    actionId: "local.playback.pause",
    type: "LOCAL_PLAYBACK_PAUSE",
    family: "playback",
    label: "Metti in pausa",
    controlledVoiceAliases: ["metti in pausa", "pausa lettura"],
  };
  if (ttsState.value === "paused") return {
    actionId: "local.playback.resume",
    type: "LOCAL_PLAYBACK_RESUME",
    family: "playback",
    label: "Riprendi lettura",
    controlledVoiceAliases: ["riprendi lettura", "continua a leggere"],
  };
  return {
    actionId: "local.playback.play",
    type: "LOCAL_PLAYBACK_PLAY",
    family: "playback",
    label: "Ascolta il contenuto",
    controlledVoiceAliases: ["ascolta il contenuto", "avvia la lettura"],
  };
});

let appliedPlaybackSignature = "";
watch(() => [
  group.value?.synchronizedSession.playback.commandVersion || 0,
  group.value?.synchronizedSession.playback.state || "idle",
  group.value?.synchronizedSession.playback.contentEntryId || "",
  runtime.value?.current?.contentEntryId || "",
  runtime.value?.current?.presentation.text || "",
].join(":"), () => applySharedPlayback(), { flush: "post" });

async function refresh({ quiet = false } = {}) {
  if (!quiet) busy.value = true;
  try {
    const projection = await synchronizedVisitRepository.current(synchronizedSessionId.value);
    const current = await sessionRepository.current(projection.membership.visitSessionId);
    group.value = projection;
    runtime.value = current;
    if (["quiz", "completed"].includes(projection.synchronizedSession.status)) {
      quiz.value = await synchronizedVisitRepository.quiz(synchronizedSessionId.value);
    }
    error.value = null;
  } catch (cause) {
    if (!quiet) error.value = cause instanceof Error ? cause.message : "Visita non disponibile";
  } finally {
    if (!quiet) busy.value = false;
  }
}

async function dispatch(action: AvailableAction, input: unknown = null, interactionChannel: InteractionChannel = "button") {
  if (!runtime.value || interactionBusy.value) return;
  if (action.family !== "playback") browserTts.stop();
  actionBusy.value = true;
  error.value = null;
  notice.value = null;
  try {
    const response = await sessionRepository.dispatchAction(
      group.value!.membership.visitSessionId,
      action.actionId,
      action.runtimeVersion || runtime.value.session.runtimeVersion,
      interactionChannel,
      input,
    );
    runtime.value = response.runtime;
    await refresh({ quiet: true });
    if (action.family === "progress" || action.family === "synchronization") {
      groupPanelOpen.value = false;
      actionSheetOpen.value = false;
    }
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Comando non disponibile";
    await refresh({ quiet: true });
  } finally {
    actionBusy.value = false;
  }
}

function playLocally() {
  const presentation = currentPresentation.value;
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

async function toggleSpeech() {
  if (isHost.value) {
    if (playbackPrimaryAction.value) await dispatch(playbackPrimaryAction.value);
    return;
  }
  playLocally();
}

async function stopSpeech() {
  if (isHost.value && playbackStopAction.value) {
    await dispatch(playbackStopAction.value);
    return;
  }
  browserTts.stop();
}

function applySharedPlayback() {
  const playback = group.value?.synchronizedSession.playback;
  const presentation = currentPresentation.value;
  const currentContentEntryId = runtime.value?.current?.contentEntryId || null;
  if (!playback || !presentation) return;
  const signature = [playback.commandVersion, playback.state, playback.contentEntryId || "", currentContentEntryId || "", presentation.text].join(":");
  if (signature === appliedPlaybackSignature) return;
  appliedPlaybackSignature = signature;

  if (playback.state === "idle" || String(playback.contentEntryId || "") !== String(currentContentEntryId || "")) {
    browserTts.stop();
    return;
  }
  if (playback.state === "paused") {
    if (ttsState.value === "speaking") browserTts.pause();
    else browserTts.stop();
    return;
  }
  if (ttsState.value === "paused") browserTts.resume();
  else if (!browserTts.speak(presentation.text, presentation.locale || "it-IT")) {
    notice.value = isHost.value
      ? "Sintesi vocale non supportata dal browser"
      : "La guida ha avviato l’ascolto. Tocca “Ascolta il contenuto” per abilitarlo su questo dispositivo.";
  } else if (!isHost.value) {
    notice.value = null;
    notify.info("La guida ha avviato l’ascolto.");
  }
}

function cancelVoice() {
  voiceSequence += 1;
  browserControlledVoice.stop();
  voiceBusy.value = false;
  voiceSheetOpen.value = false;
  notice.value = null;
  notify.info("Ascolto annullato");
}

async function listenControlledVoice() {
  if (!runtime.value || interactionBusy.value) return;
  if (!browserControlledVoice.supported) {
    notice.value = "Il browser non supporta il riconoscimento vocale; usa i bottoni equivalenti.";
    return;
  }
  const requestId = ++voiceSequence;
  voiceBusy.value = true;
  voiceSheetOpen.value = true;
  error.value = null;
  notice.value = null;
  try {
    const result = await browserControlledVoice.listen(
      voiceActions.value,
      currentPresentation.value?.locale || "it-IT",
    );
    if (requestId !== voiceSequence) return;
    voiceSheetOpen.value = false;
    if (!result.action) {
      notice.value = null;
      notify.warning(result.transcript
        ? `Comando non disponibile: “${result.transcript}”`
        : "Nessun comando riconosciuto");
      return;
    }
    notice.value = null;
    notify.info(`Comando riconosciuto: “${result.transcript}”`);
    voiceBusy.value = false;
    if (result.action.type.startsWith("LOCAL_PLAYBACK_")) playLocally();
    else await dispatch(result.action, null, "controlled_voice");
  } catch (cause) {
    if (requestId !== voiceSequence) return;
    voiceSheetOpen.value = false;
    error.value = cause instanceof Error ? cause.message : "Comando vocale non disponibile";
  } finally {
    if (requestId === voiceSequence) voiceBusy.value = false;
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  if (voiceSheetOpen.value) cancelVoice();
  else if (groupPanelOpen.value) groupPanelOpen.value = false;
  else actionSheetOpen.value = false;
}

async function submitQuiz() {
  if (!quiz.value || quiz.value.role !== "participant") return;
  const action = runtime.value?.availableActions.find((entry) => entry.type === "SYNCHRONIZED_SUBMIT_QUIZ");
  if (!action) return;
  await dispatch(action, {
    answers: quiz.value.questions.map((question) => ({
      questionId: question.id,
      selectedOptionIndex: quizAnswers.value[question.id],
    })),
  });
}

async function confirmEvaluation(userId: string) {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    await synchronizedVisitRepository.confirmEvaluation(synchronizedSessionId.value, userId, evaluationDrafts.value[userId] || "");
    quiz.value = await synchronizedVisitRepository.quiz(synchronizedSessionId.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Valutazione non salvata";
  } finally { actionBusy.value = false; }
}

async function cancelSession() {
  if (!cancelAction.value || interactionBusy.value) return;
  await dispatch(cancelAction.value);
  confirmingCancel.value = false;
  groupPanelOpen.value = false;
}

onMounted(async () => {
  unsubscribeTts = browserTts.subscribe((state) => { ttsState.value = state; });
  window.addEventListener("keydown", handleKeydown);
  await refresh();
  realtimeSubscription = subscribeToSynchronizedVisit({
    sessionId: synchronizedSessionId.value,
    onInvalidated: () => refresh({ quiet: true }),
    onPresenceSnapshot: (values) => { onlineUserIds.value = new Set(values); },
    onPresence: ({ userId, online }) => {
      const next = new Set(onlineUserIds.value);
      if (online) next.add(String(userId)); else next.delete(String(userId));
      onlineUserIds.value = next;
    },
  });
  // Fallback lento: dopo reconnect o notifiche perse si rilegge comunque la
  // projection REST, che resta l'unica source of truth applicativa.
  refreshTimer = window.setInterval(() => refresh({ quiet: true }), 15000);
});
onUnmounted(() => {
  voiceSequence += 1;
  unsubscribeTts?.();
  browserTts.stop();
  browserControlledVoice.stop();
  window.removeEventListener("keydown", handleKeydown);
  if (refreshTimer != null) window.clearInterval(refreshTimer);
  realtimeSubscription?.close();
  document.documentElement.classList.remove("artaround-layer-open");
  document.body.classList.remove("artaround-layer-open");
});
</script>

<template>
  <main :class="group?.synchronizedSession.status === 'active' ? 'session-experience' : 'together-page'">
    <FeedbackProgressState v-if="busy" class="full-state" tone="info">Sto preparando la visita…</FeedbackProgressState>
    <FeedbackCallout v-else-if="error && !group" class="full-state" tone="danger" semantic-role="alert">{{ error }}</FeedbackCallout>
    <template v-else-if="group && runtime">
      <header v-if="group.synchronizedSession.status !== 'active'" class="together-header">
        <div>
          <p class="eyebrow">Visita sincronizzata</p>
          <h1>{{ group.synchronizedSession.title }}</h1>
        </div>
        <div class="role-pill">{{ isHost ? "Vista guida" : "Partecipante" }}</div>
      </header>

      <header v-else class="session-header">
        <RouterLink class="session-back" :to="{ name: 'museums' }" aria-label="Torna al Navigator">←</RouterLink>
        <div class="session-brand">
          <span><strong>{{ group.synchronizedSession.title }}</strong><small>{{ isHost ? "Visita sincronizzata · Guida" : "Visita sincronizzata · Partecipante" }}</small></span>
        </div>
        <button v-if="isHost" class="group-control-button" type="button" aria-label="Apri controllo del gruppo" :aria-expanded="groupPanelOpen" @click="groupPanelOpen = true">
          <span aria-hidden="true">{{ group.synchronizedSession.participantCount }}</span>
          <em>Gruppo</em>
        </button>
        <span v-else class="participant-role" aria-label="Vista partecipante">Insieme</span>
      </header>

      <section v-if="group.synchronizedSession.status === 'active'" class="session-progress" aria-label="Avanzamento visita">
        <div><span>{{ progressLabel }}</span><span>{{ isHost ? 'Controlli della guida' : 'Segue la guida' }}</span></div>
        <div class="progress-track" aria-hidden="true"><span :style="{ width: progressPercent + '%' }"></span></div>
      </section>

      <FeedbackCallout v-if="error" class="inline-feedback" tone="danger" semantic-role="alert">{{ error }}</FeedbackCallout>
      <FeedbackCallout v-else-if="notice" class="inline-feedback" tone="warning" semantic-role="status">{{ notice }}</FeedbackCallout>

      <section v-if="group.synchronizedSession.status === 'lobby'" class="lobby-card">
        <template v-if="isHost">
          <p class="eyebrow">Fai entrare il gruppo</p>
          <h2>Mostra queste parole</h2>
          <div class="alias" aria-label="Alias della visita">{{ group.synchronizedSession.joinAlias }}</div>
          <p>Gli studenti aprono “Entra in una visita” e scrivono l’alias. Poi puoi iniziare.</p>
          <div class="participant-count"><strong>{{ group.synchronizedSession.participantCount }}</strong><span>partecipanti pronti</span></div>
          <ul v-if="group.participants?.length" class="participant-list">
            <li v-for="participant in group.participants" :key="participant.userId">
              <span class="avatar">{{ participant.username.slice(0, 1).toUpperCase() }}</span>
              <strong>{{ participant.username }}</strong>
              <small>{{ participant.role === 'host' ? 'Guida' : onlineUserIds.has(String(participant.userId)) ? 'Online' : 'Entrato' }}</small>
            </li>
          </ul>
          <button
            v-for="action in groupActions.filter((entry) => entry.type === 'SYNCHRONIZED_START')"
            :key="action.actionId"
            class="primary-action"
            type="button"
            :disabled="actionBusy"
            @click="dispatch(action)"
          >{{ actionBusy ? "Avvio…" : action.label }}</button>
        </template>
        <template v-else>
          <div class="waiting-symbol" aria-hidden="true">✓</div>
          <p class="eyebrow">Sei dentro</p>
          <h2>Aspettiamo la guida</h2>
          <p>La visita inizierà qui. Puoi lasciare aperta questa schermata.</p>
          <div class="waiting-dots" aria-hidden="true"><span></span><span></span><span></span></div>
        </template>
      </section>

      <section v-else-if="group.synchronizedSession.status === 'active'" class="active-session-body">
        <div class="session-scroll">
          <article v-if="runtime.current" class="content-panel">
            <p class="physical-context"><span aria-hidden="true"></span>{{ isHost ? "Contenuto condiviso con il gruppo" : "La guida sta presentando" }}</p>
            <h1>{{ runtime.current.label || "Contenuto in arrivo" }}</h1>

            <figure v-if="primaryMedia" class="content-media">
              <img :src="primaryMedia.url" :alt="primaryMedia.altText || ''">
            </figure>

            <section v-if="currentPresentation" class="audio-panel" aria-label="Lettura del contenuto">
              <button class="audio-toggle" type="button" :aria-label="audioButtonLabel" :aria-pressed="ttsState !== 'idle'" :disabled="interactionBusy || !browserTts.supported || (isHost && !playbackPrimaryAction)" @click="toggleSpeech">
                <svg v-if="ttsState === 'speaking'" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><rect x="7" y="6" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="13.5" y="6" width="3.5" height="12" rx="1" fill="currentColor"/></svg>
                <svg v-else viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M8 5.6v12.8L18 12 8 5.6Z" fill="currentColor"/></svg>
              </button>
              <div><strong>{{ audioTitle }}</strong><span>{{ isHost ? 'Riproduzione sincronizzata · ' : '' }}{{ audioDetail }}</span></div>
              <button v-if="ttsState !== 'idle' || playbackStopAction" class="audio-stop" type="button" :disabled="interactionBusy" @click="stopSpeech">Ferma</button>
            </section>
            <p v-if="!browserTts.supported" class="capability-note">Sintesi vocale non disponibile in questo browser.</p>

            <p class="presentation-copy">{{ runtime.current.presentation.text }}</p>

            <template v-if="quickActions.length">
              <h2 class="quick-title">Adatta il racconto</h2>
              <div class="quick-actions">
                <button v-for="action in quickActions" :key="action.actionId" type="button" :disabled="interactionBusy" @click="dispatch(action)">{{ action.label }}</button>
              </div>
            </template>
            <button v-if="personalActions.length" class="all-actions" type="button" :disabled="interactionBusy" @click="actionSheetOpen = true">Tutte le azioni disponibili</button>
            <p v-if="!isHost" class="participant-note">La guida sceglie quando passare al prossimo contenuto.</p>
          </article>
          <p v-else class="session-loading">Il contenuto corrente non è disponibile.</p>
        </div>

        <nav class="session-bottom" aria-label="Comandi della visita">
          <button v-if="isHost && previousAction" class="progress-action previous-action" type="button" :disabled="interactionBusy" @click="dispatch(previousAction)">← {{ previousAction.label }}</button>
          <span v-else aria-hidden="true"></span>
          <button class="voice-action" type="button" aria-label="Usa un comando vocale" :disabled="interactionBusy || !browserControlledVoice.supported || !voiceActions.length" @click="listenControlledVoice">
            <svg viewBox="0 0 24 24" width="27" height="27" aria-hidden="true"><rect x="8" y="3" width="8" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
          <button v-if="isHost && nextAction" class="progress-action next-action" type="button" :disabled="interactionBusy" @click="dispatch(nextAction)">{{ nextAction.label }} →</button>
          <span v-else aria-hidden="true"></span>
        </nav>
      </section>

      <section v-else-if="group.synchronizedSession.status === 'quiz'" class="quiz-card">
        <template v-if="quiz?.role === 'participant'">
          <div v-if="quiz.attempt" class="quiz-result">
            <div class="waiting-symbol" aria-hidden="true">✓</div>
            <p class="eyebrow">Risposte inviate</p>
            <h2>Hai ottenuto {{ quiz.attempt.score }} su {{ quiz.attempt.maxScore }}</h2>
            <p>La guida può vedere il risultato. Puoi aspettare qui la conclusione.</p>
          </div>
          <form v-else class="quiz-form" @submit.prevent="submitQuiz">
            <div class="quiz-heading"><p class="eyebrow">Quiz finale</p><h2>Scegli una risposta</h2><p>Leggi con calma: serve una risposta per ogni domanda.</p></div>
            <fieldset v-for="(question, questionIndex) in quiz.questions" :key="question.id">
              <legend><span>{{ questionIndex + 1 }}</span>{{ question.question }}</legend>
              <label v-for="(option, optionIndex) in question.options" :key="optionIndex" class="quiz-choice">
                <input v-model.number="quizAnswers[question.id]" type="radio" :name="`question-${question.id}`" :value="optionIndex">
                <span>{{ option }}</span>
              </label>
            </fieldset>
            <button class="primary-action" type="submit" :disabled="actionBusy || quiz.questions.some((question) => quizAnswers[question.id] === undefined)">{{ actionBusy ? 'Invio…' : 'Invia le risposte' }}</button>
          </form>
        </template>
        <template v-else-if="quiz?.role === 'host'">
          <div class="quiz-heading"><p class="eyebrow">Risultati in diretta</p><h2>{{ quiz.submittedCount }} di {{ quiz.participantCount }} hanno risposto</h2></div>
          <div class="quiz-results">
            <article v-for="result in quiz.results" :key="result.userId">
              <div><strong>{{ result.username }}</strong><small>{{ result.status === 'submitted' ? `${result.score} su ${result.maxScore}` : 'In attesa' }}</small></div>
              <form v-if="result.status === 'submitted'" @submit.prevent="confirmEvaluation(result.userId)">
                <input v-model="evaluationDrafts[result.userId]" :placeholder="result.evaluation?.value || 'Valutazione facoltativa'">
                <button type="submit" :disabled="actionBusy">{{ result.evaluation?.confirmedByHost ? 'Aggiorna' : 'Conferma' }}</button>
              </form>
            </article>
          </div>
          <button v-for="action in groupActions.filter((entry) => entry.type !== 'SYNCHRONIZED_CANCEL')" :key="action.actionId" class="primary-action" type="button" :disabled="actionBusy" @click="dispatch(action)">{{ action.label }}</button>
        </template>
      </section>

      <section v-else class="lobby-card">
        <div class="waiting-symbol" aria-hidden="true">✓</div>
        <p class="eyebrow">Visita conclusa</p>
        <h2>Grazie per aver partecipato</h2>
        <RouterLink class="primary-link" :to="{ name: 'museums' }">Torna al Navigator</RouterLink>
      </section>

      <section v-if="isHost && cancelAction && group.synchronizedSession.status !== 'active'" class="cancel-session" aria-labelledby="cancel-session-title">
        <div><strong id="cancel-session-title">Gestione sessione</strong><p>I partecipanti non potranno più rientrare dopo l’annullamento.</p></div>
        <button type="button" :disabled="actionBusy" @click="confirmingCancel = true">Annulla questa sessione</button>
      </section>

      <FeedbackActionDialog
        :open="confirmingCancel"
        tone="danger"
        :dismissible="!actionBusy"
        title="Annullare la sessione sincronizzata?"
        message="La sessione verrà chiusa per tutti e i partecipanti non potranno più rientrare con questo alias."
        :confirm-label="actionBusy ? 'Annullamento…' : 'Sì, annulla'"
        cancel-label="Continua la visita"
        @cancel="confirmingCancel = false"
        @confirm="cancelSession"
      />

      <SessionActionSheet
        :open="actionSheetOpen"
        :groups="personalActionGroups"
        :busy-action-id="actionBusy ? 'busy' : null"
        :interaction-busy="interactionBusy"
        @close="actionSheetOpen = false"
        @select="dispatch"
      />

      <Teleport to="body">
        <div v-if="groupPanelOpen && isHost" class="modal-overlay group-overlay" @click.self="groupPanelOpen = false" @keydown="onGroupPanelKeydown">
        <section ref="groupPanel" class="group-sheet" role="dialog" aria-modal="true" aria-labelledby="group-panel-title">
          <header>
            <div><p class="eyebrow">Controllo del gruppo</p><h2 id="group-panel-title">{{ group.synchronizedSession.participantCount }} partecipanti</h2></div>
            <button ref="groupPanelClose" type="button" aria-label="Chiudi controllo del gruppo" @click="groupPanelOpen = false">×</button>
          </header>
          <div class="group-sheet-scroll">
            <ul class="participant-list compact">
              <li v-for="participant in group.participants?.filter((entry) => entry.role === 'participant')" :key="participant.userId">
                <span class="avatar">{{ participant.username.slice(0, 1).toUpperCase() }}</span>
                <strong>{{ participant.username }}</strong>
                <small>{{ onlineUserIds.has(String(participant.userId)) ? 'Online' : 'Offline' }} · {{ participant.experience?.status === 'completed' ? 'Completato' : participant.experience?.status === 'in_progress' ? 'Sta seguendo' : 'Non iniziato' }}<template v-if="participant.experience?.personalAdaptationActive"> · Adattamento personale</template></small>
              </li>
            </ul>
            <p v-if="!group.synchronizedSession.participantCount" class="empty-participants">Nessun partecipante è ancora collegato.</p>
          </div>
          <div v-if="groupPanelActions.length" class="host-actions group-sheet-actions">
            <button v-for="action in groupPanelActions" :key="action.actionId" type="button" :class="{ primary: action.type === 'SYNCHRONIZED_START_QUIZ' }" :disabled="interactionBusy" @click="dispatch(action)">{{ action.label }}</button>
          </div>
          <div class="group-danger">
            <button type="button" :disabled="interactionBusy" @click="confirmingCancel = true">Annulla questa sessione</button>
          </div>
        </section>
        </div>
      </Teleport>

      <Teleport to="body">
        <div v-if="voiceSheetOpen" class="modal-overlay" @click.self="cancelVoice" @keydown="onVoicePanelKeydown">
        <section ref="voicePanel" class="voice-sheet" role="dialog" aria-modal="true" aria-labelledby="voice-title">
          <div class="voice-orb" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="34" height="34">
              <rect x="8" y="3" width="8" height="12" rx="4" fill="none" stroke="currentColor" stroke-width="2"/>
              <path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </div>
          <h2 id="voice-title">Ti ascolto…</h2>
          <p>Pronuncia uno dei comandi disponibili</p>
          <div class="voice-examples" aria-label="Esempi di comandi disponibili">
            <span v-for="action in voiceExamples" :key="action.actionId">“{{ action.controlledVoiceAliases[0] || action.label }}”</span>
          </div>
          <button ref="voiceCancel" type="button" @click="cancelVoice">Annulla</button>
        </section>
        </div>
      </Teleport>
    </template>
  </main>
</template>

<style scoped>
.together-page{min-height:100vh;width:min(100%,78rem);margin:auto;padding:clamp(1rem,3vw,2rem)}.full-state{margin:20vh auto;padding:1rem;text-align:center}.together-header{display:flex;justify-content:space-between;gap:1rem;align-items:center;margin-bottom:1rem}.together-header h1{margin:.15rem 0 0}.role-pill{padding:.5rem .75rem;border-radius:999px;background:color-mix(in srgb,var(--navigator-brand-primary) 12%,var(--navigator-surface-raised));font-weight:800}.inline-error{padding:.7rem 1rem;border-radius:.8rem;background:#fbe9e8;color:#9f2f36}.lobby-card{min-height:min(38rem,75vh);display:grid;place-items:center;align-content:center;gap:.8rem;padding:clamp(1.5rem,6vw,4rem);border:1px solid var(--navigator-border);border-radius:1.6rem;background:var(--navigator-surface-raised);box-shadow:0 18px 48px var(--navigator-shadow);text-align:center}.lobby-card h2,.lobby-card p{margin:0}.lobby-card>p:not(.eyebrow){max-width:36rem;color:var(--navigator-muted);font-size:1.05rem}.alias{padding:.7rem 1.2rem;border:2px solid var(--navigator-brand-primary);border-radius:1rem;background:color-mix(in srgb,var(--navigator-brand-primary) 8%,var(--navigator-surface));font-size:clamp(1.8rem,6vw,3.4rem);font-weight:900;letter-spacing:.02em}.participant-count{display:flex;align-items:baseline;gap:.5rem}.participant-count strong{font-size:2rem}.participant-list{width:min(100%,34rem);display:grid;gap:.45rem;margin:.4rem 0;padding:0;list-style:none}.participant-list li{display:grid;grid-template-columns:auto 1fr auto;gap:.65rem;align-items:center;padding:.65rem;border:1px solid var(--navigator-border);border-radius:.75rem;text-align:left}.avatar{display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;background:var(--navigator-brand-primary);color:#fff;font-weight:850}.participant-list small{color:var(--navigator-muted)}.primary-action,.primary-link{min-height:3rem;padding:.75rem 1.2rem;border:0;border-radius:.8rem;background:var(--navigator-brand-primary);color:#fff;font:inherit;font-weight:850;text-decoration:none}.waiting-symbol{display:grid;place-items:center;width:4.5rem;height:4.5rem;border-radius:50%;background:var(--navigator-brand-primary);color:#fff;font-size:2rem}.waiting-dots{display:flex;gap:.35rem;margin-top:.8rem}.waiting-dots span{width:.65rem;height:.65rem;border-radius:50%;background:var(--navigator-brand-primary);animation:pulse 1.2s infinite}.waiting-dots span:nth-child(2){animation-delay:.2s}.waiting-dots span:nth-child(3){animation-delay:.4s}@keyframes pulse{50%{opacity:.25;transform:translateY(-.2rem)}}.active-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(17rem,24rem);gap:1rem}.content-card,.host-panel{overflow:hidden;border:1px solid var(--navigator-border);border-radius:1.4rem;background:var(--navigator-surface-raised);box-shadow:0 12px 34px var(--navigator-shadow)}.content-card>img{width:100%;max-height:42vh;object-fit:cover}.content-copy{padding:clamp(1.2rem,4vw,2.4rem)}.step-indicator{color:var(--navigator-brand-primary);font-weight:850}.content-copy h2{font-size:clamp(1.7rem,5vw,3rem)}.content-text{font-size:clamp(1.08rem,2.5vw,1.35rem);line-height:1.7}.personal-actions,.host-actions{display:flex;gap:.55rem;flex-wrap:wrap}.personal-actions button,.host-actions button{min-height:2.8rem;padding:.6rem .8rem;border:1px solid var(--navigator-border);border-radius:.75rem;background:var(--navigator-surface);color:var(--navigator-text);font:inherit;font-weight:750}.host-panel{padding:1rem;align-self:start}.host-panel h2{margin:.2rem 0 1rem}.participant-list.compact{max-height:18rem;overflow:auto}.host-actions{margin-top:1rem}.host-actions button.primary{background:var(--navigator-brand-primary);color:#fff}.participant-note{grid-column:1/-1;margin:0;padding:.8rem;border-radius:.8rem;background:color-mix(in srgb,var(--navigator-brand-primary) 8%,var(--navigator-surface-raised));text-align:center}.error{color:#9f2f36}@media(max-width:48rem){.active-layout{grid-template-columns:1fr}.host-panel{order:-1}.together-header{align-items:flex-start;flex-direction:column}.content-card>img{max-height:32vh}}
.quiz-card{display:grid;gap:1rem;padding:clamp(1rem,4vw,2rem);border:1px solid var(--navigator-border);border-radius:1.4rem;background:var(--navigator-surface-raised)}.quiz-heading{text-align:center}.quiz-heading h2,.quiz-heading p{margin:.2rem}.quiz-form{display:grid;gap:1rem}.quiz-form fieldset{display:grid;gap:.55rem;margin:0;padding:1rem;border:1px solid var(--navigator-border);border-radius:1rem}.quiz-form legend{display:flex;gap:.6rem;align-items:center;padding:.25rem;font-size:1.1rem;font-weight:850}.quiz-form legend span{display:grid;place-items:center;width:2rem;height:2rem;border-radius:50%;background:var(--navigator-brand-primary);color:#fff}.quiz-choice{display:flex;gap:.7rem;align-items:center;min-height:3.2rem;padding:.65rem .8rem;border:1px solid var(--navigator-border);border-radius:.75rem;background:var(--navigator-surface);font-size:1.05rem}.quiz-choice:has(input:checked){border-color:var(--navigator-brand-primary);background:color-mix(in srgb,var(--navigator-brand-primary) 9%,var(--navigator-surface))}.quiz-choice input{width:1.2rem;height:1.2rem;accent-color:var(--navigator-brand-primary)}.quiz-result{min-height:24rem;display:grid;place-items:center;align-content:center;gap:.7rem;text-align:center}.quiz-result h2,.quiz-result p{margin:0}.quiz-results{display:grid;gap:.6rem}.quiz-results article{display:flex;justify-content:space-between;gap:1rem;align-items:center;padding:.8rem;border:1px solid var(--navigator-border);border-radius:.8rem}.quiz-results article>div{display:grid;gap:.2rem}.quiz-results small{color:var(--navigator-muted)}.quiz-results form{display:flex;gap:.4rem}.quiz-results input{min-height:2.6rem;padding:.5rem;border:1px solid var(--navigator-border);border-radius:.6rem;background:var(--navigator-surface);color:var(--navigator-text)}.quiz-results button{border:0;border-radius:.6rem;background:var(--navigator-brand-primary);color:#fff;font-weight:800}@media(max-width:40rem){.quiz-results article,.quiz-results form{align-items:stretch;flex-direction:column}}
.cancel-session{display:flex;justify-content:flex-end;gap:1rem;align-items:center;margin-top:1rem;padding:1rem;border:1px solid color-mix(in srgb,#a33 30%,var(--navigator-border));border-radius:1rem;background:color-mix(in srgb,#a33 5%,var(--navigator-surface-raised))}.cancel-session p{margin:.2rem 0 0;color:var(--navigator-muted)}.cancel-session button{min-height:2.6rem;padding:.55rem .8rem;border:1px solid var(--navigator-border);border-radius:.7rem;background:var(--navigator-surface);color:var(--navigator-text);font:inherit;font-weight:750}.cancel-session__actions{display:flex;gap:.5rem}.cancel-session button.danger{border-color:#a33;background:#a33;color:#fff}@media(max-width:40rem){.cancel-session,.cancel-session__actions{align-items:stretch;flex-direction:column}}
.audio-panel{display:grid;grid-template-columns:56px minmax(0,1fr) auto;align-items:center;gap:.8rem;margin:1.1rem 0;padding:.75rem;border:1px solid var(--navigator-border);border-radius:1.1rem;background:var(--navigator-surface)}
.audio-toggle{width:56px;height:56px;padding:0;display:grid;place-items:center;border:0;border-radius:50%;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);box-shadow:0 6px 16px var(--navigator-shadow)}
.audio-panel>div{min-width:0;display:grid;gap:.18rem}.audio-panel strong{font-size:.9rem}.audio-panel span{color:var(--navigator-muted);font-size:.74rem}.audio-stop{padding:.45rem;border:0;color:var(--navigator-brand-primary);background:transparent;font:inherit;font-size:.75rem;font-weight:780}.capability-note{margin:-.65rem 0 .8rem;color:var(--navigator-muted);font-size:.75rem}
.personal-actions>p{flex:1 0 100%;margin:.55rem 0 0;color:var(--navigator-muted);font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase}
.voice-action{min-height:3.25rem;display:flex;align-items:center;justify-content:center;gap:.6rem;margin-top:.8rem;padding:.65rem 1rem;border:0;border-radius:.9rem;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);box-shadow:0 7px 20px var(--navigator-shadow);font:inherit;font-weight:850}.voice-action:disabled{opacity:.5}
.modal-overlay{position:fixed;z-index:var(--artaround-layer-modal,1000000);inset:0;display:grid;align-items:end;justify-items:center;padding-top:max(4rem,env(safe-area-inset-top));background:rgba(7,12,11,.52)}
.voice-sheet{width:min(100%,38rem);padding:1.25rem 1.25rem max(1.5rem,env(safe-area-inset-bottom));border:1px solid var(--navigator-border);border-bottom:0;border-radius:1.6rem 1.6rem 0 0;color:var(--navigator-text);background:var(--navigator-surface-raised);box-shadow:0 -20px 56px rgba(0,0,0,.3);text-align:center}.voice-orb{width:88px;height:88px;display:grid;place-items:center;margin:.35rem auto 1rem;border-radius:50%;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);box-shadow:0 0 0 13px color-mix(in srgb,var(--navigator-brand-primary) 12%,transparent);animation:listening 1.5s ease-in-out infinite}.voice-sheet h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:1.8rem;font-weight:500}.voice-sheet>p{color:var(--navigator-muted);font-size:.85rem}.voice-examples{display:flex;justify-content:center;gap:.4rem;flex-wrap:wrap;margin:1rem 0}.voice-examples span{padding:.35rem .55rem;border-radius:999px;background:color-mix(in srgb,var(--navigator-brand-primary) 9%,var(--navigator-surface));font-size:.75rem}.voice-sheet>button{min-height:2.8rem;padding:.6rem 1rem;border:1px solid var(--navigator-border);border-radius:.75rem;background:var(--navigator-surface);color:var(--navigator-text);font:inherit;font-weight:780}@keyframes listening{50%{transform:scale(1.04);box-shadow:0 0 0 18px color-mix(in srgb,var(--navigator-brand-primary) 5%,transparent)}}
@media(max-width:34rem){.audio-panel{grid-template-columns:52px minmax(0,1fr)}.audio-toggle{width:52px;height:52px}.audio-stop{grid-column:2;justify-self:start;padding-left:0}}
.session-experience{position:relative;width:min(100%,52rem);height:100dvh;min-height:0;max-height:100dvh;display:flex;flex-direction:column;margin:0 auto;overflow:hidden;color:var(--navigator-text);background:var(--navigator-surface);box-shadow:0 0 42px var(--navigator-shadow);overscroll-behavior:none}
.session-header{flex:0 0 auto;min-height:68px;display:grid;grid-template-columns:58px minmax(0,1fr) 70px;align-items:center;gap:.55rem;padding:max(.55rem,env(safe-area-inset-top)) 1rem .45rem}.session-back{width:44px;height:44px;display:grid;place-items:center;border:0;border-radius:.8rem;color:var(--navigator-text);background:transparent;font-size:1.35rem;text-decoration:none}.session-brand{min-width:0;display:flex;justify-content:center}.session-brand span{min-width:0;display:grid}.session-brand strong{overflow:hidden;color:var(--navigator-brand-primary);font-family:Georgia,"Times New Roman",serif;font-size:1rem;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.session-brand small{overflow:hidden;color:var(--navigator-muted);font-size:.62rem;font-weight:740;letter-spacing:.05em;text-overflow:ellipsis;text-transform:uppercase;white-space:nowrap}.group-control-button{min-height:44px;display:flex;align-items:center;justify-content:center;gap:.3rem;padding:.35rem .5rem;border:1px solid var(--navigator-border);border-radius:.8rem;color:var(--navigator-text);background:var(--navigator-surface-raised);font:inherit}.group-control-button span{display:grid;place-items:center;min-width:1.55rem;height:1.55rem;padding:0 .25rem;border-radius:.5rem;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);font-size:.7rem;font-weight:850}.group-control-button em{font-size:.68rem;font-style:normal;font-weight:780}.participant-role{justify-self:end;padding:.35rem .5rem;border-radius:.6rem;color:var(--navigator-brand-primary);background:color-mix(in srgb,var(--navigator-brand-primary) 9%,transparent);font-size:.65rem;font-weight:800}
.session-progress{flex:0 0 auto;padding:.25rem 1.25rem .7rem}.session-progress>div:first-child{display:flex;justify-content:space-between;gap:1rem;color:var(--navigator-muted);font-size:.72rem;font-weight:740}.progress-track{height:4px;margin-top:.45rem;overflow:hidden;border-radius:999px;background:var(--navigator-border)}.progress-track span{display:block;height:100%;border-radius:inherit;background:var(--navigator-brand-primary);transition:width .25s ease}
.session-experience>.inline-feedback{margin:.15rem 1.25rem .5rem}.active-session-body{min-height:0;flex:1;display:flex;flex-direction:column;overflow:hidden}.session-scroll{min-height:0;flex:1;overflow-y:auto;overscroll-behavior-y:contain;-webkit-overflow-scrolling:touch;touch-action:pan-y;padding:.35rem 1.25rem 1.25rem;scrollbar-width:thin}.content-panel{width:min(100%,44rem);margin:0 auto}.physical-context{display:flex;align-items:center;gap:.45rem;margin:.2rem 0;color:var(--navigator-muted);font-size:.75rem;font-weight:720}.physical-context span{width:.45rem;height:.45rem;border-radius:50%;background:var(--navigator-accent)}.content-panel h1{margin:.55rem 0 .25rem;font-family:Georgia,"Times New Roman",serif;font-size:clamp(2rem,8vw,3.3rem);font-weight:500;line-height:1.04;letter-spacing:-.025em}.content-media{overflow:hidden;margin:1rem 0 0;border:1px solid var(--navigator-border);border-radius:1.1rem;background:color-mix(in srgb,var(--navigator-text) 5%,var(--navigator-surface-raised))}.content-media img{display:block;width:100%;height:auto;max-height:35vh;object-fit:contain}.presentation-copy{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(1.12rem,4.5vw,1.35rem);line-height:1.65}.quick-title{margin:1.45rem 0 .55rem;color:var(--navigator-muted);font-family:inherit;font-size:.7rem;letter-spacing:.08em;text-transform:uppercase}.quick-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.55rem}.quick-actions button{min-height:50px;padding:.65rem;text-align:left;border:1px solid var(--navigator-border);border-radius:.75rem;background:var(--navigator-surface-raised);color:var(--navigator-text);font:inherit;font-size:.84rem;font-weight:720}.all-actions{width:100%;min-height:46px;margin-top:.6rem;border:0;border-radius:.75rem;color:var(--navigator-brand-primary);background:color-mix(in srgb,var(--navigator-brand-primary) 9%,var(--navigator-surface-raised));font:inherit;font-weight:770}.participant-note{margin:1rem 0 0;padding:.8rem;border-radius:.8rem;background:color-mix(in srgb,var(--navigator-brand-primary) 8%,var(--navigator-surface-raised));text-align:center}
.session-bottom{position:relative;z-index:10;flex:0 0 auto;min-height:84px;display:grid;grid-template-columns:minmax(0,1fr) 72px minmax(0,1fr);align-items:center;gap:.65rem;padding:.7rem 1.1rem max(.9rem,env(safe-area-inset-bottom));border-top:1px solid var(--navigator-border);background:color-mix(in srgb,var(--navigator-surface-raised) 94%,transparent);backdrop-filter:blur(16px)}.progress-action{min-height:50px;padding:.65rem;border:1px solid var(--navigator-border);border-radius:.75rem;color:var(--navigator-text);background:var(--navigator-surface-raised);font:inherit;font-size:.82rem;font-weight:760}.next-action{border-color:var(--navigator-brand-primary);color:var(--navigator-on-primary);background:var(--navigator-brand-primary)}.session-bottom .voice-action{width:66px;height:66px;min-height:0;justify-self:center;display:grid;place-items:center;margin:0;padding:0;border:5px solid var(--navigator-surface);border-radius:50%;color:var(--navigator-on-primary);background:var(--navigator-brand-primary);box-shadow:0 7px 20px var(--navigator-shadow)}
.group-overlay{align-items:center;padding:1rem}.group-sheet{width:min(100%,42rem);max-height:min(88dvh,48rem);display:grid;grid-template-rows:auto minmax(0,1fr) auto auto;overflow:hidden;border:1px solid var(--navigator-border);border-radius:1.4rem;color:var(--navigator-text);background:var(--navigator-surface-raised);box-shadow:0 24px 70px rgba(0,0,0,.34)}.group-sheet>header{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:1rem 1rem .75rem;border-bottom:1px solid var(--navigator-border)}.group-sheet h2,.group-sheet p{margin:.15rem 0}.group-sheet>header>button{width:42px;height:42px;padding:0;border:0;border-radius:50%;color:var(--navigator-text);background:var(--navigator-surface);font-size:1.6rem}.group-sheet-scroll{min-height:0;overflow-y:auto;padding:.75rem 1rem}.group-sheet .participant-list{width:100%;max-width:none}.group-sheet .participant-list li{grid-template-columns:auto minmax(0,1fr);align-items:start}.group-sheet .participant-list small{grid-column:2;white-space:normal}.empty-participants{padding:2rem;text-align:center;color:var(--navigator-muted)}.group-sheet-actions{padding:.75rem 1rem;border-top:1px solid var(--navigator-border)}.group-danger{padding:.75rem 1rem;border-top:1px solid color-mix(in srgb,#a33 25%,var(--navigator-border));background:color-mix(in srgb,#a33 4%,transparent)}.group-danger>button,.group-danger div button{min-height:2.6rem;padding:.55rem .8rem;border:1px solid var(--navigator-border);border-radius:.7rem;background:var(--navigator-surface);color:var(--navigator-text);font:inherit;font-weight:750}.group-danger div{display:flex;justify-content:flex-end;gap:.5rem}.group-danger .danger{border-color:#a33;background:#a33;color:#fff}
@media(max-width:40rem){.session-header{grid-template-columns:48px minmax(0,1fr) 64px;padding-inline:.65rem}.group-control-button em{display:none}.session-scroll{padding-inline:1rem}.group-overlay{align-items:end;padding:0}.group-sheet{max-height:92dvh;border-radius:1.4rem 1.4rem 0 0}.quick-actions{grid-template-columns:1fr}}
</style>
