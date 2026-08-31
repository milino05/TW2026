import { apiClient } from "./apiClient";

export type GenerationSourceRef = {
  resourceType: "editorial_context" | "editorial_release";
  resourceId: string;
};

export type GenerationSubjectOption = {
  id: string;
  preferredLabel: string;
  description: string;
  externalIdentities: Array<{ scheme: string; id: string; role: "canonical" | "historical"; canonicalId: string | null }>;
  matchSource: "local" | "external_grounded";
};

export type GenerationSubjectSearchResponse = {
  results: GenerationSubjectOption[];
  resolver: {
    status: "not_needed" | "grounded" | "no_source_binding" | "unavailable";
    used: boolean;
    groundedResultCount?: number;
    provider?: {
      scheme: string;
      label: string;
      attribution?: { label: string; url: string };
    };
  };
  warnings: Array<{ code: string; message: string }>;
};

export type GenerationSemanticGoal = {
  feature: { kind: "subject"; subjectId: string };
  priority: "required" | "preferred" | "avoid";
  weight: number;
};

export type GenerationNavigationRequirement = {
  physicalFeatureRef:
    | { kind: "local"; physicalVocabularyId: string; definitionId: string }
    | { kind: "semantic"; semanticRefs: Array<{ scheme: string; id: string; matchType: "exact" | "close" | "broader" | "narrower" }> };
  operator: "eq" | "neq" | "gte" | "lte" | "gt" | "lt" | "in";
  value: boolean | number | string | string[];
  priority: "required" | "preferred" | "avoid";
  weight?: number;
};

export type GenerationRoutingProfileSelection = {
  venueId: string;
  routingProfileDefinitionId: string;
};

export interface GenerationOptionsProjection {
  physicalScope: {
    organizations: Array<{
      id: string;
      name: string;
      description: string;
      venues: Array<{ id: string; name: string; description: string; selected: boolean }>;
    }>;
    selectedVenueIds: string[];
  };
  editorialScope: {
    contentSpaces: Array<{
      id: string;
      name: string;
      description: string;
      owner: { type: "user" | "organization"; id: string; name: string };
      contexts: Array<{
        id: string;
        name: string;
        description: string;
        namespace: { id: string; name: string };
        sources: Array<{
          sourceRef: GenerationSourceRef;
          versionMode: "follow_current" | "pinned";
          version: number | null;
          accessKind: "owned" | "licensed";
          recommendedForVenueIds: string[];
        }>;
      }>;
    }>;
    defaultSources: GenerationSourceRef[];
    independentFromPhysicalScope: boolean;
  };
  controls: {
    timeBudget: { label: string; unit: "seconds"; minimum: number };
    presentation: {
      depthPreference: { label: string; minimum: number; maximum: number };
      languageComplexityPreference: { label: string; minimum: number; maximum: number };
      locale: { label: string; optional: boolean };
    };
    navigation: {
      movementPacePreference: { label: string; minimum: number; maximum: number };
      profilesByVenue: Array<{
        venueId: string;
        physicalVocabularyRevisionId: string;
        profiles: Array<{
          definitionId: string;
          label: string;
          description: string;
          requirements: Array<{
            label: string;
            operator: string;
            value: unknown;
            priority: "required" | "preferred" | "avoid";
          }>;
        }>;
      }>;
      requirements: Array<{
        key: string;
        label: string;
        dataType: "boolean" | "number" | string;
        unit: string | null;
        description: string;
        options: Array<{ value: string; label: string }>;
        recommendedOperator?: "eq" | "gte" | "lte";
        physicalFeatureRef: GenerationNavigationRequirement["physicalFeatureRef"];
      }>;
    };
    semantic: { sourceScoped: boolean; message: string };
  };
}

export interface GeneratedPlanProjection {
  id: string;
  status: "proposed" | "accepted" | "superseded";
  createdAt: string;
  acceptedAt: string | null;
  materializedVisitId: string | null;
  editorialSources: Array<{ name: string; version: number | null; versionMode: "follow_current" | "pinned" }>;
  physicalScope: Array<{ id: string; name: string; description: string }>;
  contentEntries: Array<{
    position: number;
    title: string;
    role: "core" | "recommended" | "optional";
    authorCredits: string[];
    license: string | null;
    delivery: { targetLabel: string; venueName: string } | null;
    estimatedContentSeconds: number;
  }>;
  stops: Array<{ position: number; label: string; venueName: string }>;
  timing: {
    totalSeconds: number;
    contentSeconds: number;
    observationSeconds: number;
    travelSeconds: number;
    reservedSeconds: number;
  };
  routeSummary: { stopCount: number; legCount: number; venueCount: number; interVenueLegCount: number };
  warnings: Array<{ code: string; message: string }>;
  operations: Array<{ code: "accept" | "start" | "materialize" | "open_visit"; label: string; visitId?: string }>;
}

export interface GenerationRequest {
  venueIds: string[];
  editorialSources?: GenerationSourceRef[];
  timeBudgetSeconds: number;
  hardTimeBudget?: boolean;
  semanticGoals?: GenerationSemanticGoal[];
  depthPreference?: number;
  languageComplexityPreference?: number;
  locale?: string;
  movementPacePreference?: number;
  routingProfileSelections?: GenerationRoutingProfileSelection[];
  navigationRequirements?: GenerationNavigationRequirement[];
  historyMode?: "full" | "declared_only" | "current_request_only";
  interVenueTransfers?: Array<{
    fromVenueId: string;
    toVenueId: string;
    estimatedSeconds: number;
    instruction?: string;
  }>;
}

export interface MaterializationResult {
  planId: string;
  visitId: string;
  visitRevisionId: string;
  status: "published";
  alreadyMaterialized: boolean;
}

function selectedVenueQuery(selectedVenueIds: string[]) {
  const query = new URLSearchParams();
  if (selectedVenueIds.length) query.set("selectedVenueIds", selectedVenueIds.join(","));
  const value = query.toString();
  return value ? `?${value}` : "";
}

export const generatorRepository = {
  options(selectedVenueIds: string[] = []) {
    return apiClient.request<GenerationOptionsProjection>(`/v2/navigator/generation-options${selectedVenueQuery(selectedVenueIds)}`);
  },
  searchSubjects(editorialSources: GenerationSourceRef[], query = "", limit = 20, locale = "it", signal?: AbortSignal) {
    return apiClient.request<GenerationSubjectSearchResponse>("/v2/navigator/generation-subjects/search", {
      method: "POST",
      body: JSON.stringify({ editorialSources, query, limit, locale }),
      signal,
    });
  },
  generate(request: GenerationRequest) {
    return apiClient.request<GeneratedPlanProjection>("/v2/generated-plans", {
      method: "POST",
      body: JSON.stringify(request),
    });
  },
  get(planId: string) {
    return apiClient.request<GeneratedPlanProjection>(`/v2/generated-plans/${encodeURIComponent(planId)}`);
  },
  accept(planId: string) {
    return apiClient.request<GeneratedPlanProjection>(`/v2/generated-plans/${encodeURIComponent(planId)}/accept`, { method: "POST" });
  },
  materialize(planId: string, title?: string) {
    return apiClient.request<MaterializationResult>(`/v2/generated-plans/${encodeURIComponent(planId)}/materialize`, {
      method: "POST",
      body: JSON.stringify(title?.trim() ? { title: title.trim() } : {}),
    });
  },
};