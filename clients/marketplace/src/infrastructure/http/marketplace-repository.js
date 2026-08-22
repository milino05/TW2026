import { apiClient } from "./api-client.js";

export const marketplaceRepository = {
  catalog({ venueId = null, page = 1, limit = 20 } = {}) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (venueId) params.set("venueId", venueId);
    return apiClient.request(`/v2/marketplace/catalog?${params.toString()}`);
  },
  detail(listingId) {
    return apiClient.request(`/v2/marketplace/listings/${encodeURIComponent(listingId)}`);
  },
  acquire(offerId) {
    return apiClient.request(`/v2/marketplace/offers/${encodeURIComponent(offerId)}/acquire`, {
      method: "POST",
      body: JSON.stringify({ beneficiaryType: "user" }),
    });
  },
};
