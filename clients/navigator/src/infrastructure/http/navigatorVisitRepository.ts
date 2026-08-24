import { apiClient } from "./apiClient";

export interface VenueSummary {
  id: string;
  name: string;
  description: string;
}

export interface NavigatorMuseumSummary extends VenueSummary {
  visitCount: number;
  resumableSessionCount: number;
}

export interface PrincipalSummary {
  type: "user" | "organization";
  id: string;
  name: string;
}

export interface LibraryVisit {
  id: string;
  resolvedRevisionId: string;
  title: string;
  summary: string;
  owner: PrincipalSummary;
  physicalScope: VenueSummary[];
  stopCount: number;
}

export interface NavigatorVisitDetail {
  context: {
    owner: PrincipalSummary;
  };
  visit: {
    id: string;
    resolvedRevisionId: string;
    title: string;
    description: string;
    physicalScope: VenueSummary[];
    stopCount: number;
    contentCount: number;
  };
  preparation: {
    available: boolean;
  };
}

export interface ResumableSession {
  id: string;
  status: "active" | "paused" | "route_completed";
  sourceType: "visit" | "generated_plan";
  visitId: string | null;
  title: string;
  currentEntryIndex: number;
  updatedAt: string;
  physicalScope: VenueSummary[];
}

function configuredVenueQuery(configuredVenueId?: string) {
  return configuredVenueId ? `?configuredVenueId=${encodeURIComponent(configuredVenueId)}` : "";
}

export const navigatorVisitRepository = {
  museums() {
    return apiClient.request<{ museums: NavigatorMuseumSummary[] }>("/v2/navigator/museums");
  },
  library(configuredVenueId?: string) {
    return apiClient.request<{ visits: LibraryVisit[] }>(
      `/v2/navigator/library${configuredVenueQuery(configuredVenueId)}`,
    );
  },
  detail(visitId: string, configuredVenueId?: string) {
    return apiClient.request<NavigatorVisitDetail>(
      `/v2/navigator/visits/${encodeURIComponent(visitId)}${configuredVenueQuery(configuredVenueId)}`,
    );
  },
  resumableSessions(configuredVenueId?: string) {
    return apiClient.request<{ sessions: ResumableSession[] }>(
      `/v2/navigator/sessions${configuredVenueQuery(configuredVenueId)}`,
    );
  },
  dismissResumableSession(sessionId: string) {
    return apiClient.request<{
      removedFromResume: true;
      session: { id: string; status: "abandoned" };
    }>(`/v2/navigator/sessions/${encodeURIComponent(sessionId)}/resumable`, {
      method: "DELETE",
    });
  },
};
