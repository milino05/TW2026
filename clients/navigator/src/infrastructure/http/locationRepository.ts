import type { LogicalLocation } from "../../domain/location";
import { logicalLocationOf } from "../../domain/location";
import { apiClient } from "./apiClient";

interface PublicCodeResolutionResponse {
  location: LogicalLocation;
}

export const locationRepository = {
  async resolvePublicCode(sessionId: string, publicCode: string): Promise<LogicalLocation> {
    const response = await apiClient.request<PublicCodeResolutionResponse>(
      `/v2/visit-sessions/${encodeURIComponent(sessionId)}/location/resolve-public-code`,
      {
        method: "POST",
        body: JSON.stringify({ publicCode }),
      },
    );
    const location = logicalLocationOf(response?.location);
    if (!location) throw new Error("Il riferimento fisico non ha prodotto una posizione logica valida");
    return location;
  },
};
