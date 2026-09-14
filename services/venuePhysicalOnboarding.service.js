const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const Venue = require("../models/venue.model");
const AppError = require("../utils/AppError");
const { createPhysicalVocabulary } = require("./physicalVocabulary.service");
const { listPhysicalVocabularyAuthoringChoices } = require("./physicalVocabularyAuthoringChoices.service");
const { assertVenuePermission } = require("./venueAuthorization.service");
const { ensureWorkingVenueRelease } = require("./venueRelease.service");

function id(value) { return String(value?._id || value || ""); }
function assertOnboardingPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError("Payload onboarding non valido", 400, [{ field: "payload", code: "INVALID_TYPE" }]);
  }
  const allowed = new Set(["mode", "physicalVocabularyId", "name", "description"]);
  const issues = Object.keys(payload).filter((key) => !allowed.has(key)).map((field) => ({
    field,
    code: "UNKNOWN_FIELD",
    message: `Campo non supportato: ${field}`,
  }));
  if (issues.length) throw new AppError("Payload onboarding non valido", 400, issues);
}

async function getVenuePhysicalOnboarding({ venueId, actorUserId }) {
  const { venue, authority } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.edit" });
  if (venue.workingReleaseId || venue.publishedReleaseId) {
    return { required: false, venueId: venue._id, canCreate: false, choices: [] };
  }
  const permissions = new Set(authority.effectivePermissions || []);
  const choices = await listPhysicalVocabularyAuthoringChoices({
    organizationId: venue.ownerOrganizationId,
    canViewOwned: permissions.has("physical_vocabulary.view"),
  });
  return {
    required: true,
    venueId: venue._id,
    organizationId: venue.ownerOrganizationId,
    canCreate: permissions.has("physical_vocabulary.create"),
    recommendedMode: choices.length ? "existing" : "starter",
    choices,
  };
}

async function initializeVenuePhysicalConfiguration({ venueId, actorUserId, payload = {} }) {
  assertOnboardingPayload(payload);
  const { venue, authority } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.physical.edit" });
  if (venue.workingReleaseId || venue.publishedReleaseId) return ensureWorkingVenueRelease({ venueId, actorUserId });
  const mode = String(payload.mode || "existing").trim().toLowerCase();
  if (mode === "existing") {
    if (!payload.physicalVocabularyId) throw new AppError("Seleziona un vocabolario fisico", 400, [{ field: "physicalVocabularyId", code: "REQUIRED" }]);
    const permissions = new Set(authority.effectivePermissions || []);
    const choices = await listPhysicalVocabularyAuthoringChoices({
      organizationId: venue.ownerOrganizationId,
      canViewOwned: permissions.has("physical_vocabulary.view"),
    });
    const selected = choices.find((entry) => id(entry.physicalVocabularyId) === id(payload.physicalVocabularyId));
    if (!selected) {
      throw new AppError("Vocabolario fisico non utilizzabile", 409, [{ field: "physicalVocabularyId", code: "PHYSICAL_VOCABULARY_NOT_USABLE" }]);
    }
    return ensureWorkingVenueRelease({
      venueId,
      physicalVocabularyRevisionId: selected.effectiveRevisionId,
      actorUserId,
    });
  }
  if (!["starter", "blank"].includes(mode)) throw new AppError("Modalita onboarding non valida", 400, [{ field: "mode", code: "INVALID_ENUM", allowedValues: ["existing", "starter", "blank"] }]);
  if (!(authority.effectivePermissions || []).includes("physical_vocabulary.create")) {
    throw new AppError("Non puoi creare un vocabolario fisico per questa organizzazione", 403, [{ code: "PHYSICAL_VOCABULARY_CREATE_REQUIRED" }]);
  }

  const created = await createPhysicalVocabulary({
    actorUserId,
    payload: {
      ownerType: "organization",
      ownerId: venue.ownerOrganizationId,
      name: String(payload.name || `${venue.name} · Vocabolario fisico`).trim(),
      description: String(payload.description || `Vocabolario fisico creato durante la configurazione iniziale di ${venue.name}.`).trim(),
      applyStarter: mode === "starter",
    },
  });
  const refreshedVenue = await Venue.findById(venue._id);
  const physicalVocabulary = await PhysicalVocabulary.findById(created.physicalVocabulary._id).lean();
  return {
    venue: refreshedVenue,
    release: null,
    layout: null,
    onboarding: {
      mode,
      createdPhysicalVocabularyId: created.physicalVocabulary._id,
      createdPhysicalVocabularyRevisionId: created.revision._id,
      requiresPublication: true,
      physicalVocabulary: physicalVocabulary || created.physicalVocabulary,
    },
  };
}

module.exports = {
  getVenuePhysicalOnboarding,
  initializeVenuePhysicalConfiguration,
};
