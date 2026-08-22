import { apiClient } from "./apiClient";

export interface VenueSummary {
  id: string;
  name: string;
  description: string;
}

export interface LibraryVisit {
  id: string;
  title: string;
  summary: string;
  physicalScope: VenueSummary[];
  stopCount: number;
}

export interface NavigatorVisitDetail {
  visit: {
    id: string;
    revisionId: string;
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

export const navigatorVisitRepository = {
  library(configuredVenueId?: string) {
    const query = configuredVenueId ? `?configuredVenueId=${encodeURIComponent(configuredVenueId)}` : "";
    return apiClient.request<{ visits: LibraryVisit[] }>(`/v2/navigator/library${query}`);
  },
  detail(visitId: string) {
    return apiClient.request<NavigatorVisitDetail>(`/v2/navigator/visits/${encodeURIComponent(visitId)}`);
  },
};
