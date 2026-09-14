import type {
  TextToSpeechCapability,
  TextToSpeechLifecycleEvent,
  TextToSpeechLifecycleType,
  TextToSpeechState,
} from "./index";

const MAX_UTTERANCE_CHARS = 180;
type UtteranceStartKind = "started" | "resumed" | "continuation";

export class BrowserTextToSpeech implements TextToSpeechCapability {
  private currentState: TextToSpeechState = "idle";
  private utterance: SpeechSynthesisUtterance | null = null;
  private readonly listeners = new Set<(state: TextToSpeechState) => void>();
  private readonly lifecycleListeners = new Set<(event: TextToSpeechLifecycleEvent) => void>();
  private activeStartedAtMs: number | null = null;
  private accumulatedActiveMs = 0;
  private lifecycleStarted = false;
  private utteranceText = "";
  private utteranceLocale: string | null = null;
  private utteranceVoice: SpeechSynthesisVoice | null = null;
  private utteranceOffset = 0;
  private resumeOffset = 0;

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
    this.utteranceLocale = null;
    this.utteranceVoice = null;
    this.utteranceOffset = 0;
    this.resumeOffset = 0;
  }

  private emitLifecycle(type: TextToSpeechLifecycleType) {
    const event = {
      type,
      activeSeconds: Math.max(0, this.accumulatedActiveMs / 1000),
      utteranceText: this.utteranceText,
    } satisfies TextToSpeechLifecycleEvent;
    for (const listener of this.lifecycleListeners) listener(event);
  }

  private segmentFrom(offset: number) {
    let normalizedOffset = Math.max(0, Math.min(offset, this.utteranceText.length));
    while (normalizedOffset < this.utteranceText.length && /\s/.test(this.utteranceText[normalizedOffset])) normalizedOffset += 1;
    let endOffset = Math.min(this.utteranceText.length, normalizedOffset + MAX_UTTERANCE_CHARS);
    if (endOffset < this.utteranceText.length) {
      const segment = this.utteranceText.slice(normalizedOffset, endOffset);
      const punctuationOffset = Math.max(
        segment.lastIndexOf(". "),
        segment.lastIndexOf("! "),
        segment.lastIndexOf("? "),
        segment.lastIndexOf("; "),
        segment.lastIndexOf(": "),
        segment.lastIndexOf(", "),
      );
      const wordOffset = segment.lastIndexOf(" ");
      const boundaryOffset = punctuationOffset >= 60 ? punctuationOffset + 1 : wordOffset;
      if (boundaryOffset >= 60) endOffset = normalizedOffset + boundaryOffset + 1;
    }
    return {
      startOffset: normalizedOffset,
      endOffset,
      text: this.utteranceText.slice(normalizedOffset, endOffset),
    };
  }

  private selectVoice(locale: string | null) {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    const normalizedLocale = (locale || "").toLowerCase();
    const language = normalizedLocale.split("-")[0];
    return voices.find((voice) => voice.lang.toLowerCase() === normalizedLocale)
      || voices.find((voice) => voice.lang.toLowerCase().split("-")[0] === language)
      || voices.find((voice) => voice.default)
      || voices[0];
  }

  private startUtterance(offset: number, startKind: UtteranceStartKind) {
    const segment = this.segmentFrom(offset);
    if (!segment.text) return false;

    const utterance = new SpeechSynthesisUtterance(segment.text);
    this.utterance = utterance;
    this.utteranceOffset = segment.startOffset;
    this.resumeOffset = segment.startOffset;
    if (this.utteranceLocale) utterance.lang = this.utteranceLocale;
    if (this.utteranceVoice) utterance.voice = this.utteranceVoice;

    utterance.onstart = () => {
      if (this.utterance !== utterance) return;
      this.activeStartedAtMs = this.nowMs();
      this.setState("speaking");
      if (this.lifecycleStarted && startKind === "resumed") {
        this.emitLifecycle("resumed");
      } else if (!this.lifecycleStarted) {
        this.lifecycleStarted = true;
        this.emitLifecycle("started");
      }
    };
    utterance.onboundary = (event) => {
      if (this.utterance !== utterance || !Number.isFinite(event.charIndex)) return;
      this.resumeOffset = Math.min(this.utteranceText.length, this.utteranceOffset + event.charIndex);
    };
    utterance.onend = () => {
      if (this.utterance !== utterance) return;
      if (this.lifecycleStarted) this.captureActiveTime();
      if (segment.endOffset < this.utteranceText.length) {
        this.utterance = null;
        this.resumeOffset = segment.endOffset;
        this.startUtterance(segment.endOffset, "continuation");
        return;
      }
      if (this.lifecycleStarted) this.emitLifecycle("completed");
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

  speak(text: string, locale?: string | null) {
    if (!this.supported || !text.trim()) return false;
    this.stop();
    this.resetLifecycle();
    this.utteranceText = text;
    this.utteranceLocale = locale || null;
    this.utteranceVoice = this.selectVoice(this.utteranceLocale);
    return this.startUtterance(0, "started");
  }

  pause() {
    if (!this.supported || this.currentState !== "speaking") return false;
    if (this.lifecycleStarted) this.captureActiveTime();
    // Alcuni motori Web Speech non producono più audio dopo pause()/resume().
    // Conserviamo quindi l'ultima parola raggiunta e ricreiamo l'utterance alla ripresa.
    this.utterance = null;
    window.speechSynthesis.cancel();
    this.setState("paused");
    if (this.lifecycleStarted) this.emitLifecycle("paused");
    return true;
  }

  resume() {
    if (!this.supported || this.currentState !== "paused") return false;
    return this.startUtterance(this.resumeOffset, "resumed");
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
