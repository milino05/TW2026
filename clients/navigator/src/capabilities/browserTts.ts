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
  private lifecycleStarted = false;
  private utteranceText = "";

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

  private resetLifecycle() {
    this.activeStartedAtMs = null;
    this.accumulatedActiveMs = 0;
    this.lifecycleStarted = false;
    this.utteranceText = "";
  }

  private emitLifecycle(type: TextToSpeechLifecycleType) {
    const event = {
      type,
      activeSeconds: Math.max(0, this.accumulatedActiveMs / 1000),
      utteranceText: this.utteranceText,
    } satisfies TextToSpeechLifecycleEvent;
    for (const listener of this.lifecycleListeners) listener(event);
  }

  speak(text: string, locale?: string | null) {
    if (!this.supported || !text.trim()) return false;
    this.stop();
    this.resetLifecycle();

    const utterance = new SpeechSynthesisUtterance(text);
    this.utterance = utterance;
    this.utteranceText = text;
    if (locale) utterance.lang = locale;

    utterance.onstart = () => {
      if (this.utterance !== utterance || this.lifecycleStarted) return;
      this.lifecycleStarted = true;
      this.activeStartedAtMs = this.nowMs();
      this.setState("speaking");
      this.emitLifecycle("started");
    };
    utterance.onend = () => {
      if (this.utterance !== utterance) return;
      if (this.lifecycleStarted) {
        this.captureActiveTime();
        this.emitLifecycle("completed");
      }
      this.utterance = null;
      this.resetLifecycle();
      this.setState("idle");
    };
    utterance.onerror = () => {
      if (this.utterance !== utterance) return;
      if (this.lifecycleStarted) {
        this.captureActiveTime();
        this.emitLifecycle("error");
      }
      this.utterance = null;
      this.resetLifecycle();
      this.setState("idle");
    };

    // La UI reagisce subito al comando; la telemetria parte soltanto da onstart,
    // cioè quando il browser conferma che l'utterance è realmente iniziata.
    this.setState("speaking");
    window.speechSynthesis.speak(utterance);
    return true;
  }

  pause() {
    if (!this.supported || this.currentState !== "speaking") return false;
    if (this.lifecycleStarted) this.captureActiveTime();
    window.speechSynthesis.pause();
    this.setState("paused");
    if (this.lifecycleStarted) this.emitLifecycle("paused");
    return true;
  }

  resume() {
    if (!this.supported || this.currentState !== "paused") return false;
    window.speechSynthesis.resume();
    if (this.lifecycleStarted) this.activeStartedAtMs = this.nowMs();
    this.setState("speaking");
    if (this.lifecycleStarted) this.emitLifecycle("resumed");
    return true;
  }

  stop() {
    if (!this.supported) return;
    const shouldReportStop = this.lifecycleStarted;
    if (shouldReportStop && this.currentState === "speaking") this.captureActiveTime();
    this.utterance = null;
    window.speechSynthesis.cancel();
    if (shouldReportStop) this.emitLifecycle("stopped");
    this.resetLifecycle();
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
