import { apiClient } from "./api-client.js";

function queryString(values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && String(value).trim() !== "") params.set(key, String(value));
  }
  return params.toString();
}

export const semanticRepository = {
  providers() {
    return apiClient.request("/v2/semantic-resolver/providers");
  },
  searchExternal({ scheme = "wikidata", query, locale = "it", entityKind = "item", limit = 10 }) {
    return apiClient.request(`/v2/semantic-resolver/search?${queryString({ scheme, query, locale, entityKind, limit })}`);
  },
  resolveExternal({ scheme = "wikidata", id, locale = "it" }) {
    return apiClient.request(`/v2/semantic-resolver/resolve?${queryString({ scheme, id, locale })}`);
  },
  searchSubjects(search, { limit = 25, match = "label_exact" } = {}) {
    return apiClient.request(`/subjects?${queryString({ search, limit, match })}`);
  },
  createLocalSubject(payload) {
    return apiClient.request("/subjects", { method: "POST", body: JSON.stringify(payload) });
  },
  createSubjectFromExternalIdentity(payload) {
    return apiClient.request("/subjects/from-external-identity", { method: "POST", body: JSON.stringify(payload) });
  },
};
