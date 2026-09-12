import { apiClient } from "./api-client.js";

export const venueCreationRepository = {
  preflight(ownerOrganizationId) {
    const query = new URLSearchParams({ ownerOrganizationId: String(ownerOrganizationId || "") });
    return apiClient.request(`/venues/creation-preflight?${query.toString()}`);
  },
  create(payload) {
    return apiClient.request("/venues/configured", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
