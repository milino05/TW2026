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

export interface SessionProjection {
  session: {
    id: string;
    status: string;
    sourceType?: string;
    currentEntryIndex: number;
    runtimeVersion: number;
    deliveryMode?: "self_guided" | "synchronized";
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
};
