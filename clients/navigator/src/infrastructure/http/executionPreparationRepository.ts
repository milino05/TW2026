import { apiClient } from "./apiClient";
import type { SessionProjection } from "./sessionRepository";
import type { SynchronizedVisitProjection } from "./synchronizedVisitRepository";

export type ExecutionMode = "self_guided" | "synchronized";

export type RoutingProfileSelection = {
  venueId: string;
  routingProfileDefinitionId: string;
};

export type VenueControlSelection = {
  venueId: string;
  physicalAttributeDefinitionId: string;
  value?: unknown;
};

export type PersonalNavigationNeedDefinition = {
  id: string;
  label: string;
  description: string;
  dataType: "boolean" | "number" | "choice" | "string";
  unit: string | null;
  valueMode: "fixed" | "user";
  value?: unknown;
  allowedPriorities: Array<"preferred" | "required">;
  defaultPriority: "preferred" | "required";
  advanced: boolean;
};

export type PersonalNavigationNeedSelection = {
  id: string;
  label: string;
  description: string;
  priority: "preferred" | "required";
  value: unknown;
  unit: string | null;
  advanced: boolean;
};

export type PersonalNavigationNeedSelectionInput = {
  id: string;
  priority: "preferred" | "required";
  value?: unknown;
};

export type RoutingProfileDefinition = {
  definitionId: string;
  label: string;
  description: string;
  requirements: Array<{
    label: string;
  }>;
};

export type VenueNavigationControl = {
  definitionId: string;
  label: string;
  description: string;
  dataType: "boolean" | "number" | "choice";
  unit: string | null;
  options: Array<{ value: string; label: string }>;
  valueMode: "fixed" | "user";
  value?: unknown;
};

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
  executionMode: ExecutionMode;
  availableExecutionModes: ExecutionMode[];
  groupSessionSetup: {
    requestedJoinAlias: string | null;
  };
  effectivePresentationPreference: null | {
    depthPreference: number | null;
    languageComplexityPreference: number | null;
    locale: string | null;
  };
  navigation: {
    movementPacePreference: number;
    personalNeeds: {
      catalog: PersonalNavigationNeedDefinition[];
      selected: PersonalNavigationNeedSelection[];
      supportByVenue: Array<{
        venueId: string;
        name: string;
        needs: Array<{ id: string; supported: boolean; definitionId: string | null }>;
      }>;
    };
    routingProfileSelections: RoutingProfileSelection[];
    venueControlSelections: VenueControlSelection[];
    venues: Array<{
      venueId: string;
      name: string;
      selectedProfileDefinitionId: string | null;
      profiles: RoutingProfileDefinition[];
      controls: VenueNavigationControl[];
    }>;
  };
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
  synchronizedSessionId: string | null;
}

export interface PreparationUpdate {
  presentationPreference?: {
    depthPreference?: number;
    languageComplexityPreference?: number;
    locale?: string;
  };
  movementPacePreference?: number;
  personalNeedSelections?: PersonalNavigationNeedSelectionInput[];
  venueControlSelections?: VenueControlSelection[];
  routingProfileSelections?: RoutingProfileSelection[];
  executionMode?: ExecutionMode;
  groupSessionSetup?: {
    requestedJoinAlias?: string | null;
  };
}

interface StartPreparationResponse {
  session: { _id: string };
  current: SessionProjection;
  preparation: ExecutionPreparationProjection;
  alreadyStarted: boolean;
  synchronized?: SynchronizedVisitProjection;
}

async function createPreparation(payload: { visitId?: string; generatedVisitPlanId?: string; executionMode?: ExecutionMode }) {
  const response = await apiClient.request<{ preparation: ExecutionPreparationProjection }>("/v2/execution-preparations", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return response.preparation;
}

export const executionPreparationRepository = {
  createForVisit(visitId: string, executionMode: ExecutionMode = "self_guided") {
    return createPreparation({ visitId, executionMode });
  },
  createForGeneratedPlan(generatedVisitPlanId: string) {
    return createPreparation({ generatedVisitPlanId, executionMode: "self_guided" });
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
