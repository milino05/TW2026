import { apiClient } from "./api-client.js";

function encoded(value) { return encodeURIComponent(String(value || "")); }

export const managementRepository = {
  organization(organizationId, query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
    const suffix = params.toString() ? `?${params}` : "";
    return apiClient.request(`/v2/marketplace/management/organizations/${encoded(organizationId)}${suffix}`);
  },
  namespace(namespaceId) {
    return apiClient.request(`/v2/marketplace/management/namespaces/${encoded(namespaceId)}`);
  },
  venue(venueId) {
    return apiClient.request(`/v2/marketplace/management/venues/${encoded(venueId)}`);
  },
  ensureNamespaceWorking(namespaceId) {
    return apiClient.request(`/namespaces/${encoded(namespaceId)}/working-revision?create=true`);
  },
  updateNamespaceRevision(namespaceId, payload) {
    return apiClient.request(`/namespaces/${encoded(namespaceId)}/working-revision`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  namespaceWorkflow(namespaceId, action, payload = {}) {
    return apiClient.request(`/namespaces/${encoded(namespaceId)}/working-revision/${action}`, { method: "POST", body: JSON.stringify(payload) });
  },
  ensureVenueRelease(venueId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release`, { method: "POST", body: "{}" });
  },
  updateVenueRelease(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  venueWorkflow(venueId, action, { method = "POST", payload = {} } = {}) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release/${action}`, { method, body: method === "DELETE" ? undefined : JSON.stringify(payload) });
  },
  searchSubjects(search) {
    const params = new URLSearchParams({ search: String(search || ""), limit: "25" });
    return apiClient.request(`/subjects?${params}`);
  },
  createVenueTarget(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/targets`, { method: "POST", body: JSON.stringify(payload) });
  },
  updateVenueTarget(venueId, targetId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/targets/${encoded(targetId)}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  trashVenueTarget(venueId, targetId) {
    return apiClient.request(`/venues/${encoded(venueId)}/targets/${encoded(targetId)}`, { method: "DELETE" });
  },
};
