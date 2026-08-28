import type { LocationObservation } from "../domain/location";

export interface VoiceActionOption {
  actionId: string;
  label: string;
  controlledVoiceAliases: string[];
}

export interface VoiceActionMatch<T extends VoiceActionOption = VoiceActionOption> {
  transcript: string;
  action: T | null;
}

export interface ActionIntentMatch<T extends VoiceActionOption = VoiceActionOption> {
  input: string;
  action: T | null;
}

export interface ActionIntentResolverCapability {
  readonly supported: boolean;
  resolve<T extends VoiceActionOption>(input: string, actions: T[], locale?: string): Promise<ActionIntentMatch<T>>;
}

export interface LocationCapability {
  readonly providerId: string;
  readonly supported: boolean;
  observe(): Promise<LocationObservation | null>;
  stop?(): void;
}

export type TextToSpeechState = "idle" | "speaking" | "paused";

export interface TextToSpeechCapability {
  readonly supported: boolean;
  readonly state: TextToSpeechState;
  speak(text: string, locale?: string | null): boolean;
  pause(): boolean;
  resume(): boolean;
  stop(): void;
  subscribe(listener: (state: TextToSpeechState) => void): () => void;
}

export interface ControlledVoiceCapability {
  readonly supported: boolean;
  listen<T extends VoiceActionOption>(actions: T[], locale?: string): Promise<VoiceActionMatch<T>>;
  stop(): void;
}

export type InteractionChannel = "button" | "controlled_voice" | "natural_language";
