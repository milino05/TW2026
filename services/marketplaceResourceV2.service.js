const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ContentSpace = require("../models/contentSpace.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const AppError = require("../utils/AppError");

const LIVE_RESOURCE_TYPES = new Set(["item_edition", "editorial_context", "namespace", "physical_vocabulary", "visit"]);
const SNAPSHOT_RESOURCE_TYPES = new Set(["item_revision", "editorial_release", "namespace_revision", "physical_vocabulary_revision", "visit_revision"]);
const LIVE_TO_SNAPSHOT_RESOURCE_TYPE = Object.freeze({
  item_edition: "item_revision",
  editorial_context: "editorial_release",
  namespace: "namespace_revision",
  physical_vocabulary: "physical_vocabulary_revision",
  visit: "visit_revision",
});

function id(value) { return String(value?._id || value || ""); }
function owner(ownerType, ownerId) { return { ownerType, ownerId }; }
function lifecycleQuery(resourceId, includeTrashed) { return includeTrashed ? { _id: resourceId } : { _id: resourceId, lifecycleStatus: "active" }; }

async function loadItemEditionAuthority(resourceId, { includeTrashed = false } = {}) {
  const edition = await ItemEdition.findById(resourceId).lean();
  if (!edition) return null;
  const item = await ItemV2.findOne(lifecycleQuery(edition.itemId, includeTrashed)).lean();
  return item ? { ...owner(item.ownerType, item.ownerId), resource: edition, aggregate: item } : null;
}

async function loadItemRevisionAuthority(resourceId, { includeTrashed = false } = {}) {
  const revision = await ItemRevisionV2.findById(resourceId).lean();
  if (!revision) return null;
  const edition = await ItemEdition.findById(revision.itemEditionId).lean();
  if (!edition) return null;
  const item = await ItemV2.findOne(lifecycleQuery(edition.itemId, includeTrashed)).lean();
  return item ? { ...owner(item.ownerType, item.ownerId), resource: revision, aggregate: item, edition } : null;
}

async function loadContextAuthority(resourceId, { includeTrashed = false } = {}) {
  const context = await EditorialContext.findOne(lifecycleQuery(resourceId, includeTrashed)).lean();
  if (!context) return null;
  const contentSpace = await ContentSpace.findOne({ _id: context.contentSpaceId, lifecycleStatus: "active" }).lean();
  return contentSpace ? { ...owner(contentSpace.ownerType, contentSpace.ownerId), resource: context, aggregate: contentSpace } : null;
}

async function loadReleaseAuthority(resourceId, { includeTrashed = false } = {}) {
  const release = await EditorialRelease.findById(resourceId).lean();
  if (!release) return null;
  const context = await EditorialContext.findOne(lifecycleQuery(release.editorialContextId, includeTrashed)).lean();
  if (!context) return null;
  const contentSpace = await ContentSpace.findOne({ _id: context.contentSpaceId, lifecycleStatus: "active" }).lean();
  return contentSpace ? { ...owner(contentSpace.ownerType, contentSpace.ownerId), resource: release, context, aggregate: contentSpace } : null;
}

async function loadNamespaceAuthority(resourceId, { includeTrashed = false } = {}) {
  const namespace = await Namespace.findOne(lifecycleQuery(resourceId, includeTrashed)).lean();
  return namespace ? { ...owner(namespace.ownerType, namespace.ownerId), resource: namespace } : null;
}

async function loadNamespaceRevisionAuthority(resourceId, { includeTrashed = false } = {}) {
  const revision = await NamespaceRevision.findById(resourceId).lean();
  if (!revision) return null;
  const namespace = await Namespace.findOne(lifecycleQuery(revision.namespaceId, includeTrashed)).lean();
  return namespace ? { ...owner(namespace.ownerType, namespace.ownerId), resource: revision, aggregate: namespace } : null;
}

async function loadPhysicalVocabularyAuthority(resourceId, { includeTrashed = false } = {}) {
  const physicalVocabulary = await PhysicalVocabulary.findOne(lifecycleQuery(resourceId, includeTrashed)).lean();
  return physicalVocabulary ? { ...owner(physicalVocabulary.ownerType, physicalVocabulary.ownerId), resource: physicalVocabulary } : null;
}

async function loadPhysicalVocabularyRevisionAuthority(resourceId, { includeTrashed = false } = {}) {
  const revision = await PhysicalVocabularyRevision.findById(resourceId).lean();
  if (!revision) return null;
  const physicalVocabulary = await PhysicalVocabulary.findOne(lifecycleQuery(revision.physicalVocabularyId, includeTrashed)).lean();
  return physicalVocabulary ? { ...owner(physicalVocabulary.ownerType, physicalVocabulary.ownerId), resource: revision, aggregate: physicalVocabulary } : null;
}

async function loadVisitAuthority(resourceId, { includeTrashed = false } = {}) {
  const visit = await VisitV2.findOne(lifecycleQuery(resourceId, includeTrashed)).lean();
  return visit ? { ...owner(visit.ownerType, visit.ownerId), resource: visit } : null;
}

async function loadVisitRevisionAuthority(resourceId, { includeTrashed = false } = {}) {
  const revision = await VisitRevisionV2.findById(resourceId).lean();
  if (!revision) return null;
  const visit = await VisitV2.findOne(lifecycleQuery(revision.visitId, includeTrashed)).lean();
  return visit ? { ...owner(visit.ownerType, visit.ownerId), resource: revision, aggregate: visit } : null;
}

async function resolveResourceAuthority(resourceType, resourceId, options = {}) {
  switch (resourceType) {
    case "item_edition": return loadItemEditionAuthority(resourceId, options);
    case "item_revision": return loadItemRevisionAuthority(resourceId, options);
    case "editorial_context": return loadContextAuthority(resourceId, options);
    case "editorial_release": return loadReleaseAuthority(resourceId, options);
    case "namespace": return loadNamespaceAuthority(resourceId, options);
    case "namespace_revision": return loadNamespaceRevisionAuthority(resourceId, options);
    case "physical_vocabulary": return loadPhysicalVocabularyAuthority(resourceId, options);
    case "physical_vocabulary_revision": return loadPhysicalVocabularyRevisionAuthority(resourceId, options);
    case "visit": return loadVisitAuthority(resourceId, options);
    case "visit_revision": return loadVisitRevisionAuthority(resourceId, options);
    default: return null;
  }
}

function publishedSnapshotStatus(resourceType, authority) {
  if (!authority) return false;
  if (resourceType === "item_revision") return ["published", "superseded"].includes(authority.resource.status);
  if (resourceType === "editorial_release") return authority.resource.integrity?.status === "valid";
  if (resourceType === "namespace_revision") return ["published", "superseded"].includes(authority.resource.status);
  if (resourceType === "physical_vocabulary_revision") return ["published", "superseded"].includes(authority.resource.status);
  if (resourceType === "visit_revision") return ["published", "superseded"].includes(authority.resource.status);
  return false;
}

async function resolveCurrentSnapshotRef(resourceType, authority) {
  if (!authority) return null;
  if (resourceType === "item_edition") {
    return authority.resource.publishedRevisionId
      ? { resourceType: "item_revision", resourceId: authority.resource.publishedRevisionId }
      : null;
  }
  if (resourceType === "editorial_context") {
    return authority.resource.publishedReleaseId
      ? { resourceType: "editorial_release", resourceId: authority.resource.publishedReleaseId }
      : null;
  }
  if (resourceType === "namespace") {
    return authority.resource.publishedRevisionId
      ? { resourceType: "namespace_revision", resourceId: authority.resource.publishedRevisionId }
      : null;
  }
  if (resourceType === "physical_vocabulary") {
    return authority.resource.publishedRevisionId
      ? { resourceType: "physical_vocabulary_revision", resourceId: authority.resource.publishedRevisionId }
      : null;
  }
  if (resourceType === "visit") {
    return authority.resource.publishedRevisionId
      ? { resourceType: "visit_revision", resourceId: authority.resource.publishedRevisionId }
      : null;
  }
  return SNAPSHOT_RESOURCE_TYPES.has(resourceType)
    ? { resourceType, resourceId: authority.resource._id }
    : null;
}

async function listPublishedSnapshotRefsForLive(resourceType, resourceId, { includeTrashed = false } = {}) {
  if (!LIVE_RESOURCE_TYPES.has(resourceType)) {
    throw new AppError("La risorsa non e una lineage live", 400, [{ code: "LIVE_RESOURCE_REQUIRED", resourceType }]);
  }
  const authority = await resolveResourceAuthority(resourceType, resourceId, { includeTrashed });
  if (!authority) throw new AppError("Risorsa Marketplace non disponibile", 404, [{ code: "MARKETPLACE_RESOURCE_NOT_FOUND" }]);
  const snapshotType = LIVE_TO_SNAPSHOT_RESOURCE_TYPE[resourceType];
  let snapshots = [];
  if (resourceType === "item_edition") {
    snapshots = await ItemRevisionV2.find({
      itemEditionId: authority.resource._id,
      status: { $in: ["published", "superseded"] },
    }).sort({ version: -1 }).select("_id").lean();
  } else if (resourceType === "editorial_context") {
    snapshots = await EditorialRelease.find({
      editorialContextId: authority.resource._id,
      "integrity.status": "valid",
    }).sort({ version: -1 }).select("_id").lean();
  } else if (resourceType === "namespace") {
    snapshots = await NamespaceRevision.find({
      namespaceId: authority.resource._id,
      status: { $in: ["published", "superseded"] },
    }).sort({ version: -1 }).select("_id").lean();
  } else if (resourceType === "physical_vocabulary") {
    snapshots = await PhysicalVocabularyRevision.find({
      physicalVocabularyId: authority.resource._id,
      status: { $in: ["published", "superseded"] },
    }).sort({ version: -1 }).select("_id").lean();
  } else if (resourceType === "visit") {
    snapshots = await VisitRevisionV2.find({
      visitId: authority.resource._id,
      status: { $in: ["published", "superseded"] },
    }).sort({ version: -1 }).select("_id").lean();
  }
  return snapshots.map((snapshot) => ({ resourceType: snapshotType, resourceId: snapshot._id }));
}

async function loadSnapshotProjection(resourceType, snapshotRef, authority) {
  if (!snapshotRef) return null;
  if (resourceType === "item_edition") return ItemRevisionV2.findById(snapshotRef.resourceId).lean();
  if (resourceType === "editorial_context") return EditorialRelease.findById(snapshotRef.resourceId).lean();
  if (resourceType === "namespace") return NamespaceRevision.findById(snapshotRef.resourceId).lean();
  if (resourceType === "physical_vocabulary") return PhysicalVocabularyRevision.findById(snapshotRef.resourceId).lean();
  if (resourceType === "visit") return VisitRevisionV2.findById(snapshotRef.resourceId).lean();
  return authority.resource;
}

function assetText(resourceType, authority, snapshot) {
  if (resourceType === "item_edition" || resourceType === "item_revision") {
    const revision = resourceType === "item_revision" ? authority.resource : snapshot;
    return { title: revision?.label || "Contenuto", summary: (revision?.authorCredits || []).join(", ") };
  }
  if (resourceType === "editorial_context" || resourceType === "editorial_release") {
    const context = resourceType === "editorial_context" ? authority.resource : authority.context;
    return { title: context?.displayName || "Contesto editoriale", summary: context?.shortDescription || context?.description || "" };
  }
  if (resourceType === "namespace" || resourceType === "namespace_revision") {
    const namespace = resourceType === "namespace" ? authority.resource : authority.aggregate;
    return { title: namespace?.name || "Namespace", summary: namespace?.description || "" };
  }
  if (resourceType === "physical_vocabulary" || resourceType === "physical_vocabulary_revision") {
    const physicalVocabulary = resourceType === "physical_vocabulary" ? authority.resource : authority.aggregate;
    return { title: physicalVocabulary?.name || "Vocabolario fisico", summary: physicalVocabulary?.description || "" };
  }
  if (resourceType === "visit" || resourceType === "visit_revision") {
    const revision = resourceType === "visit_revision" ? authority.resource : snapshot;
    return { title: revision?.title || "Visita", summary: revision?.description || "" };
  }
  return { title: "Risorsa", summary: "" };
}

function editorialLicense(resourceType, snapshot) {
  if (["item_edition", "item_revision"].includes(resourceType)) {
    return snapshot?.metadata?.license || null;
  }
  return null;
}

function illustrativeMedia(resourceType, snapshot) {
  if (!["item_edition", "item_revision"].includes(resourceType)) return [];
  const media = (snapshot?.illustrativeMedia || []).find((entry) => entry?.url);
  if (!media) return [];
  return [{
    url: media.url,
    altText: media.altText || "",
    width: media.width || null,
    height: media.height || null,
  }];
}

function aggregateLifecycleStatus(resourceType, authority) {
  let aggregate = authority?.resource;
  if (["item_edition", "item_revision", "namespace_revision", "physical_vocabulary_revision", "visit_revision"].includes(resourceType)) {
    aggregate = authority?.aggregate;
  } else if (resourceType === "editorial_release") {
    aggregate = authority?.context;
  }
  return aggregate?.lifecycleStatus || "active";
}

async function resolveMarketableResource({ resourceType, resourceId }) {
  const live = LIVE_RESOURCE_TYPES.has(resourceType);
  const authority = await resolveResourceAuthority(resourceType, resourceId, { includeTrashed: !live });
  if (!authority) throw new AppError("Risorsa Marketplace non disponibile", 404, [{ code: "MARKETPLACE_RESOURCE_NOT_FOUND" }]);

  const snapshotRef = await resolveCurrentSnapshotRef(resourceType, authority);
  if (live && !snapshotRef) {
    throw new AppError("La risorsa live non possiede uno snapshot pubblicato", 409, [{ code: "PUBLISHED_SNAPSHOT_REQUIRED" }]);
  }
  if (!live && !publishedSnapshotStatus(resourceType, authority)) {
    throw new AppError("Lo snapshot non e pubblicato o valido", 409, [{ code: "PUBLISHED_SNAPSHOT_REQUIRED" }]);
  }
  const snapshot = await loadSnapshotProjection(resourceType, snapshotRef, authority);
  if (!snapshot) throw new AppError("Snapshot pubblicato non disponibile", 409, [{ code: "PUBLISHED_SNAPSHOT_REQUIRED" }]);
  const text = assetText(resourceType, authority, snapshot);
  return {
    resourceType,
    resourceId: authority.resource._id,
    ownerType: authority.ownerType,
    ownerId: authority.ownerId,
    lifecycleStatus: aggregateLifecycleStatus(resourceType, authority),
    live,
    snapshotRef,
    resource: authority.resource,
    aggregate: authority.aggregate || null,
    snapshot,
    asset: {
      type: resourceType,
      id: authority.resource._id,
      title: text.title,
      summary: text.summary,
      version: snapshot?.version || null,
      versionMode: live ? "live" : "snapshot",
      editorialLicense: editorialLicense(resourceType, snapshot),
      illustrativeMedia: illustrativeMedia(resourceType, snapshot),
    },
  };
}

module.exports = {
  LIVE_RESOURCE_TYPES,
  SNAPSHOT_RESOURCE_TYPES,
  LIVE_TO_SNAPSHOT_RESOURCE_TYPE,
  resolveResourceAuthority,
  resolveCurrentSnapshotRef,
  listPublishedSnapshotRefsForLive,
  resolveMarketableResource,
};
