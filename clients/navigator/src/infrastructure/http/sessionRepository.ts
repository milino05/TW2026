import { apiClient } from "./apiClient";

export interface AvailableAction {
  actionId: string;
  type: string;
  family: "progress" | "presentation" | "semantic" | "navigation" | "lifecycle" | string;
  label: string;
  controlledVoiceAliases: string[];
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
    contentEntryId: string;
    role?: string;
    label: string;
    presentation: {
      text: string;
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
    label?: string;
    learning?: {
      contentExposures: number;
      physicalObservations: number;
    };
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
    interactionChannel: "button" | "controlled_voice" | "natural_language" = "button",
  ) {
    return apiClient.request<ActionResult>(`/v2/visit-sessions/${encodeURIComponent(sessionId)}/actions`, {
      method: "POST",
      body: JSON.stringify({ actionId, expectedRuntimeVersion, interactionChannel }),
    });
  },
};
