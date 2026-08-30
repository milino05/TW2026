import { apiClient } from "./api-client.js";

function body(payload = {}) { return { body: JSON.stringify(payload) }; }

export const visitSequenceRepository = {
  reorderContent(visitId, contentEntryId, toIndex) {
    return apiClient.request(
      `/v2/visits/${encodeURIComponent(visitId)}/commands/content/${encodeURIComponent(contentEntryId)}/reorder`,
      { method: "POST", ...body({ toIndex }) },
    );
  },
};
