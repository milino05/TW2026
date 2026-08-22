import { apiClient } from "./apiClient";

export interface MapPoint { x: number; y: number }
export interface RouteOverlay { floorKey: string; points: MapPoint[] }
export interface FloorTransition {
  fromFloorKey: string;
  toFloorKey: string;
  from: MapPoint;
  to: MapPoint;
  instruction: string | null;
}

export interface MapProjection {
  venues: Array<{
    id: string;
    name: string;
    description: string;
    floors: Array<{
      key: string;
      label: string;
      map: { available: boolean; imageUrl: string | null; width: number | null; height: number | null };
    }>;
    stops: Array<{
      visitAnchorId: string;
      venueTargetId: string;
      label: string;
      floorKey: string;
      position: MapPoint;
      order: number;
    }>;
    facilities: Array<{
      id: string;
      label: string;
      category: string;
      userIntents: string[];
      floorKey: string;
      position: MapPoint;
    }>;
    route: {
      overlays: Array<RouteOverlay & { fromVisitAnchorId: string; toVisitAnchorId: string }>;
      floorTransitions: Array<FloorTransition & { fromVisitAnchorId: string; toVisitAnchorId: string }>;
    };
    warnings: Array<{ code: string; message: string }>;
  }>;
  interVenueTransitions: Array<{
    fromVisitAnchorId: string;
    toVisitAnchorId: string;
    estimatedSeconds: number;
    instruction: string | null;
  }>;
}

export interface NavigationProjection {
  destination: {
    kind: "venue_place";
    venueId: string;
    label: string;
    category: string;
    floorKey: string;
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
