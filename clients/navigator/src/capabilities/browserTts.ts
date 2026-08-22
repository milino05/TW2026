export class BrowserTextToSpeech {
  get supported() {
    return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
  }

  speak(text: string, locale?: string | null) {
    if (!this.supported || !text.trim()) return false;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (locale) utterance.lang = locale;
    window.speechSynthesis.speak(utterance);
    return true;
  }

  stop() {
    if (this.supported) window.speechSynthesis.cancel();
  }
}

export const browserTts = new BrowserTextToSpeech();
