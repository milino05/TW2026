import { apiClient } from "./apiClient";

export interface MapPoint { x: number; y: number }
export interface RouteOverlay { floorId: string; points: MapPoint[] }
export interface FloorTransition {
  fromFloorId: string;
  toFloorId: string;
  from: MapPoint;
  to: MapPoint;
  instruction: string | null;
}

export interface PlannedNavigationLeg {
  type: "indoor" | "inter_venue";
  fromVisitAnchorId: string;
  toVisitAnchorId: string;
  transferInstruction: string | null;
  macroSteps: Array<{
    direction: "forward" | "backward";
    instruction: string | null;
    distanceMeters: number;
    estimatedSeconds: number;
  }>;
  approachStep: null | {
    instruction: string;
    resolutionSource: "source_slot_override" | "incoming_connection_override" | "default" | "fallback";
  };
}

export interface NavigationProjection {
  destination: {
    kind: "venue_place";
    venueId: string;
    label: string;
    category: string;
    physicalFeatureRef?: null | { kind: "local"; physicalVocabularyId: string; definitionId: string };
    floorId: string;
    position: MapPoint;
  };
  route: {
    estimatedSeconds: number;
    distanceMeters: number;
    overlays: RouteOverlay[];
    floorTransitions: FloorTransition[];
    instructions: string[];
    warnings: Array<{ code: string; message: string }>;
  };
}

export type ActiveNavigationProjection =
  | ({ intent: "visit_progression" | "physical_detour"; type: "indoor" } & NavigationProjection)
  | {
      intent: "visit_progression";
      type: "inter_venue";
      destination: { venueId: string; placeId: string };
      route: {
        estimatedSeconds: number;
        distanceMeters: null;
        transferInstruction: string | null;
        overlays: [];
        floorTransitions: [];
        instructions: string[];
        warnings: Array<{ code: string; message: string }>;
      };
    };

export interface MapKnownLocationProjection {
  venueId: string;
  placeId: string;
  floorId: string;
  position: MapPoint;
  label: string | null;
  category: string | null;
  visitAnchorId: string | null;
  venueTargetId: string | null;
  exhibitSlotId: string | null;
  source: "manual_selection" | "navigation_confirmation" | "qr" | "teleport" | "geolocation";
  providerId: string | null;
  observedAt: string | null;
}

export interface SelectableLocationProjection {
  kind: "place" | "visit_area" | "facility";
  venueId: string;
  placeId: string;
  visitAnchorId: string | null;
  label: string;
  category: string;
  floorId: string;
  position: MapPoint;
  locationRef:
    | { kind: "place"; venueId: string; placeId: string }
    | { kind: "visit_anchor"; visitAnchorId: string };
}

export interface VisitStopProjection {
  visitAnchorId: string;
  venueTargetId: string;
  exhibitSlotId: string;
  label: string;
  approachInstruction: string | null;
  floorId: string;
  position: MapPoint;
  order: number;
  sequencePosition: "before_current" | "current" | "after_current";
  experienced: boolean;
}

export interface MapProjection {
  venues: Array<{
    id: string;
    name: string;
    description: string;
    floors: Array<{
      id: string;
      label: string;
      map: { available: boolean; imageUrl: string | null; width: number | null; height: number | null };
    }>;
    stops: VisitStopProjection[];
    facilities: Array<{
      id: string;
      label: string;
      category: string;
      physicalFeatureRef: { kind: "local"; physicalVocabularyId: string; definitionId: string };
      floorId: string;
      position: MapPoint;
    }>;
    route: {
      overlays: Array<RouteOverlay & { fromVisitAnchorId: string; toVisitAnchorId: string }>;
      floorTransitions: Array<FloorTransition & { fromVisitAnchorId: string; toVisitAnchorId: string }>;
    };
    warnings: Array<{ code: string; message: string }>;
  }>;
  logicalCurrentStop: null | { visitAnchorId: string; venueId: string };
  plannedLegs: PlannedNavigationLeg[];
  interVenueTransitions: Array<{
    fromVisitAnchorId: string;
    toVisitAnchorId: string;
    estimatedSeconds: number;
    instruction: string | null;
  }>;
  knownLocation: MapKnownLocationProjection | null;
  narrativeContextStop: null | (VisitStopProjection & { venueId: string });
  selectableLocations: SelectableLocationProjection[];
  plannedVisitRoute: {
    plannedLegs: PlannedNavigationLeg[];
    interVenueTransitions: Array<{
      fromVisitAnchorId: string;
      toVisitAnchorId: string;
      estimatedSeconds: number;
      instruction: string | null;
    }>;
    venues: Array<{
      venueId: string;
      route: {
        overlays: Array<RouteOverlay & { fromVisitAnchorId: string; toVisitAnchorId: string }>;
        floorTransitions: Array<FloorTransition & { fromVisitAnchorId: string; toVisitAnchorId: string }>;
      };
    }>;
  };
  activeNavigation: ActiveNavigationProjection | null;
}

export interface ObstacleCheckProjection {
  verified: boolean;
  obstacles: Array<{ code: string; label: string; message: string }>;
  message: string;
}

export const navigationRepository = {
  map(sessionId: string) {
    return apiClient.request<MapProjection>(`/v2/visit-sessions/${encodeURIComponent(sessionId)}/map`);
  },
};
