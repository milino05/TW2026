import { apiClient } from "./api-client.js";

function encoded(value) { return encodeURIComponent(String(value || "")); }
function body(payload) { return { body: JSON.stringify(payload ?? {}) }; }

export const venueSlotRepository = {
  assignSubject(venueId, exhibitSlotId, payload) {
    return apiClient.request(
      `/venues/${encoded(venueId)}/working-layout/exhibit-slots/${encoded(exhibitSlotId)}/subject`,
      { method: "PUT", ...body(payload) },
    );
  },
};
