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
  preVisit: {
    visitNotes: string[];
    venues: Array<{
      id: string;
      name: string;
      information: string[];
    }>;
  };
  readiness: {
    status: "ready" | "blocked";
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

export interface PreparationUpdate {
  presentationPreference?: {
    depthPreference?: number;
    languageComplexityPreference?: number;
    locale?: string;
  };
  movementPacePreference?: number;
}

interface StartPreparationResponse {
  session: { _id: string };
  current: SessionProjection;
  preparation: ExecutionPreparationProjection;
  alreadyStarted: boolean;
}

async function createPreparation(payload: { visitId?: string; generatedVisitPlanId?: string }) {
  const response = await apiClient.request<{ preparation: ExecutionPreparationProjection }>("/v2/execution-preparations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.preparation;
}

export const executionPreparationRepository = {
  createForVisit(visitId: string) {
    return createPreparation({ visitId });
  },
  createForGeneratedPlan(generatedVisitPlanId: string) {
    return createPreparation({ generatedVisitPlanId });
  },
  async get(preparationId: string) {
    const response = await apiClient.request<{ preparation: ExecutionPreparationProjection }>(`/v2/execution-preparations/${encodeURIComponent(preparationId)}`);
    return response.preparation;
  },
  async update(preparation: Pick<ExecutionPreparationProjection, "id" | "version">, patch: PreparationUpdate) {
    const response = await apiClient.request<{ preparation: ExecutionPreparationProjection }>(`/v2/execution-preparations/${encodeURIComponent(preparation.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: preparation.version, ...patch }),
    });
    return response.preparation;
  },
  async start(preparation: Pick<ExecutionPreparationProjection, "id" | "version">) {
    return apiClient.request<StartPreparationResponse>(`/v2/execution-preparations/${encodeURIComponent(preparation.id)}/start`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: preparation.version }),
    });
  },
};
