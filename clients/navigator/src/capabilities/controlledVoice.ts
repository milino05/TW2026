import type { AvailableAction } from "../infrastructure/http/sessionRepository";

type RecognitionResult = {
  transcript: string;
  action: AvailableAction | null;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function constructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor }).webkitSpeechRecognition;
  return candidate || null;
}

function normalize(value: string) {
  return value
    .toLocaleLowerCase("it")
    .normalize("NFKC")
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchAction(actions: AvailableAction[], transcript: string) {
  const spoken = normalize(transcript);
  if (!spoken) return null;
  return actions.find((action) => {
    const vocabulary = [action.label, ...(action.controlledVoiceAliases || [])];
    return vocabulary.some((phrase) => normalize(phrase) === spoken);
  }) || null;
}

export class BrowserControlledVoice {
  private recognition: SpeechRecognitionLike | null = null;

  get supported() {
    return constructor() !== null;
  }

  listen(actions: AvailableAction[], locale = "it-IT"): Promise<RecognitionResult> {
    const Recognition = constructor();
    if (!Recognition) return Promise.reject(new Error("Riconoscimento vocale non supportato dal browser"));
    this.stop();
    const recognition = new Recognition();
    this.recognition = recognition;
    recognition.lang = locale;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    return new Promise((resolve, reject) => {
      recognition.onresult = (event: unknown) => {
        const resultEvent = event as { results?: ArrayLike<{ 0?: { transcript?: string } }> };
        const transcript = resultEvent.results?.[0]?.[0]?.transcript?.trim() || "";
        resolve({ transcript, action: matchAction(actions, transcript) });
      };
      recognition.onerror = () => reject(new Error("Comando vocale non riconosciuto"));
      recognition.onend = () => { this.recognition = null; };
      recognition.start();
    });
  }

  stop() {
    if (!this.recognition) return;
    try { this.recognition.abort(); } catch { /* no-op */ }
    this.recognition = null;
  }
}

export const browserControlledVoice = new BrowserControlledVoice();
