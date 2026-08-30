export interface LogicalLocation {
  venueId: string;
  placeId: string;
  floorId: string | null;
  venueTargetId: string | null;
  exhibitSlotId: string | null;
}

export interface LocationObservation {
  providerId: string;
  observedAt: string;
  location: LogicalLocation;
}

export function logicalLocationOf(value: unknown): LogicalLocation | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const venueId = String(input.venueId || "").trim();
  const placeId = String(input.placeId || "").trim();
  if (!venueId || !placeId) return null;
  const floorId = String(input.floorId || "").trim() || null;
  const venueTargetId = String(input.venueTargetId || "").trim() || null;
  const exhibitSlotId = String(input.exhibitSlotId || "").trim() || null;
  return { venueId, placeId, floorId, venueTargetId, exhibitSlotId };
}

export function locationObservation({
  providerId,
  observedAt,
  location,
}: {
  providerId: string;
  observedAt?: string | Date;
  location: LogicalLocation;
}): LocationObservation {
  const provider = String(providerId || "").trim();
  if (!provider) throw new Error("Location provider non valido");
  const at = observedAt instanceof Date ? observedAt.toISOString() : String(observedAt || new Date().toISOString());
  return { providerId: provider, observedAt: at, location };
}
