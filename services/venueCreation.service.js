const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const AppError = require("../utils/AppError");
const { assertOrganizationPermission } = require("./organizationAuthorization.service");
const venueService = require("./venue.service");
const { initializeVenuePhysicalConfiguration } = require("./venuePhysicalOnboarding.service");
const { listPhysicalVocabularyAuthoringChoices } = require("./physicalVocabularyAuthoringChoices.service");

function id(value) { return String(value?._id || value?.id || value || ""); }

function assertConfiguredCreationPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new AppError("Payload creazione sede non valido", 400, [{ field: "payload", code: "INVALID_TYPE" }]);
  }
  const allowed = new Set(["name", "description", "ownerOrganizationId", "physicalVocabularyRevisionId"]);
  const unknown = Object.keys(payload).filter((key) => !allowed.has(key));
  if (unknown.length) {
    throw new AppError("Payload creazione sede non valido", 400, unknown.map((field) => ({
      field,
      code: "UNKNOWN_FIELD",
      message: `Campo non supportato: ${field}`,
    })));
  }
  if (!mongoose.isValidObjectId(payload.ownerOrganizationId)) {
    throw new AppError("ownerOrganizationId non valido", 400, [{ field: "ownerOrganizationId", code: "INVALID_OBJECT_ID" }]);
  }
  if (!mongoose.isValidObjectId(payload.physicalVocabularyRevisionId)) {
    throw new AppError("Seleziona un vocabolario fisico", 400, [{ field: "physicalVocabularyRevisionId", code: "INVALID_OBJECT_ID" }]);
  }
}

async function resolveVenueCreationContext({ organizationId, actorUserId }) {
  if (!mongoose.isValidObjectId(organizationId)) {
    throw new AppError("ownerOrganizationId non valido", 400, [{ field: "ownerOrganizationId", code: "INVALID_OBJECT_ID" }]);
  }
  const authority = await assertOrganizationPermission({
    userId: actorUserId,
    organizationId,
    permissionCode: "venue.create",
  });
  const permissions = new Set(authority.effectivePermissions || []);
  const choices = await listPhysicalVocabularyAuthoringChoices({
    organizationId,
    canViewOwned: permissions.has("physical_vocabulary.view"),
  });
  const blockers = [];
  if (!permissions.has("venue.physical.edit")) {
    blockers.push({
      code: "VENUE_PHYSICAL_EDIT_PERMISSION_REQUIRED",
      message: "Il tuo ruolo consente di creare sedi, ma non di inizializzarne la configurazione fisica.",
    });
  }
  if (!choices.length) {
    blockers.push({
      code: "PHYSICAL_VOCABULARY_REQUIRED",
      message: "Per creare una sede serve almeno un vocabolario fisico utilizzabile.",
    });
  }
  return {
    authority,
    choices,
    allowed: blockers.length === 0,
    blockers,
    canManagePhysicalVocabularies: permissions.has("physical_vocabulary.view"),
  };
}

async function getVenueCreationPreflight({ organizationId, actorUserId }) {
  const context = await resolveVenueCreationContext({ organizationId, actorUserId });
  return {
    organizationId,
    allowed: context.allowed,
    choices: context.choices,
    blockers: context.blockers,
    canManagePhysicalVocabularies: context.canManagePhysicalVocabularies,
  };
}

async function cleanupCreatedVenue(venueId) {
  const venue = await Venue.findById(venueId).lean().catch(() => null);
  if (!venue) return;
  if (venue.workingReleaseId) {
    const release = await VenueRelease.findById(venue.workingReleaseId).lean().catch(() => null);
    if (release?.layoutRevisionId) await LayoutRevision.deleteOne({ _id: release.layoutRevisionId }).catch(() => {});
    await VenueRelease.deleteOne({ _id: venue.workingReleaseId }).catch(() => {});
  }
  await Venue.deleteOne({ _id: venueId }).catch(() => {});
}

async function createConfiguredVenue({ payload, actorUserId }) {
  assertConfiguredCreationPayload(payload);
  const context = await resolveVenueCreationContext({ organizationId: payload.ownerOrganizationId, actorUserId });
  if (!context.allowed) {
    throw new AppError("La sede non può ancora essere creata", 409, context.blockers);
  }
  const selected = context.choices.find((entry) => id(entry.physicalVocabularyRevisionId) === id(payload.physicalVocabularyRevisionId));
  if (!selected) {
    throw new AppError("Vocabolario fisico non utilizzabile", 409, [{
      field: "physicalVocabularyRevisionId",
      code: "PHYSICAL_VOCABULARY_NOT_USABLE",
    }]);
  }

  const venue = await venueService.createVenue({
    actorUserId,
    payload: {
      ownerOrganizationId: payload.ownerOrganizationId,
      name: payload.name,
      description: payload.description,
    },
  });

  try {
    const configured = await initializeVenuePhysicalConfiguration({
      venueId: venue.id,
      actorUserId,
      payload: {
        mode: "existing",
        physicalVocabularyRevisionId: selected.physicalVocabularyRevisionId,
      },
    });
    return {
      venue: venueService.projectVenue(configured.venue, { includeWorking: true }),
      releaseId: configured.release?._id || null,
      layoutRevisionId: configured.layout?._id || null,
      physicalVocabularyRevisionId: selected.physicalVocabularyRevisionId,
    };
  } catch (error) {
    await cleanupCreatedVenue(venue.id);
    throw error;
  }
}

module.exports = {
  getVenueCreationPreflight,
  createConfiguredVenue,
};
