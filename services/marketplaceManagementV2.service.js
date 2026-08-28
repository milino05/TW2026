const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueTarget = require("../models/venueTarget.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { assertOrganizationPermission } = require("./organizationAuthorization.service");
const { assertVenuePermission } = require("./venueAuthorization.service");
const { GLOBAL_PLACE_INTENTS, GLOBAL_ROUTING_ATTRIBUTE_CATALOG } = require("./routingAttributeCatalog.service");

function id(value) { return String(value?._id || value || ""); }
function operation(code, label, extra = {}) { return { code, label, ...extra }; }
function plain(value) { return value?.toObject ? value.toObject() : { ...(value || {}) }; }

function namespaceOperations({ namespace, revision, permissions }) {
  const can = (code) => namespace.ownerType === "user" || permissions.has(code);
  const status = revision?.status || null;
  const editable = ["draft", "changes_requested"].includes(status);
  const operations = can("namespace.edit") ? [operation("namespace.update", "Modifica dettagli")] : [];
  if (!namespace.workingRevisionId && can("namespace.edit")) operations.push(operation("namespace.working.ensure", revision ? "Crea nuova bozza dalla versione pubblicata" : "Crea bozza"));
  if (editable && can("namespace.edit")) {
    operations.push(operation("namespace.revision.update", "Salva definizioni"));
    operations.push(operation("namespace.revision.check", "Controlla integrità"));
    if (namespace.ownerType === "organization") operations.push(operation("namespace.revision.request_review", "Richiedi revisione"));
    else operations.push(operation("namespace.revision.publish", "Pubblica"));
  }
  if (status === "in_review" && namespace.ownerType === "organization") {
    if (can("namespace.edit")) operations.push(operation("namespace.revision.withdraw_review", "Ritira dalla revisione"));
    if (can("namespace.review")) operations.push(operation("namespace.revision.request_changes", "Richiedi modifiche", { requiresMessage: true }));
    if (can("namespace.publish")) operations.push(operation("namespace.revision.publish", "Approva e pubblica"));
  }
  return operations;
}

async function getNamespaceManagementProjection({ namespaceId, actorUserId }) {
  const namespace = await Namespace.findOne({ _id: namespaceId, lifecycleStatus: "active" }).lean();
  if (!namespace) throw new AppError("Namespace non disponibile", 404);
  let permissions = new Set();
  if (namespace.ownerType === "organization") {
    const authority = await assertOrganizationPermission({ userId: actorUserId, organizationId: namespace.ownerId, permissionCode: "namespace.view" });
    permissions = new Set(authority.effectivePermissions);
  } else {
    await assertCanActForOwner({ actorUserId, ownerType: namespace.ownerType, ownerId: namespace.ownerId });
  }
  const revisionId = namespace.workingRevisionId || namespace.publishedRevisionId;
  const revision = revisionId ? await NamespaceRevision.findById(revisionId).lean() : null;
  if (revisionId && !revision) throw new AppError("NamespaceRevision non disponibile", 409);
  return {
    namespace: {
      id: namespace._id,
      name: namespace.name,
      description: namespace.description || "",
      owner: { type: namespace.ownerType, id: namespace.ownerId },
      source: namespace.workingRevisionId ? "working" : (namespace.publishedRevisionId ? "published" : "empty"),
    },
    revision: revision ? {
      id: revision._id,
      version: revision.version,
      status: revision.status,
      integrity: {
        status: revision.integrity?.status || "needs_review",
        issues: (revision.integrity?.issues || []).map((issue) => ({
          field: issue.field || "",
          code: issue.code || "",
          message: issue.message || "",
          severity: issue.severity || "error",
        })),
      },
      definitions: {
        subjectClasses: revision.subjectClasses || [],
        relationTypes: revision.relationTypes || [],
        durationTypes: revision.durationTypes || [],
        languageLevels: revision.languageLevels || [],
        presentationAspects: revision.presentationAspects || [],
        selectionSignals: revision.selectionSignals || [],
      },
    } : null,
    availableOperations: namespaceOperations({ namespace, revision, permissions }),
  };
}

function physicalVocabularyOperations({ physicalVocabulary, revision, permissions }) {
  const can = (code) => physicalVocabulary.ownerType === "user" || permissions.has(code);
  const status = revision?.status || null;
  const editable = ["draft", "changes_requested"].includes(status);
  const operations = can("physical_vocabulary.edit")
    ? [operation("physical_vocabulary.update", "Modifica dettagli")]
    : [];
  if (!physicalVocabulary.workingRevisionId && can("physical_vocabulary.edit")) {
    operations.push(operation("physical_vocabulary.working.ensure", revision ? "Crea nuova bozza dalla versione pubblicata" : "Crea bozza"));
  }
  if (editable && can("physical_vocabulary.edit")) {
    operations.push(operation("physical_vocabulary.revision.update", "Salva definizioni"));
    operations.push(operation("physical_vocabulary.starter.apply", "Applica starter ArtAround"));
    operations.push(operation("physical_vocabulary.revision.check", "Controlla integrità"));
    if (physicalVocabulary.ownerType === "organization") operations.push(operation("physical_vocabulary.revision.request_review", "Richiedi revisione"));
    else operations.push(operation("physical_vocabulary.revision.publish", "Pubblica"));
  }
  if (status === "in_review" && physicalVocabulary.ownerType === "organization") {
    if (can("physical_vocabulary.edit")) operations.push(operation("physical_vocabulary.revision.withdraw_review", "Ritira dalla revisione"));
    if (can("physical_vocabulary.review")) operations.push(operation("physical_vocabulary.revision.request_changes", "Richiedi modifiche", { requiresMessage: true }));
    if (can("physical_vocabulary.publish")) operations.push(operation("physical_vocabulary.revision.publish", "Approva e pubblica"));
  }
  if (can("physical_vocabulary.lifecycle.manage")) operations.push(operation("physical_vocabulary.trash", "Sposta nel cestino"));
  return operations;
}

async function getPhysicalVocabularyManagementProjection({ physicalVocabularyId, actorUserId }) {
  const physicalVocabulary = await PhysicalVocabulary.findOne({ _id: physicalVocabularyId, lifecycleStatus: "active" }).lean();
  if (!physicalVocabulary) throw new AppError("Physical Vocabulary non disponibile", 404);
  let permissions = new Set();
  if (physicalVocabulary.ownerType === "organization") {
    const authority = await assertOrganizationPermission({
      userId: actorUserId,
      organizationId: physicalVocabulary.ownerId,
      permissionCode: "physical_vocabulary.view",
    });
    permissions = new Set(authority.effectivePermissions);
  } else {
    await assertCanActForOwner({ actorUserId, ownerType: physicalVocabulary.ownerType, ownerId: physicalVocabulary.ownerId });
  }
  const revisionId = physicalVocabulary.workingRevisionId || physicalVocabulary.publishedRevisionId;
  const revision = revisionId ? await PhysicalVocabularyRevision.findById(revisionId).lean() : null;
  if (revisionId && !revision) throw new AppError("PhysicalVocabularyRevision non disponibile", 409);
  return {
    physicalVocabulary: {
      id: physicalVocabulary._id,
      name: physicalVocabulary.name,
      description: physicalVocabulary.description || "",
      owner: { type: physicalVocabulary.ownerType, id: physicalVocabulary.ownerId },
      source: physicalVocabulary.workingRevisionId ? "working" : (physicalVocabulary.publishedRevisionId ? "published" : "empty"),
    },
    revision: revision ? {
      id: revision._id,
      version: revision.version,
      status: revision.status,
      integrity: {
        status: revision.integrity?.status || "needs_review",
        issues: (revision.integrity?.issues || []).map((issue) => ({
          field: issue.field || "",
          code: issue.code || "",
          message: issue.message || "",
          severity: issue.severity || "error",
        })),
      },
      definitions: {
        placeTypes: revision.placeTypes || [],
        connectionTypes: revision.connectionTypes || [],
        physicalAttributes: revision.physicalAttributes || [],
        routingProfiles: revision.routingProfiles || [],
      },
    } : null,
    availableOperations: physicalVocabularyOperations({ physicalVocabulary, revision, permissions }),
  };
}

function venueOperations({ release, permissions, hasWorking }) {
  const can = (code) => permissions.has(code);
  const status = release?.status || null;
  const operations = can("venue.profile.manage") ? [operation("venue.update", "Modifica dettagli")] : [];
  if (!hasWorking && can("venue.physical.edit")) operations.push(operation("venue.release.ensure", release ? "Crea nuova bozza dalla release pubblicata" : "Inizia configurazione fisica"));
  if (["draft", "changes_requested"].includes(status) && can("venue.physical.edit")) {
    operations.push(operation("venue.release.update", "Salva configurazione"));
    operations.push(operation("venue.release.check", "Controlla integrità"));
    operations.push(operation("venue.release.request_review", "Richiedi revisione"));
  }
  if (status === "in_review") {
    if (can("venue.physical.edit")) operations.push(operation("venue.release.withdraw_review", "Ritira dalla revisione"));
    if (can("venue.physical.review")) operations.push(operation("venue.release.request_changes", "Richiedi modifiche", { requiresMessage: true }));
    if (can("venue.physical.publish")) operations.push(operation("venue.release.publish", "Approva e pubblica"));
  }
  return operations;
}

function projectTarget(target, subject, permissions, binding) {
  return {
    id: target._id,
    label: target.label,
    description: target.description || "",
    subject: subject ? { id: subject._id, label: subject.preferredLabel, description: subject.description || "" } : { id: target.subjectId, missing: true },
    binding: binding ? {
      availability: binding.availability || "active",
      recognitionMedia: (binding.recognitionMedia || []).map((media) => ({ url: media.url, altText: media.altText || "" })),
    } : null,
    availableOperations: [
      ...(permissions.has("venue.physical.edit") ? [operation("venue.target.update", "Modifica oggetto")] : []),
      ...(permissions.has("venue.lifecycle.manage") ? [operation("venue.target.trash", "Sposta nel cestino")] : []),
    ],
  };
}

async function getVenueManagementProjection({ venueId, actorUserId }) {
  const { venue, authority } = await assertVenuePermission({ userId: actorUserId, venueId, permissionCode: "venue.view" });
  const permissions = new Set(authority.effectivePermissions);
  const releaseId = venue.workingReleaseId || venue.publishedReleaseId;
  const release = releaseId ? await VenueRelease.findById(releaseId).lean() : null;
  if (releaseId && !release) throw new AppError("VenueRelease non disponibile", 409);
  const layout = release ? await LayoutRevision.findById(release.layoutRevisionId).lean() : null;
  if (release && !layout) throw new AppError("LayoutRevision non disponibile", 409);
  const targets = await VenueTarget.find({ venueId: venue._id, lifecycleStatus: "active" }).sort({ label: 1 }).lean();
  const subjects = targets.length
    ? await Subject.find({ _id: { $in: targets.map((target) => target.subjectId) } }).select("preferredLabel description").lean()
    : [];
  const subjectById = new Map(subjects.map((subject) => [id(subject._id), subject]));
  const bindingByTargetId = new Map((release?.targetBindings || []).map((binding) => [id(binding.venueTargetId), binding]));
  const source = venue.workingReleaseId ? "working" : (venue.publishedReleaseId ? "published" : "empty");

  return {
    venue: {
      id: venue._id,
      name: venue.name,
      description: venue.description || "",
      organizationId: venue.ownerOrganizationId,
      source,
    },
    release: release ? {
      id: release._id,
      version: release.version,
      status: release.status,
      integrity: {
        status: release.integrity?.status || "needs_review",
        issues: (release.integrity?.issues || []).map((issue) => ({
          field: issue.field || "",
          code: issue.code || "",
          message: issue.message || "",
          severity: issue.severity || "error",
        })),
      },
      preVisitInformation: release.preVisitInformation || [],
    } : null,
    layout: layout ? {
      id: layout._id,
      version: layout.version,
      placeTypes: plain(layout).placeTypes || [],
      routingAttributes: plain(layout).routingAttributes || [],
      routingPresets: plain(layout).routingPresets || [],
      floors: plain(layout).floors || [],
      places: plain(layout).places || [],
      venueTargetPlacements: plain(layout).venueTargetPlacements || [],
      connections: plain(layout).connections || [],
    } : null,
    targets: targets.map((target) => projectTarget(target, subjectById.get(id(target.subjectId)), permissions, bindingByTargetId.get(id(target._id)))),
    catalogs: {
      placeIntents: [...GLOBAL_PLACE_INTENTS],
      canonicalRoutingAttributes: GLOBAL_ROUTING_ATTRIBUTE_CATALOG.map((entry) => ({ ...entry })),
    },
    availableOperations: venueOperations({ release, permissions, hasWorking: Boolean(venue.workingReleaseId) }),
  };
}

module.exports = {
  namespaceOperations,
  physicalVocabularyOperations,
  venueOperations,
  getNamespaceManagementProjection,
  getPhysicalVocabularyManagementProjection,
  getVenueManagementProjection,
};
