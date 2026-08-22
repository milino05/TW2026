import { apiClient } from "./apiClient";
import type { SessionProjection } from "./sessionRepository";

export interface ExecutionPreparationProjection {
  id: string;
  version: number;
  status: "active" | "starting" | "consumed";
  source: {
    sourceType: "visit" | "generated_plan";
    visitId: string | null;
    visitRevisionId: string | null;
    generatedVisitPlanId: string | null;
    versionPolicy: "follow_current" | "pinned" | "fixed_generated_plan";
  };
  effectivePresentationPreference: null | {
    depthPreference: number | null;
    languageComplexityPreference: number | null;
    locale: string | null;
  };
  navigation: { movementPacePreference: number };
  readiness: {
    status: string;
    blockers: Array<{ code: string; message: string }>;
    warnings: Array<{ code: string; message: string }>;
  };
  logisticsPreview: {
    estimatedTotalSeconds: number;
    breakdown: {
      contentSeconds: number;
      observationSeconds: number;
      travelSeconds: number;
    };
    reservedSeconds: number;
    routeSummary: {
      stopCount: number;
      legCount: number;
      venueCount: number;
      interVenueLegCount: number;
    };
    warnings: Array<{ code: string; message: string }>;
  };
  expiresAt: string;
  sessionId: string | null;
}

interface StartPreparationResponse {
  session: { _id: string };
  current: SessionProjection;
  preparation: ExecutionPreparationProjection;
  alreadyStarted: boolean;
}

export const executionPreparationRepository = {
  async createForVisit(visitId: string) {
    const response = await apiClient.request<{ preparation: ExecutionPreparationProjection }>("/v2/execution-preparations", {
      method: "POST",
      body: JSON.stringify({ visitId }),
    });
    return response.preparation;
  },
  async get(preparationId: string) {
    const response = await apiClient.request<{ preparation: ExecutionPreparationProjection }>(`/v2/execution-preparations/${encodeURIComponent(preparationId)}`);
    return response.preparation;
  },
  async start(preparation: Pick<ExecutionPreparationProjection, "id" | "version">) {
    return apiClient.request<StartPreparationResponse>(`/v2/execution-preparations/${encodeURIComponent(preparation.id)}/start`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: preparation.version }),
    });
  },
};
