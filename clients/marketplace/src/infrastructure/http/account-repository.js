import { apiClient } from "./api-client.js";

export const accountRepository = {
  workspace() {
    return apiClient.request("/v2/marketplace/account-workspace");
  },
  createOrganization(payload) {
    return apiClient.request("/organizations", { method: "POST", body: JSON.stringify(payload) });
  },
  updateOrganization(organizationId, payload) {
    return apiClient.request(`/organizations/${encodeURIComponent(organizationId)}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  addOrganizationMember(organizationId, payload) {
    return apiClient.request(`/organizations/${encodeURIComponent(organizationId)}/members`, { method: "POST", body: JSON.stringify(payload) });
  },
  updateOrganizationMemberRole(organizationId, userId, role) {
    return apiClient.request(`/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}/role`, { method: "PUT", body: JSON.stringify({ role }) });
  },
  removeOrganizationMember(organizationId, userId) {
    return apiClient.request(`/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`, { method: "DELETE" });
  },
  createVenue(payload) {
    return apiClient.request("/venues", { method: "POST", body: JSON.stringify(payload) });
  },
  updateVenue(venueId, payload) {
    return apiClient.request(`/venues/${encodeURIComponent(venueId)}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  createNamespace(payload) {
    return apiClient.request("/namespaces", { method: "POST", body: JSON.stringify(payload) });
  },
  updateNamespace(namespaceId, payload) {
    return apiClient.request(`/namespaces/${encodeURIComponent(namespaceId)}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  updatePresentationPreference(payload) {
    return apiClient.request("/users/me/presentation-preference", { method: "PUT", body: JSON.stringify(payload) });
  },
  updateNavigationPreference(payload) {
    return apiClient.request("/users/me/navigation-preference", { method: "PUT", body: JSON.stringify(payload) });
  },
  updateLearningPreferences(payload) {
    return apiClient.request("/users/me/adaptive-learning", { method: "PUT", body: JSON.stringify(payload) });
  },
};
