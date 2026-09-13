import type {
  TextToSpeechCapability,
  TextToSpeechLifecycleEvent,
  TextToSpeechLifecycleType,
  TextToSpeechState,
} from "./index";

export class BrowserTextToSpeech implements TextToSpeechCapability {
  private currentState: TextToSpeechState = "idle";
  private utterance: SpeechSynthesisUtterance | null = null;
  private readonly listeners = new Set<(state: TextToSpeechState) => void>();
  private readonly lifecycleListeners = new Set<(event: TextToSpeechLifecycleEvent) => void>();
  private activeStartedAtMs: number | null = null;
  private accumulatedActiveMs = 0;

  get supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  get state() {
    return this.currentState;
  }

  private nowMs() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  }

  private setState(state: TextToSpeechState) {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.listeners) listener(state);
  }

  private captureActiveTime() {
    if (this.activeStartedAtMs == null) return;
    this.accumulatedActiveMs += Math.max(0, this.nowMs() - this.activeStartedAtMs);
    this.activeStartedAtMs = null;
  }

  private resetTiming() {
    this.activeStartedAtMs = null;
    this.accumulatedActiveMs = 0;
  }

  private emitLifecycle(type: TextToSpeechLifecycleType) {
    const event = {
      type,
      activeSeconds: Math.max(0, this.accumulatedActiveMs / 1000),
    } satisfies TextToSpeechLifecycleEvent;
    for (const listener of this.lifecycleListeners) listener(event);
  }

  speak(text: string, locale?: string | null) {
    if (!this.supported || !text.trim()) return false;
    this.stop();
    this.resetTiming();

    const utterance = new SpeechSynthesisUtterance(text);
    this.utterance = utterance;
    if (locale) utterance.lang = locale;
    let started = false;
    const markStarted = () => {
      if (started || this.utterance !== utterance) return;
      started = true;
      this.activeStartedAtMs = this.nowMs();
      this.setState("speaking");
      this.emitLifecycle("started");
    };

    utterance.onstart = markStarted;
    utterance.onend = () => {
      if (this.utterance !== utterance) return;
      this.captureActiveTime();
      this.emitLifecycle("completed");
      this.utterance = null;
      this.resetTiming();
      this.setState("idle");
    };
    utterance.onerror = () => {
      if (this.utterance !== utterance) return;
      this.captureActiveTime();
      this.emitLifecycle("error");
      this.utterance = null;
      this.resetTiming();
      this.setState("idle");
    };

    window.speechSynthesis.speak(utterance);
    // Mantiene la UI reattiva anche nei browser che notificano onstart con ritardo.
    markStarted();
    return true;
  }

  pause() {
    if (!this.supported || this.currentState !== "speaking") return false;
    this.captureActiveTime();
    window.speechSynthesis.pause();
    this.setState("paused");
    this.emitLifecycle("paused");
    return true;
  }

  resume() {
    if (!this.supported || this.currentState !== "paused") return false;
    window.speechSynthesis.resume();
    this.activeStartedAtMs = this.nowMs();
    this.setState("speaking");
    this.emitLifecycle("resumed");
    return true;
  }

  stop() {
    if (!this.supported) return;
    const wasActive = this.utterance !== null || this.currentState !== "idle";
    if (this.currentState === "speaking") this.captureActiveTime();
    this.utterance = null;
    window.speechSynthesis.cancel();
    if (wasActive) this.emitLifecycle("stopped");
    this.resetTiming();
    this.setState("idle");
  }

  subscribe(listener: (state: TextToSpeechState) => void) {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => this.listeners.delete(listener);
  }

  subscribeLifecycle(listener: (event: TextToSpeechLifecycleEvent) => void) {
    this.lifecycleListeners.add(listener);
    return () => this.lifecycleListeners.delete(listener);
  }
}

export const browserTts = new BrowserTextToSpeech();
