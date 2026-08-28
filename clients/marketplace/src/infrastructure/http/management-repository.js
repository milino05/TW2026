import { apiClient } from "./api-client.js";

function encoded(value) { return encodeURIComponent(String(value || "")); }
function body(payload) { return { body: JSON.stringify(payload ?? {}) }; }

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
  physicalVocabulary(physicalVocabularyId) {
    return apiClient.request(`/v2/marketplace/management/physical-vocabularies/${encoded(physicalVocabularyId)}`);
  },
  venue(venueId) {
    return apiClient.request(`/v2/marketplace/management/venues/${encoded(venueId)}`);
  },
  ensureNamespaceWorking(namespaceId) {
    return apiClient.request(`/namespaces/${encoded(namespaceId)}/working-revision?create=true`);
  },
  updateNamespaceRevision(namespaceId, payload) {
    return apiClient.request(`/namespaces/${encoded(namespaceId)}/working-revision`, { method: "PATCH", ...body(payload) });
  },
  namespaceWorkflow(namespaceId, action, payload = {}) {
    return apiClient.request(`/namespaces/${encoded(namespaceId)}/working-revision/${action}`, { method: "POST", ...body(payload) });
  },
  updatePhysicalVocabulary(physicalVocabularyId, payload) {
    return apiClient.request(`/physical-vocabularies/${encoded(physicalVocabularyId)}`, { method: "PATCH", ...body(payload) });
  },
  ensurePhysicalVocabularyWorking(physicalVocabularyId) {
    return apiClient.request(`/physical-vocabularies/${encoded(physicalVocabularyId)}/working-revision?create=true`);
  },
  updatePhysicalVocabularyRevision(physicalVocabularyId, payload) {
    return apiClient.request(`/physical-vocabularies/${encoded(physicalVocabularyId)}/working-revision`, { method: "PATCH", ...body(payload) });
  },
  applyPhysicalVocabularyStarter(physicalVocabularyId) {
    return apiClient.request(`/physical-vocabularies/${encoded(physicalVocabularyId)}/working-revision/apply-starter`, { method: "POST", ...body({}) });
  },
  physicalVocabularyWorkflow(physicalVocabularyId, action, payload = {}) {
    return apiClient.request(`/physical-vocabularies/${encoded(physicalVocabularyId)}/working-revision/${action}`, { method: "POST", ...body(payload) });
  },
  physicalVocabularyLifecycle(physicalVocabularyId, action) {
    return apiClient.request(`/physical-vocabularies/${encoded(physicalVocabularyId)}/lifecycle/${action}`, { method: "POST", ...body({}) });
  },
  venuePhysicalOnboarding(venueId) {
    return apiClient.request(`/venues/${encoded(venueId)}/physical-onboarding`);
  },
  initializeVenuePhysicalOnboarding(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/physical-onboarding`, { method: "POST", ...body(payload) });
  },
  ensureVenueRelease(venueId, physicalVocabularyRevisionId = null) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release`, { method: "POST", ...body(physicalVocabularyRevisionId ? { physicalVocabularyRevisionId } : {}) });
  },
  updateVenueRelease(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release`, { method: "PATCH", ...body(payload) });
  },
  venueWorkflow(venueId, action, { method = "POST", payload = {} } = {}) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release/${action}`, { method, ...(method === "DELETE" ? {} : body(payload)) });
  },
  uploadVenueTargetRecognitionMedia(venueId, targetId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release/targets/${encoded(targetId)}/recognition-media`, { method: "POST", ...body(payload) });
  },
  removeVenueTargetRecognitionMedia(venueId, targetId, mediaId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release/targets/${encoded(targetId)}/recognition-media/${encoded(mediaId)}`, { method: "DELETE" });
  },
  addVenueFloor(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/floors`, { method: "POST", ...body(payload) });
  },
  updateVenueFloor(venueId, floorId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/floors/${encoded(floorId)}`, { method: "PATCH", ...body(payload) });
  },
  uploadVenueFloorPlan(venueId, floorId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/floors/${encoded(floorId)}/map-asset`, { method: "POST", ...body(payload) });
  },
  calibrateVenueFloor(venueId, floorId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/floors/${encoded(floorId)}/calibration`, { method: "PUT", ...body(payload) });
  },
  removeVenueFloor(venueId, floorId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/floors/${encoded(floorId)}`, { method: "DELETE" });
  },
  createVenuePlace(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/places`, { method: "POST", ...body(payload) });
  },
  updateVenuePlace(venueId, placeId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/places/${encoded(placeId)}`, { method: "PATCH", ...body(payload) });
  },
  moveVenuePlace(venueId, placeId, position) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/places/${encoded(placeId)}/position`, { method: "PATCH", ...body({ position }) });
  },
  setVenuePlaceAttribute(venueId, placeId, definitionId, value) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/places/${encoded(placeId)}/attributes/${encoded(definitionId)}`, { method: "PUT", ...body({ value }) });
  },
  removeVenuePlace(venueId, placeId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/places/${encoded(placeId)}`, { method: "DELETE" });
  },
  createVenueConnection(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/connections`, { method: "POST", ...body(payload) });
  },
  updateVenueConnection(venueId, connectionId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/connections/${encoded(connectionId)}`, { method: "PATCH", ...body(payload) });
  },
  setVenueConnectionAttribute(venueId, connectionId, definitionId, value) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/connections/${encoded(connectionId)}/attributes/${encoded(definitionId)}`, { method: "PUT", ...body({ value }) });
  },
  removeVenueConnection(venueId, connectionId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/connections/${encoded(connectionId)}`, { method: "DELETE" });
  },
  setVenueTargetPlacement(venueId, targetId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/targets/${encoded(targetId)}/placement`, { method: "PUT", ...body(payload) });
  },
  setVenueTargetBinding(venueId, targetId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/targets/${encoded(targetId)}/binding`, { method: "PUT", ...body(payload) });
  },
  setVenuePreVisitInformation(venueId, items) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/pre-visit-information`, { method: "PUT", ...body({ items }) });
  },
  searchSubjects(search) {
    const params = new URLSearchParams({ search: String(search || ""), limit: "25" });
    return apiClient.request(`/subjects?${params}`);
  },
  createVenueTarget(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/targets`, { method: "POST", ...body(payload) });
  },
  updateVenueTarget(venueId, targetId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/targets/${encoded(targetId)}`, { method: "PATCH", ...body(payload) });
  },
  trashVenueTarget(venueId, targetId) {
    return apiClient.request(`/venues/${encoded(venueId)}/targets/${encoded(targetId)}`, { method: "DELETE" });
  },
};