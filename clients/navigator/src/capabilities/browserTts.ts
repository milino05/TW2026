import type { TextToSpeechCapability, TextToSpeechState } from "./index";

export class BrowserTextToSpeech implements TextToSpeechCapability {
  private currentState: TextToSpeechState = "idle";
  private utterance: SpeechSynthesisUtterance | null = null;
  private readonly listeners = new Set<(state: TextToSpeechState) => void>();

  get supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  get state() {
    return this.currentState;
  }

  private setState(state: TextToSpeechState) {
    if (this.currentState === state) return;
    this.currentState = state;
    for (const listener of this.listeners) listener(state);
  }

  speak(text: string, locale?: string | null) {
    if (!this.supported || !text.trim()) return false;
    this.stop();
    const utterance = new SpeechSynthesisUtterance(text);
    this.utterance = utterance;
    if (locale) utterance.lang = locale;
    utterance.onstart = () => {
      if (this.utterance === utterance) this.setState("speaking");
    };
    utterance.onend = () => {
      if (this.utterance !== utterance) return;
      this.utterance = null;
      this.setState("idle");
    };
    utterance.onerror = () => {
      if (this.utterance !== utterance) return;
      this.utterance = null;
      this.setState("idle");
    };
    this.setState("speaking");
    window.speechSynthesis.speak(utterance);
    return true;
  }

  pause() {
    if (!this.supported || this.currentState !== "speaking") return false;
    window.speechSynthesis.pause();
    this.setState("paused");
    return true;
  }

  resume() {
    if (!this.supported || this.currentState !== "paused") return false;
    window.speechSynthesis.resume();
    this.setState("speaking");
    return true;
  }

  stop() {
    if (!this.supported) return;
    this.utterance = null;
    window.speechSynthesis.cancel();
    this.setState("idle");
  }

  subscribe(listener: (state: TextToSpeechState) => void) {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => this.listeners.delete(listener);
  }
}

export const browserTts = new BrowserTextToSpeech();
