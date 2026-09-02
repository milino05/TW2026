import { apiClient } from "./api-client.js";

function queryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).trim() !== "") query.set(key, String(value));
  }
  return query.toString();
}

function jsonBody(payload = {}) {
  return { body: JSON.stringify(payload) };
}

export const editorialRepository = {
  listSpaces({ ownerType = null, ownerId = null } = {}) {
    const query = queryString({ ownerType, ownerId });
    return apiClient.request(`/content-spaces${query ? `?${query}` : ""}`);
  },
  createSpace(payload) {
    return apiClient.request("/content-spaces", { method: "POST", ...jsonBody(payload) });
  },
  spaceSummaries({ ownerType = null, ownerId = null } = {}) {
    const query = queryString({ ownerType, ownerId });
    return apiClient.request(`/v2/marketplace/editorial-spaces${query ? `?${query}` : ""}`);
  },
  getSpace(contentSpaceId) {
    return apiClient.request(`/content-spaces/${encodeURIComponent(contentSpaceId)}`);
  },
  spaceProjection(contentSpaceId) {
    return apiClient.request(`/v2/marketplace/editorial-spaces/${encodeURIComponent(contentSpaceId)}`);
  },
  listSpaceItems(contentSpaceId, { q = "", page = 1, limit = 30 } = {}) {
    const query = queryString({ q, page, limit });
    return apiClient.request(`/content-spaces/${encodeURIComponent(contentSpaceId)}/items?${query}`);
  },
  listCollections({ contentSpaceId = null, namespaceId = null } = {}) {
    const query = queryString({ contentSpaceId, namespaceId });
    return apiClient.request(`/editorial-contexts${query ? `?${query}` : ""}`);
  },
  relationChoices({ ownerType = null, ownerId = null, q = "", page = 1, limit = 12 } = {}) {
    const query = queryString({ ownerType, ownerId, q, page, limit });
    return apiClient.request(`/v2/marketplace/editorial-relations?${query}`);
  },
  reusableSemanticGraphs({ ownerType = null, ownerId = null, namespaceId = null, q = "", page = 1, limit = 30 } = {}) {
    const query = queryString({ ownerType, ownerId, namespaceId, q, page, limit });
    return apiClient.request(`/v2/marketplace/semantic-graphs?${query}`);
  },
  createCollection(payload) {
    return apiClient.request("/v2/marketplace/editorial-collections", { method: "POST", ...jsonBody(payload) });
  },
  updateCollection(editorialContextId, payload) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}`, { method: "PATCH", ...jsonBody(payload) });
  },
  studio(editorialContextId) {
    return apiClient.request(`/v2/marketplace/editorial-contexts/${encodeURIComponent(editorialContextId)}/studio`);
  },
  candidates(editorialContextId, { q = "", page = 1, limit = 30 } = {}) {
    const query = queryString({ q, page, limit });
    return apiClient.request(`/v2/marketplace/editorial-contexts/${encodeURIComponent(editorialContextId)}/candidates?${query}`);
  },
  entries(editorialContextId, { q = "", page = 1, limit = 50 } = {}) {
    const query = queryString({ q, page, limit });
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/entries?${query}`);
  },
  addEntry(editorialContextId, payload) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/entries`, { method: "POST", ...jsonBody(payload) });
  },
  updateEntry(editorialContextId, entryId, payload) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/entries/${encodeURIComponent(entryId)}`, { method: "PATCH", ...jsonBody(payload) });
  },
  removeEntry(editorialContextId, entryId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/entries/${encodeURIComponent(entryId)}`, { method: "DELETE" });
  },
  graph(editorialContextId, { view = "working" } = {}) {
    const query = queryString({ view });
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph?${query}`);
  },
  graphSubjectCandidates(editorialContextId, { scope = "collection", q = "", page = 1, limit = 12 } = {}) {
    const query = queryString({ scope, q, page, limit });
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph/subject-candidates?${query}`);
  },
  addGraphSubject(editorialContextId, subjectId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph/subjects/${encodeURIComponent(subjectId)}`, { method: "POST" });
  },
  removeGraphSubject(editorialContextId, subjectId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph/subjects/${encodeURIComponent(subjectId)}`, { method: "DELETE" });
  },
  addGraphEdge(editorialContextId, payload) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph/edges`, { method: "POST", ...jsonBody(payload) });
  },
  updateGraphEdge(editorialContextId, edgeId, payload) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph/edges/${encodeURIComponent(edgeId)}`, { method: "PATCH", ...jsonBody(payload) });
  },
  removeGraphEdge(editorialContextId, edgeId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph/edges/${encodeURIComponent(edgeId)}`, { method: "DELETE" });
  },
  setSubjectClasses(editorialContextId, subjectId, subjectClassDefinitionIds) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph/subjects/${encodeURIComponent(subjectId)}/classes`, {
      method: "PUT",
      ...jsonBody({ subjectClassDefinitionIds }),
    });
  },
  check(editorialContextId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/check`, { method: "POST" });
  },
  requestReview(editorialContextId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/review`, { method: "POST" });
  },
  withdrawReview(editorialContextId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/review`, { method: "DELETE" });
  },
  approveReview(editorialContextId, revisionId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/review/${encodeURIComponent(revisionId)}/approve`, { method: "POST" });
  },
  requestChanges(editorialContextId, revisionId, message) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/review/${encodeURIComponent(revisionId)}/request-changes`, {
      method: "POST",
      ...jsonBody({ message }),
    });
  },
  revisions(editorialContextId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/revisions`);
  },
  releases(editorialContextId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/releases`);
  },
  publish(editorialContextId, editorialContextRevisionId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/releases`, {
      method: "POST",
      ...jsonBody({ editorialContextRevisionId }),
    });
  },
  removeSpace(contentSpaceId) {
    return apiClient.request(`/content-spaces/${encodeURIComponent(contentSpaceId)}`, { method: "DELETE" });
  },
};
