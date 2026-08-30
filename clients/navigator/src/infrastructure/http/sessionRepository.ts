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
}

export interface SessionProjection {
  session: {
    id: string;
    status: string;
    sourceType?: string;
    currentEntryIndex: number;
    runtimeVersion: number;
  };
  planRevisionId: string;
  current: null | {
    contentEntryId: string | null;
    role?: string | null;
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
      kind?: "visit_content" | "semantic_exploration" | "logistics";
      estimatedContentSeconds?: number;
    };
    anchor?: null | {
      visitAnchorId: string;
      venueTargetId: string;
      venueId: string;
    };
    logistics?: {
      kind: "connection" | "transfer" | "approach";
      stepNumber: number;
      stepCount: number;
      distanceMeters: number | null;
      estimatedSeconds: number | null;
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
  ) {
    return apiClient.request<ActionResult>(`/v2/visit-sessions/${encodeURIComponent(sessionId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ actionId, expectedRuntimeVersion, interactionChannel }),
    });
  },
};
