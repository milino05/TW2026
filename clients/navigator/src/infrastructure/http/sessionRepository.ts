import { apiClient } from "./apiClient";

export interface SessionProjection {
  session: {
    id: string;
    status: string;
    sourceType?: string;
    currentEntryIndex: number;
  };
  planRevisionId: string;
  current: null | {
    contentEntryId: string;
    label: string;
    presentation: {
      text: string;
      estimatedContentSeconds?: number;
    };
  };
  availableActions: string[];
}

export const sessionRepository = {
  current(sessionId: string) {
    return apiClient.request<SessionProjection>(`/v2/visit-sessions/${encodeURIComponent(sessionId)}/current`);
  },
  advance(sessionId: string, direction: "next" | "previous") {
    return apiClient.request<SessionProjection>(`/v2/visit-sessions/${encodeURIComponent(sessionId)}/advance`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    });
  },
};
