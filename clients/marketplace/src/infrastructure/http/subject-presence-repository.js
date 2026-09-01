import { apiClient } from "./api-client.js";

function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).trim() !== "") query.set(key, String(value));
  }
  return query.toString();
}
function jsonBody(payload = {}) { return { body: JSON.stringify(payload) }; }

export const subjectPresenceRepository = {
  get(subjectId, principal) {
    const query = queryString({ principalType: principal?.type || "user", principalId: principal?.id || null });
    return apiClient.request(`/v2/marketplace/subjects/${encodeURIComponent(subjectId)}/venue-presence${query ? `?${query}` : ""}`);
  },
  propose(venueId, { subjectId, sourceItemId = null, message = null }) {
    return apiClient.request(`/venues/${encodeURIComponent(venueId)}/inventory-proposals`, {
      method: "POST",
      ...jsonBody({ subjectId, sourceItemId, message }),
    });
  },
  addToInventory(venueId, { subjectId }) {
    return apiClient.request(`/venues/${encodeURIComponent(venueId)}/targets`, {
      method: "POST",
      ...jsonBody({ subjectId, provenance: { origin: "human" } }),
    });
  },
};
