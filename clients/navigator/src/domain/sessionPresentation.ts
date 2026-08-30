import type { MapProjection } from "../infrastructure/http/navigationRepository";
import type { AvailableAction } from "../infrastructure/http/sessionRepository";

export interface SessionStopContext {
  current: null | {
    visitAnchorId: string;
    label: string;
    order: number;
    venueName: string;
    floorLabel: string;
    approachInstruction: string | null;
  };
  next: null | {
    visitAnchorId: string;
    label: string;
    order: number;
    venueName: string;
    floorLabel: string;
    approachInstruction: string | null;
  };
  total: number;
}

export interface SessionActionGroups {
  progress: AvailableAction[];
  presentation: AvailableAction[];
  semantic: AvailableAction[];
  navigation: AvailableAction[];
  lifecycle: AvailableAction[];
  other: AvailableAction[];
}

export function resolveSessionStopContext(map: MapProjection | null, currentAnchorId: string | null): SessionStopContext {
  if (!map) return { current: null, next: null, total: 0 };
  const stops = map.venues
    .flatMap((venue) => venue.stops.map((stop) => ({
      ...stop,
      venueName: venue.name,
      floorLabel: venue.floors.find((floor) => floor.id === stop.floorId)?.label || stop.floorId,
    })))
    .sort((left, right) => left.order - right.order);
  const current = stops.find((stop) => stop.visitAnchorId === currentAnchorId) || null;
  const next = current ? stops.find((stop) => stop.order > current.order) || null : null;
  return { current, next, total: stops.length };
}

export function groupSessionActions(actions: AvailableAction[]): SessionActionGroups {
  const groups: SessionActionGroups = {
    progress: [],
    presentation: [],
    semantic: [],
    navigation: [],
    lifecycle: [],
    other: [],
  };
  for (const action of actions) {
    const target = action.family in groups
      ? groups[action.family as keyof SessionActionGroups]
      : groups.other;
    target.push(action);
  }
  return groups;
}

export function actionOfType(actions: AvailableAction[], type: string) {
  return actions.find((action) => action.type === type) || null;
}

const QUICK_PRESENTATION_TYPES = [
  "PRESENTATION_COMPLEXITY_DECREASE",
  "PRESENTATION_DEPTH_INCREASE",
];

export function quickPresentationActions(actions: AvailableAction[]) {
  const available = actions.filter((action) => action.family === "presentation");
  const prioritized = QUICK_PRESENTATION_TYPES
    .map((type) => actionOfType(available, type))
    .filter((action): action is AvailableAction => Boolean(action));
  for (const action of available) {
    if (prioritized.length >= 2) break;
    if (!prioritized.some((candidate) => candidate.actionId === action.actionId)) prioritized.push(action);
  }
  return prioritized;
}

export function presentationDurationLabel(seconds?: number) {
  const value = Math.max(0, Number(seconds) || 0);
  if (!value) return "Durata non stimata";
  if (value < 60) return "circa " + Math.max(5, Math.round(value / 5) * 5) + " secondi";
  const minutes = Math.max(1, Math.round(value / 60));
  return "circa " + minutes + (minutes === 1 ? " minuto" : " minuti");
}
