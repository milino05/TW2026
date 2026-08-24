const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueTarget = require("../models/venueTarget.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { assertCanActForOwner } = require("./resourceOwnership.service");
const { getOrganizationMembership } = require("./organizationAuthorization.service");
const { assertVenueRole } = require("./venueAuthorization.service");
const { GLOBAL_PLACE_INTENTS, GLOBAL_ROUTING_ATTRIBUTE_CATALOG } = require("./routingAttributeCatalog.service");

function id(value) { return String(value?._id || value || ""); }
function operation(code, label, extra = {}) { return { code, label, ...extra }; }
function plain(value) { return value?.toObject ? value.toObject() : { ...(value || {}) }; }

function namespaceOperations({ namespace, revision, actor }) {
  const role = namespace.ownerType === "organization"
    ? getOrganizationMembership(actor, namespace.ownerId)?.role
    : "owner";
  const status = revision?.status || null;
  const editable = ["draft", "changes_requested"].includes(status);
  const operations = [operation("namespace.update", "Modifica dettagli")];
  if (!namespace.workingRevisionId) operations.push(operation("namespace.working.ensure", revision ? "Crea nuova bozza dalla versione pubblicata" : "Crea bozza"));
  if (editable) {
    operations.push(operation("namespace.revision.update", "Salva definizioni"));
    operations.push(operation("namespace.revision.check", "Controlla integrità"));
    if (namespace.ownerType === "organization") operations.push(operation("namespace.revision.request_review", "Richiedi revisione"));
    else operations.push(operation("namespace.revision.publish", "Pubblica"));
  }
  if (status === "in_review" && namespace.ownerType === "organization") {
    operations.push(operation("namespace.revision.withdraw_review", "Ritira dalla revisione"));
    if (role === "manager") {
      operations.push(operation("namespace.revision.request_changes", "Richiedi modifiche", { requiresMessage: true }));
      operations.push(operation("namespace.revision.publish", "Approva e pubblica"));
    }
  }
  return operations;
}

async function getNamespaceManagementProjection({ namespaceId, actorUserId }) {
  const namespace = await Namespace.findOne({ _id: namespaceId, lifecycleStatus: "active" }).lean();
  if (!namespace) throw new AppError("Namespace non disponibile", 404);
  const actor = await assertCanActForOwner({
    actorUserId,
    ownerType: namespace.ownerType,
    ownerId: namespace.ownerId,
    minimumOrganizationRole: "operator",
  });
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
    availableOperations: namespaceOperations({ namespace, revision, actor }),
  };
}

function venueOperations({ release, role, hasWorking }) {
  const status = release?.status || null;
  const operations = [operation("venue.update", "Modifica dettagli")];
  if (!hasWorking) operations.push(operation("venue.release.ensure", release ? "Crea nuova bozza dalla release pubblicata" : "Inizia configurazione fisica"));
  if (["draft", "changes_requested"].includes(status)) {
    operations.push(operation("venue.release.update", "Salva configurazione"));
    operations.push(operation("venue.release.check", "Controlla integrità"));
    operations.push(operation("venue.release.request_review", "Richiedi revisione"));
  }
  if (status === "in_review") {
    operations.push(operation("venue.release.withdraw_review", "Ritira dalla revisione"));
    if (role === "manager") {
      operations.push(operation("venue.release.request_changes", "Richiedi modifiche", { requiresMessage: true }));
      operations.push(operation("venue.release.publish", "Approva e pubblica"));
    }
  }
  return operations;
}

function projectTarget(target, subject, role, binding) {
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
      operation("venue.target.update", "Modifica oggetto"),
      ...(role === "manager" ? [operation("venue.target.trash", "Sposta nel cestino")] : []),
    ],
  };
}

async function getVenueManagementProjection({ venueId, actorUserId }) {
  const { venue, user } = await assertVenueRole({ userId: actorUserId, venueId, minimumRole: "operator" });
  const role = getOrganizationMembership(user, venue.ownerOrganizationId)?.role;
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
      role,
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
    targets: targets.map((target) => projectTarget(target, subjectById.get(id(target.subjectId)), role, bindingByTargetId.get(id(target._id)))),
    catalogs: {
      placeIntents: [...GLOBAL_PLACE_INTENTS],
      canonicalRoutingAttributes: GLOBAL_ROUTING_ATTRIBUTE_CATALOG.map((entry) => ({ ...entry })),
    },
    availableOperations: venueOperations({ release, role, hasWorking: Boolean(venue.workingReleaseId) }),
  };
}

module.exports = {
  namespaceOperations,
  venueOperations,
  getNamespaceManagementProjection,
  getVenueManagementProjection,
};
