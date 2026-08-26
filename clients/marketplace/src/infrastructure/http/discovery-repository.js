import { apiClient } from "./api-client.js";
function encoded(value) { return encodeURIComponent(String(value || "")); }
function query({ q = "", page = 1, limit = 12 } = {}) { const params = new URLSearchParams({ page: String(page), limit: String(limit) }); if (q) params.set("q", q); return params; }
export const discoveryRepository = {
  organizations(options = {}) { return apiClient.request(`/v2/marketplace/discovery/organizations?${query(options)}`); },
  organization(organizationId) { return apiClient.request(`/v2/marketplace/discovery/organizations/${encoded(organizationId)}`); },
  venues(options = {}) { return apiClient.request(`/v2/marketplace/discovery/venues?${query(options)}`); },
  venue(venueId) { return apiClient.request(`/v2/marketplace/discovery/venues/${encoded(venueId)}`); },
};
