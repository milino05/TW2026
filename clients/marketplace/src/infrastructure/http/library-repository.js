import { apiClient } from "./api-client.js";

function jsonBody(payload = {}) { return { body: JSON.stringify(payload) }; }

export const libraryRepository = {
  itemAddContext(contentSpaceId, subjectId) {
    const query = new URLSearchParams({ subjectId: String(subjectId || "") });
    return apiClient.request(`/content-spaces/${encodeURIComponent(contentSpaceId)}/item-add-context?${query.toString()}`);
  },
  itemDetail(contentSpaceId, itemId) {
    return apiClient.request(`/content-spaces/${encodeURIComponent(contentSpaceId)}/items/${encodeURIComponent(itemId)}/detail`);
  },
  createItem({ primarySubjectId, ownerType, ownerId, contentSpaceId, recognitionMedia = null, creationMode = "reuse_first" }) {
    return apiClient.request("/items", {
      method: "POST",
      ...jsonBody({ primarySubjectId, ownerType, ownerId, contentSpaceId, recognitionMedia, creationMode }),
    });
  },
  addItemToSpace(contentSpaceId, itemId) {
    return apiClient.request(`/content-spaces/${encodeURIComponent(contentSpaceId)}/items/${encodeURIComponent(itemId)}`, { method: "PUT" });
  },
};
