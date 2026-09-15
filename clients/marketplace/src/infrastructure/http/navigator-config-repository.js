import { apiClient } from "./api-client.js";

function encoded(value) { return encodeURIComponent(String(value || "")); }
function body(payload) { return { body: JSON.stringify(payload ?? {}) }; }

export const navigatorConfigRepository = {
  get(venueId) {
    return apiClient.request(`/venues/${encoded(venueId)}/navigator-config`);
  },
  update(venueId, config) {
    return apiClient.request(`/venues/${encoded(venueId)}/navigator-config`, { method: "PUT", ...body({ config }) });
  },
  uploadAsset(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/navigator-config/assets`, { method: "POST", ...body(payload) });
  },
  copy(venueId, sourceVenueId) {
    return apiClient.request(`/venues/${encoded(venueId)}/navigator-config/copy`, { method: "POST", ...body({ sourceVenueId }) });
  },
};
