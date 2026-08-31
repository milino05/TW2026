import type { ControlledVoiceCapability, VoiceActionMatch, VoiceActionOption } from "./index";

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
type SpeechRecognitionErrorCode =
  | "aborted"
  | "audio-capture"
  | "language-not-supported"
  | "network"
  | "no-speech"
  | "not-allowed"
  | "service-not-allowed"
  | string;

type SpeechRecognitionErrorLike = {
  error?: SpeechRecognitionErrorCode;
  message?: string;
};

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

function matchAction<T extends VoiceActionOption>(actions: T[], transcript: string) {
  const spoken = normalize(transcript);
  if (!spoken) return null;
  const matches = actions.filter((action) => {
    const vocabulary = [action.label, ...(action.controlledVoiceAliases || [])];
    return vocabulary.some((phrase) => normalize(phrase) === spoken);
  });
  // Controlled voice must never resolve an ambiguous phrase by array order.
  return matches.length === 1 ? matches[0] : null;
}

function errorMessage(code: SpeechRecognitionErrorCode) {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return window.isSecureContext
      ? "Consenti l’accesso al microfono nelle impostazioni del browser e riprova."
      : "Il microfono sul telefono richiede una connessione HTTPS. Apri il Navigator tramite un indirizzo HTTPS e riprova.";
  }
  if (code === "audio-capture") return "Il microfono non è disponibile. Controlla che non sia usato da un’altra applicazione e riprova.";
  if (code === "network") return "Il riconoscimento vocale non riesce a collegarsi al servizio. Controlla la connessione e riprova.";
  if (code === "language-not-supported") return "Il riconoscimento vocale non supporta la lingua selezionata su questo dispositivo.";
  if (code === "aborted") return "Ascolto annullato";
  return "Riconoscimento vocale temporaneamente non disponibile. Riprova tra qualche istante.";
}

async function ensureMicrophonePermission() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (!window.isSecureContext) {
    throw new Error("Il microfono sul telefono richiede una connessione HTTPS. Apri il Navigator tramite un indirizzo HTTPS e riprova.");
  }
  if (!navigator.mediaDevices?.getUserMedia) return;

  let permissionState: PermissionState | null = null;
  try {
    const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    permissionState = permission?.state || null;
  } catch {
    // Alcuni browser mobili non espongono il permesso microfono tramite Permissions API.
  }
  if (permissionState === "granted") return;
  if (permissionState === "denied") {
    throw new Error("Consenti l’accesso al microfono nelle impostazioni del browser e riprova.");
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
  } catch (cause) {
    const name = cause instanceof DOMException ? cause.name : "";
    if (["NotAllowedError", "SecurityError"].includes(name)) {
      throw new Error("Consenti l’accesso al microfono nelle impostazioni del browser e riprova.");
    }
    if (["NotFoundError", "NotReadableError", "AbortError"].includes(name)) {
      throw new Error("Il microfono non è disponibile. Controlla che non sia usato da un’altra applicazione e riprova.");
    }
    throw new Error("Non è stato possibile attivare il microfono. Riprova tra qualche istante.");
  }
}

export class BrowserControlledVoice implements ControlledVoiceCapability {
  private recognition: SpeechRecognitionLike | null = null;
  private retryTimer: number | null = null;
  private requestVersion = 0;

  get supported() {
    return constructor() !== null;
  }

  async listen<T extends VoiceActionOption>(actions: T[], locale = "it-IT"): Promise<VoiceActionMatch<T>> {
    const Recognition = constructor();
    if (!Recognition) return Promise.reject(new Error("Riconoscimento vocale non supportato dal browser"));
    this.stop();
    const requestVersion = this.requestVersion;
    await ensureMicrophonePermission();
    if (requestVersion !== this.requestVersion) return { transcript: "", action: null };

    return new Promise((resolve, reject) => {
      let attempts = 0;
      let settled = false;

      const finish = (result: VoiceActionMatch<T>) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };

      const startAttempt = () => {
        if (settled || requestVersion !== this.requestVersion) {
          finish({ transcript: "", action: null });
          return;
        }
        attempts += 1;
        const recognition = new Recognition();
        this.recognition = recognition;
        recognition.lang = locale;
        recognition.continuous = false;
        // I risultati intermedi evitano che alcuni browser mobili perdano una
        // frase breve quando terminano la sessione prima del risultato finale.
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;
        let transcript = "";
        let recoverableEnd = true;

        recognition.onresult = (event: unknown) => {
          const resultEvent = event as { results?: ArrayLike<ArrayLike<{ transcript?: string }>> };
          const candidates = Array.from(resultEvent.results || [])
            .flatMap((result) => Array.from(result || []))
            .map((alternative) => alternative?.transcript?.trim() || "")
            .filter(Boolean);
          transcript = candidates[0] || transcript;
          const matched = candidates
            .map((candidate) => ({ transcript: candidate, action: matchAction(actions, candidate) }))
            .find((candidate) => candidate.action);
          if (matched) {
            finish(matched);
            try { recognition.stop(); } catch { /* il risultato è già disponibile */ }
          }
        };
        recognition.onerror = (event: unknown) => {
          const code = (event as SpeechRecognitionErrorLike)?.error || "unknown";
          if (code === "no-speech") return;
          recoverableEnd = false;
          if (code === "aborted" && requestVersion !== this.requestVersion) {
            finish({ transcript: "", action: null });
            return;
          }
          fail(errorMessage(code));
        };
        recognition.onend = () => {
          if (this.recognition === recognition) this.recognition = null;
          if (settled) return;
          if (transcript) {
            finish({ transcript, action: matchAction(actions, transcript) });
            return;
          }
          if (recoverableEnd && attempts < 2 && requestVersion === this.requestVersion) {
            this.retryTimer = window.setTimeout(() => {
              this.retryTimer = null;
              startAttempt();
            }, 300);
            return;
          }
          finish({ transcript: "", action: null });
        };
        try {
          recognition.start();
        } catch {
          fail("Non è stato possibile avviare il microfono. Attendi un istante e riprova.");
        }
      };

      startAttempt();
    });
  }

  stop() {
    this.requestVersion += 1;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (!this.recognition) return;
    try { this.recognition.abort(); } catch { /* no-op */ }
    this.recognition = null;
  }
}

export const browserControlledVoice = new BrowserControlledVoice();
