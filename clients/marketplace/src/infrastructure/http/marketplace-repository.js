import { apiClient } from "./api-client.js";

function principalParams({ principalType = "user", principalId = null } = {}) {
  const params = new URLSearchParams({ principalType });
  if (principalId) params.set("principalId", principalId);
  return params;
}

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
  workspace(principal = {}) {
    return apiClient.request(`/v2/marketplace/workspace?${principalParams(principal).toString()}`);
  },
  distribution(principal = {}) {
    return apiClient.request(`/v2/marketplace/distribution?${principalParams(principal).toString()}`);
  },
  createListing({ resourceType, resourceId, sellerType, sellerId }) {
    return apiClient.request("/v2/marketplace/listings", {
      method: "POST",
      body: JSON.stringify({ resourceType, resourceId, sellerType, sellerId }),
    });
  },
  executeWorkspaceOperation({ operationCode, sourceRef, targetPrincipal, payload = {} }) {
    return apiClient.request("/v2/marketplace/workspace/operations", {
      method: "POST",
      body: JSON.stringify({ operationCode, sourceRef, targetPrincipal, payload }),
    });
  },
};
