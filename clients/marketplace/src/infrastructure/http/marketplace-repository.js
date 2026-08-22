import { apiClient } from "./api-client.js";

export const marketplaceRepository = {
  catalog({ venueId = null, page = 1, limit = 20, q = "", resourceTypes = null } = {}) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (venueId) params.set("venueId", venueId);
    if (q) params.set("q", q);
    if (Array.isArray(resourceTypes) && resourceTypes.length) params.set("resourceTypes", resourceTypes.join(","));
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
  acquisitionHistory({ page = 1, limit = 20 } = {}) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    return apiClient.request(`/v2/marketplace/acquisitions?${params.toString()}`);
  },
};
