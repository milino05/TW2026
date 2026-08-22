export interface VoiceActionOption {
  actionId: string;
  label: string;
  controlledVoiceAliases: string[];
}

export interface VoiceActionMatch<T extends VoiceActionOption = VoiceActionOption> {
  transcript: string;
  action: T | null;
}

export interface TextToSpeechCapability {
  readonly supported: boolean;
  speak(text: string, locale?: string | null): boolean;
  stop(): void;
}

export interface ControlledVoiceCapability {
  readonly supported: boolean;
  listen<T extends VoiceActionOption>(actions: T[], locale?: string): Promise<VoiceActionMatch<T>>;
  stop(): void;
}

export type InteractionChannel = "button" | "controlled_voice" | "natural_language";
