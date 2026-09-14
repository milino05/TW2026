import type { InteractionChannel } from "../../capabilities";
import { apiClient } from "./apiClient";
import type { NavigationProjection, ObstacleCheckProjection } from "./navigationRepository";

export interface AvailableAction {
  actionId: string;
  type: string;
  family: "progress" | "presentation" | "semantic" | "navigation" | "lifecycle" | string;
  label: string;
  controlledVoiceAliases: string[];
  semanticChoice?: boolean;
  semanticChoiceRequestVersion?: number;
  runtimeScope?: "visit_session" | "synchronized_visit_session";
  runtimeVersion?: number;
}

export type ExecutionPhase =
  | "location_required"
  | "navigating_to_visit_stop"
  | "approaching_visit_target"
  | "presenting_visit_content"
  | "presenting_semantic_content"
  | "navigating_detour"
  | "at_detour_destination"
  | "route_completed";

export type KnownLocationSource =
  | "manual_selection"
  | "navigation_confirmation"
  | "qr"
  | "teleport"
  | "geolocation";

export interface KnownLocationProjection {
  venueId: string;
  placeId: string;
  visitAnchorId: string | null;
  venueTargetId: string | null;
  exhibitSlotId: string | null;
  source: KnownLocationSource;
  providerId: string | null;
  observedAt: string | null;
}

export interface LiveNavigationSummary {
  intent: "visit_progression" | "physical_detour";
  type: "indoor" | "inter_venue";
  destination: { venueId: string; placeId: string };
  nextInstruction: string | null;
  remainingStepCount: number;
  estimatedSeconds: number;
  distanceMeters: number | null;
}

export interface SessionProjection {
  session: {
    id: string;
    status: string;
    sourceType?: string;
    currentEntryIndex: number;
    runtimeVersion: number;
    executionMode?: "self_guided" | "synchronized";
  };
  synchronization: null | {
    id: string;
    status: "lobby" | "active" | "quiz" | "completed" | "cancelled";
    role: "host" | "participant";
    joinAlias: string | null;
    currentEntryIndex: number;
    runtimeVersion: number;
  };
  planRevisionId: string;
  progress?: {
    currentEntryIndex: number;
    contentEntryCount: number;
    deliveryVisitAnchorId: string | null;
    contextVisitAnchorId: string | null;
    currentStopOrder: number | null;
  };
  experience?: {
    phase: ExecutionPhase;
    presentationAvailable: boolean;
  };
  physical?: {
    knownLocation: KnownLocationProjection | null;
    detour: null | {
      destination: {
        venueId: string;
        placeId: string;
        physicalFeatureRef: null | {
          kind: "local";
          physicalVocabularyId: string;
          definitionId: string;
        };
      };
      startedAt: string | null;
    };
    navigation: LiveNavigationSummary | null;
  };
  current: null | {
    contentEntryId: string;
    role?: string;
    label: string;
    illustrativeMedia: Array<{
      id?: string;
      url: string;
      originalUrl?: string | null;
      altText: string;
      mimeType?: string | null;
      width?: number | null;
      height?: number | null;
      source?: null | {
        provider?: string | null;
        wikidataEntityId?: string | null;
        fileTitle?: string | null;
        pageUrl?: string | null;
      };
      rights?: null | {
        creator?: string | null;
        attribution?: string | null;
        licenseName?: string | null;
        licenseUrl?: string | null;
      };
    }>;
    presentation: {
      text: string;
      locale?: string;
      kind?: "visit_content" | "semantic_exploration";
      estimatedContentSeconds?: number;
    };
    anchor?: null | {
      visitAnchorId: string;
      venueTargetId: string;
      venueId: string;
    };
  };
  availableActions: AvailableAction[];
}

export interface ActionResult {
  action: {
    actionId: string;
    type: string;
    family: string;
  };
  runtime: SessionProjection;
  effect: null | {
    type: string;
    learning?: {
      contentExposures: number;
      physicalObservations: number;
    };
    navigation?: NavigationProjection;
    obstacleCheck?: ObstacleCheckProjection;
    choices?: AvailableAction[];
    location?: KnownLocationProjection;
    knownLocation?: KnownLocationProjection;
    visitAnchorId?: string;
    currentEntryIndex?: number;
  };
}

export interface ContentExperienceInput {
  contentEntryId: string;
  experiencedSeconds: number;
  completionRatio: number;
  contentSeconds?: number;
}

export interface ContentExperienceResult {
  experience: {
    contentEntryId: string;
    itemEditionId: string;
    itemRevisionId: string;
    variantId: string;
    representationId: string;
    contentSeconds: number;
    experiencedSeconds: number;
    completionRatio: number;
    reliability: number;
  };
}

export const sessionRepository = {
  current(sessionId: string) {
    return apiClient.request<SessionProjection>(`/v2/visit-sessions/${encodeURIComponent(sessionId)}/current`);
  },
  dispatchAction(
    sessionId: string,
    actionId: string,
    expectedRuntimeVersion: number,
    interactionChannel: InteractionChannel = "button",
    input: unknown = null,
  ) {
    return apiClient.request<ActionResult>(`/v2/visit-sessions/${encodeURIComponent(sessionId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ actionId, expectedRuntimeVersion, interactionChannel, input }),
    });
  },
  recordContentExperience(sessionId: string, input: ContentExperienceInput) {
    return apiClient.request<ContentExperienceResult>(`/v2/visit-sessions/${encodeURIComponent(sessionId)}/content-entries/experience`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  },
};
