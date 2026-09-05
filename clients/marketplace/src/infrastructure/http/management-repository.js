import { apiClient } from "./api-client.js";
import { assertOrganizationOperatingContext, assertOwnerOperatingContext } from "../../application/management-context-policy.js";

function encoded(value) { return encodeURIComponent(String(value || "")); }
function body(payload) { return { body: JSON.stringify(payload ?? {}) }; }

export const managementRepository = {
  organization(organizationId, query = {}) {
    assertOrganizationOperatingContext(organizationId, { resourceLabel: "Questa organizzazione" });
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
    const suffix = params.toString() ? `?${params}` : "";
    return apiClient.request(`/v2/marketplace/management/organizations/${encoded(organizationId)}${suffix}`);
  },
  async namespace(namespaceId) {
    const projection = await apiClient.request(`/v2/marketplace/management/namespaces/${encoded(namespaceId)}`);
    assertOwnerOperatingContext(projection?.namespace?.owner, { resourceLabel: "Queste regole editoriali" });
    return projection;
  },
  async physicalVocabulary(physicalVocabularyId) {
    const projection = await apiClient.request(`/v2/marketplace/management/physical-vocabularies/${encoded(physicalVocabularyId)}`);
    assertOwnerOperatingContext(projection?.physicalVocabulary?.owner, { resourceLabel: "Questo vocabolario fisico" });
    return projection;
  },
  async venue(venueId) {
    const projection = await apiClient.request(`/v2/marketplace/management/venues/${encoded(venueId)}`);
    assertOrganizationOperatingContext(projection?.venue?.organizationId, { resourceLabel: "Questa sede" });
    return projection;
  },
  venueInventoryProposals(venueId, { status = "pending" } = {}) {
    const params = new URLSearchParams({ status: String(status || "pending") });
    return apiClient.request(`/venues/${encoded(venueId)}/inventory-proposals?${params}`);
  },
  acceptVenueInventoryProposal(venueId, proposalId, { message = "" } = {}) {
    return apiClient.request(`/venues/${encoded(venueId)}/inventory-proposals/${encoded(proposalId)}/accept`, { method: "POST", ...body({ message }) });
  },
  rejectVenueInventoryProposal(venueId, proposalId, { message }) {
    return apiClient.request(`/venues/${encoded(venueId)}/inventory-proposals/${encoded(proposalId)}/reject`, { method: "POST", ...body({ message }) });
  },
  withdrawVenueInventoryProposal(venueId, proposalId, { message = "" } = {}) {
    return apiClient.request(`/venues/${encoded(venueId)}/inventory-proposals/${encoded(proposalId)}/withdraw`, { method: "POST", ...body({ message }) });
  },
  venueLifecycleImpact(venueId) {
    return apiClient.request(`/venues/${encoded(venueId)}/lifecycle-impact`);
  },
  trashVenue(venueId) {
    return apiClient.request(`/venues/${encoded(venueId)}/lifecycle/trash`, { method: "POST", ...body({}) });
  },
  restoreVenue(venueId) {
    return apiClient.request(`/venues/${encoded(venueId)}/lifecycle/restore`, { method: "POST", ...body({}) });
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
  venuePhysicalOnboarding(venueId) {
    return apiClient.request(`/venues/${encoded(venueId)}/physical-onboarding`);
  },
  initializeVenuePhysicalOnboarding(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/physical-onboarding`, { method: "POST", ...body(payload) });
  },
  ensureVenueRelease(venueId, physicalVocabularyRevisionId = null) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release`, { method: "POST", ...body(physicalVocabularyRevisionId ? { physicalVocabularyRevisionId } : {}) });
  },
  venueWorkflow(venueId, action, { method = "POST", payload = {} } = {}) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release/${action}`, { method, ...(method === "DELETE" ? {} : body(payload)) });
  },
  detachVenueTarget(venueId, targetId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release/targets/${encoded(targetId)}`, { method: "DELETE" });
  },
  setVenueTargetAvailability(venueId, targetId, availability) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-release/targets/${encoded(targetId)}/availability`, { method: "PUT", ...body({ availability }) });
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
  moveVenuePlace(venueId, placeId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/places/${encoded(placeId)}/position`, { method: "PATCH", ...body(payload?.position ? payload : { position: payload }) });
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
  createExhibitSlot(venueId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/exhibit-slots`, { method: "POST", ...body(payload) });
  },
  updateExhibitSlot(venueId, exhibitSlotId, payload) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/exhibit-slots/${encoded(exhibitSlotId)}`, { method: "PATCH", ...body(payload) });
  },
  removeExhibitSlot(venueId, exhibitSlotId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/exhibit-slots/${encoded(exhibitSlotId)}`, { method: "DELETE" });
  },
  assignVenueTargetToExhibitSlot(venueId, exhibitSlotId, targetId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/exhibit-slots/${encoded(exhibitSlotId)}/entity/${encoded(targetId)}`, { method: "PUT", ...body({}) });
  },
  unassignVenueTargetFromExhibitSlot(venueId, targetId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/entities/${encoded(targetId)}/exhibit-slot`, { method: "DELETE" });
  },
  venueLayoutRemovalImpact(venueId, resourceType, resourceId) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/removal-impact/${encoded(resourceType)}/${encoded(resourceId)}`);
  },
  setVenuePreVisitInformation(venueId, items) {
    return apiClient.request(`/venues/${encoded(venueId)}/working-layout/pre-visit-information`, { method: "PUT", ...body({ items }) });
  },
  searchSubjects(search) {
    const params = new URLSearchParams({ search: String(search || ""), limit: "25" });
    return apiClient.request(`/subjects?${params}`);
  },
  searchVenueSubjectCandidates(venueId, search) {
    const params = new URLSearchParams({ query: String(search || ""), limit: "25" });
    return apiClient.request(`/venues/${encoded(venueId)}/subject-candidates?${params}`);
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