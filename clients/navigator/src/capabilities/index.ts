export interface TextToSpeechCapability {
  speak(text: string): Promise<void> | void;
  stop(): Promise<void> | void;
}

export interface ControlledVoiceCapability {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
}

export type InteractionChannel = "button" | "controlled_voice" | "natural_language";
