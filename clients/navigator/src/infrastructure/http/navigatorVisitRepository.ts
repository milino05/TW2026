import { apiClient } from "./apiClient";

export interface VenueSummary {
  id: string;
  name: string;
  description: string;
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
}

export const navigatorVisitRepository = {
  library(configuredVenueId?: string) {
    const query = configuredVenueId ? `?configuredVenueId=${encodeURIComponent(configuredVenueId)}` : "";
    return apiClient.request<{ visits: LibraryVisit[] }>(`/v2/navigator/library${query}`);
  },
  detail(visitId: string) {
    return apiClient.request<NavigatorVisitDetail>(`/v2/navigator/visits/${encodeURIComponent(visitId)}`);
  },
  resumableSessions() {
    return apiClient.request<{ sessions: ResumableSession[] }>("/v2/navigator/sessions");
  },
};
