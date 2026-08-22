import { apiClient } from "./api-client.js";

function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).trim() !== "") query.set(key, String(value));
  }
  return query.toString();
}

export const authoringRepository = {
  searchSubjects({ search = "", externalScheme = null, externalId = null, limit = 30 } = {}) {
    const query = queryString({ search, externalScheme, externalId, limit });
    return apiClient.request(`/subjects${query ? `?${query}` : ""}`);
  },
  createSubject(payload) {
    return apiClient.request("/subjects", { method: "POST", body: JSON.stringify(payload) });
  },
  createItem({ primarySubjectId, ownerType, ownerId }) {
    return apiClient.request("/items", { method: "POST", body: JSON.stringify({ primarySubjectId, ownerType, ownerId }) });
  },
  projection(itemId, { editionId = null } = {}) {
    const query = editionId ? `?editionId=${encodeURIComponent(editionId)}` : "";
    return apiClient.request(`/v2/marketplace/item-authoring/${encodeURIComponent(itemId)}${query}`);
  },
  namespaceControls(namespaceId, principal) {
    const query = queryString({ principalType: principal?.type || "user", principalId: principal?.id || null });
    return apiClient.request(`/v2/marketplace/namespace-authoring/${encodeURIComponent(namespaceId)}?${query}`);
  },
  venueTargets(venueId) {
    return apiClient.request(`/v2/marketplace/venues/${encodeURIComponent(venueId)}/authoring-targets`);
  },
  venueTargetContext(venueTargetId) {
    return apiClient.request(`/v2/marketplace/venue-targets/${encodeURIComponent(venueTargetId)}/authoring-context`);
  },
  editorialReleaseComposer(editorialContextId) {
    return apiClient.request(`/v2/marketplace/editorial-contexts/${encodeURIComponent(editorialContextId)}/release-composer`);
  },
  createEditorialRelease(editorialContextId, payload) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/releases`, { method: "POST", body: JSON.stringify(payload) });
  },
  createEdition(itemId, payload) {
    return apiClient.request(`/items/${encodeURIComponent(itemId)}/editions`, { method: "POST", body: JSON.stringify(payload) });
  },
  updateEdition(editionId, payload) {
    return apiClient.request(`/item-editions/${encodeURIComponent(editionId)}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
  checkEdition(editionId) {
    return apiClient.request(`/item-editions/${encodeURIComponent(editionId)}/check-consistency`, { method: "POST" });
  },
  publishEdition(editionId) {
    return apiClient.request(`/item-editions/${encodeURIComponent(editionId)}/publish`, { method: "POST" });
  },
  setContentSpaceMembership({ contentSpaceId, itemId, member }) {
    return apiClient.request(`/content-spaces/${encodeURIComponent(contentSpaceId)}/items/${encodeURIComponent(itemId)}`, { method: member ? "PUT" : "DELETE" });
  },
  visitProjection({ visitId = null, principalType = "user", principalId = null } = {}) {
    if (visitId) return apiClient.request(`/v2/marketplace/visit-authoring/${encodeURIComponent(visitId)}`);
    const query = queryString({ principalType, principalId });
    return apiClient.request(`/v2/marketplace/visit-authoring/new${query ? `?${query}` : ""}`);
  },
  searchVisitContent({ editorialReleaseId, principalType = "user", principalId = null, q = "", page = 1, limit = 30 }) {
    const query = queryString({ principalType, principalId, q, page, limit });
    return apiClient.request(`/v2/marketplace/visit-authoring/releases/${encodeURIComponent(editorialReleaseId)}/content?${query}`);
  },
  createVisit(payload) {
    return apiClient.request("/v2/visits", { method: "POST", body: JSON.stringify(payload) });
  },
  updateVisit(visitId, payload) {
    return apiClient.request(`/v2/visits/${encodeURIComponent(visitId)}`, { method: "PATCH", body: JSON.stringify(payload) });
  },
};
