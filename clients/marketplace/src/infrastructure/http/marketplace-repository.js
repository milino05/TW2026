import { apiClient } from "./api-client.js";

function principalParams({ principalType = "user", principalId = null } = {}) {
  const params = new URLSearchParams({ principalType });
  if (principalId) params.set("principalId", principalId);
  return params;
}

function venueParams(params, selectedVenueIds = []) {
  const values = [...new Set((selectedVenueIds || []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (values.length) params.set("selectedVenueIds", values.join(","));
  return params;
}

export const marketplaceRepository = {
  venueSelector() {
    return apiClient.request("/v2/marketplace/venue-selector");
  },
  catalog({ selectedVenueIds = [], page = 1, limit = 20, q = "", resourceTypes = null } = {}) {
    const params = venueParams(new URLSearchParams({ page: String(page), limit: String(limit) }), selectedVenueIds);
    if (q) params.set("q", q);
    if (Array.isArray(resourceTypes) && resourceTypes.length) params.set("resourceTypes", resourceTypes.join(","));
    return apiClient.request(`/v2/marketplace/catalog?${params.toString()}`);
  },
  detail(listingId, { selectedVenueIds = [] } = {}) {
    const params = venueParams(new URLSearchParams(), selectedVenueIds);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return apiClient.request(`/v2/marketplace/listings/${encodeURIComponent(listingId)}${suffix}`);
  },
  acquire(offerId, { beneficiaryType = "user", beneficiaryId = null } = {}) {
    return apiClient.request(`/v2/marketplace/offers/${encodeURIComponent(offerId)}/acquire`, {
      method: "POST",
      body: JSON.stringify({ beneficiaryType, beneficiaryId }),
    });
  },
  acquisitionHistory({ page = 1, limit = 20, beneficiaryType = "user", beneficiaryId = null } = {}) {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), beneficiaryType });
    if (beneficiaryId) params.set("beneficiaryId", beneficiaryId);
    return apiClient.request(`/v2/marketplace/acquisitions?${params.toString()}`);
  },
  workspace(principal = {}) {
    return apiClient.request(`/v2/marketplace/workspace?${principalParams(principal).toString()}`);
  },
  workspaceContext(principal = {}) {
    return apiClient.request(`/v2/marketplace/workspace/context?${principalParams(principal).toString()}`);
  },
  workspaceResources(principal = {}, { ownership = "owned", q = "", resourceTypes = null, page = 1, limit = 12 } = {}) {
    const params = principalParams(principal);
    params.set("ownership", ownership);
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (q) params.set("q", q);
    if (Array.isArray(resourceTypes) && resourceTypes.length) params.set("resourceTypes", resourceTypes.join(","));
    return apiClient.request(`/v2/marketplace/workspace/resources?${params.toString()}`);
  },
  distribution(principal = {}) {
    return apiClient.request(`/v2/marketplace/distribution?${principalParams(principal).toString()}`);
  },
  commerce(principal = {}, { page = 1, limit = 10 } = {}) {
    const params = principalParams(principal);
    params.set("page", String(page));
    params.set("limit", String(limit));
    return apiClient.request(`/v2/marketplace/commerce?${params.toString()}`);
  },
  createListing({ resourceType, resourceId, sellerType, sellerId }) {
    return apiClient.request("/v2/marketplace/listings", {
      method: "POST",
      body: JSON.stringify({ resourceType, resourceId, sellerType, sellerId }),
    });
  },
  createOffer(listingId, payload) {
    return apiClient.request(`/v2/marketplace/listings/${encodeURIComponent(listingId)}/offers`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  withdrawListing(listingId) {
    return apiClient.request(`/v2/marketplace/listings/${encodeURIComponent(listingId)}/withdraw`, { method: "POST" });
  },
  withdrawOffer(offerId) {
    return apiClient.request(`/v2/marketplace/offers/${encodeURIComponent(offerId)}/withdraw`, { method: "POST" });
  },
  executeWorkspaceOperation({ operationCode, sourceRef, targetPrincipal, payload = {} }) {
    return apiClient.request("/v2/marketplace/workspace/operations", {
      method: "POST",
      body: JSON.stringify({ operationCode, sourceRef, targetPrincipal, payload }),
    });
  },
};