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
  reusableSemanticGraphs({ ownerType = null, ownerId = null, namespaceId = null, contentSpaceId = null, q = "", page = 1, limit = 30 } = {}) {
    const query = queryString({ ownerType, ownerId, namespaceId, contentSpaceId, q, page, limit });
    return apiClient.request(`/v2/marketplace/semantic-graphs?${query}`);
  },
  semanticGraphs({ ownerType, ownerId, namespaceId = null, q = "", page = 1, limit = 30 } = {}) {
    const query = queryString({ ownerType, ownerId, namespaceId, q, page, limit });
    return apiClient.request(`/semantic-graphs?${query}`);
  },
  semanticGraph(semanticGraphId) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}`);
  },
  createSemanticGraph(payload) {
    return apiClient.request("/semantic-graphs", { method: "POST", ...jsonBody(payload) });
  },
  updateSemanticGraph(semanticGraphId, payload) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}`, { method: "PATCH", ...jsonBody(payload) });
  },
  forkSemanticGraph(semanticGraphId, payload) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/fork`, { method: "POST", ...jsonBody(payload) });
  },
  removeSemanticGraph(semanticGraphId) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}`, { method: "DELETE" });
  },
  restoreSemanticGraph(semanticGraphId) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/restore`, { method: "POST" });
  },
  semanticGraphSnapshot(semanticGraphId) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/snapshot`);
  },
  semanticGraphNeighborhood(semanticGraphId, { focusSubjectId = null, limit = 18 } = {}) {
    const query = queryString({ focusSubjectId, limit });
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/neighborhood?${query}`);
  },
  semanticGraphSubjects(semanticGraphId, { q = "", page = 1, limit = 30 } = {}) {
    const query = queryString({ q, page, limit });
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/subjects?${query}`);
  },
  addStandaloneGraphSubject(semanticGraphId, subjectId) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/subjects/${encodeURIComponent(subjectId)}`, { method: "POST" });
  },
  removeStandaloneGraphSubject(semanticGraphId, subjectId) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/subjects/${encodeURIComponent(subjectId)}`, { method: "DELETE" });
  },
  setStandaloneGraphSubjectClasses(semanticGraphId, subjectId, subjectClassDefinitionIds) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/subjects/${encodeURIComponent(subjectId)}/classes`, {
      method: "PUT",
      ...jsonBody({ subjectClassDefinitionIds }),
    });
  },
  addStandaloneGraphEdge(semanticGraphId, payload) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/edges`, { method: "POST", ...jsonBody(payload) });
  },
  updateStandaloneGraphEdge(semanticGraphId, edgeId, payload) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/edges/${encodeURIComponent(edgeId)}`, { method: "PATCH", ...jsonBody(payload) });
  },
  removeStandaloneGraphEdge(semanticGraphId, edgeId) {
    return apiClient.request(`/semantic-graphs/${encodeURIComponent(semanticGraphId)}/edges/${encodeURIComponent(edgeId)}`, { method: "DELETE" });
  },
  createCollection(payload) {
    return apiClient.request("/v2/marketplace/editorial-collections", { method: "POST", ...jsonBody(payload) });
  },
  updateCollection(editorialContextId, payload) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}`, { method: "PATCH", ...jsonBody(payload) });
  },
  changeCollectionGraph(editorialContextId, semanticGraphId) {
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph`, {
      method: "PATCH",
      ...jsonBody({ semanticGraphId }),
    });
  },
  studio(editorialContextId) {
    return apiClient.request(`/v2/marketplace/editorial-contexts/${encodeURIComponent(editorialContextId)}/studio`);
  },
  candidates(editorialContextId, { q = "", page = 1, limit = 30 } = {}) {
    const query = queryString({ q, page, limit });
    return apiClient.request(`/v2/marketplace/editorial-contexts/${encodeURIComponent(editorialContextId)}/candidates?${query}`);
  },
  externalCandidates(editorialContextId, { q = "", page = 1, limit = 12 } = {}) {
    const query = queryString({ q, page, limit });
    return apiClient.request(`/v2/marketplace/editorial-contexts/${encodeURIComponent(editorialContextId)}/external-candidates?${query}`);
  },
  importExternalCandidate(editorialContextId, itemEditionId) {
    return apiClient.request(`/v2/marketplace/editorial-contexts/${encodeURIComponent(editorialContextId)}/import-entry`, {
      method: "POST",
      ...jsonBody({ itemEditionId }),
    });
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
  graphNeighborhood(editorialContextId, { view = "working", focusSubjectId = null, limit = 18 } = {}) {
    const query = queryString({ view, focusSubjectId, limit });
    return apiClient.request(`/editorial-contexts/${encodeURIComponent(editorialContextId)}/semantic-graph/neighborhood?${query}`);
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
