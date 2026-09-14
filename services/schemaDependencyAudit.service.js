const ContentSpace = require("../models/contentSpace.model");
const EditorialContext = require("../models/editorialContext.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const LayoutRevision = require("../models/layoutRevision.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const Venue = require("../models/venue.model");
const VenueRelease = require("../models/venueRelease.model");
const { computeVenueReleaseIssues } = require("./venueReleaseIntegrity.service");
const { validatePresentationAgainstNamespace } = require("./itemV2Presentation.service");
const { validateGraphSnapshotAgainstNamespace } = require("./semanticGraphV2.service");
const { validateEditorialReleaseCoherence } = require("./editorialReleaseIntegrity.service");
const EditorialRelease = require("../models/editorialRelease.model");
const { buildValidation, id } = require("./versionedSchemaDependency.service");

function sameOwner(type, ownerId, dependency) {
  return dependency?.ownerType === type && id(dependency?.ownerId) === id(ownerId);
}

async function currentPhysicalRevisionStill(physicalVocabularyId, revisionId) {
  const row = await PhysicalVocabulary.findById(physicalVocabularyId).select("publishedRevisionId").lean();
  return id(row?.publishedRevisionId) === id(revisionId);
}

async function currentNamespaceRevisionStill(namespaceId, revisionId) {
  const row = await Namespace.findById(namespaceId).select("publishedRevisionId").lean();
  return id(row?.publishedRevisionId) === id(revisionId);
}

async function auditVenuesAgainstPhysicalVocabulary({ physicalVocabularyId, physicalVocabularyRevisionId }) {
  const [physicalVocabulary, revision] = await Promise.all([
    PhysicalVocabulary.findById(physicalVocabularyId).lean(),
    PhysicalVocabularyRevision.findById(physicalVocabularyRevisionId).lean(),
  ]);
  if (!physicalVocabulary || !revision || id(revision.physicalVocabularyId) !== id(physicalVocabularyId)) {
    return { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 };
  }
  if (physicalVocabulary.ownerType !== "organization") {
    return { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 };
  }
  const venues = await Venue.find({
    physicalVocabularyId: physicalVocabulary._id,
    ownerOrganizationId: physicalVocabulary.ownerId,
    lifecycleStatus: "active",
    publishedReleaseId: { $ne: null },
    "physicalVocabularyDependency.versionPolicy": "follow_current",
  }).lean();

  const result = { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 };
  for (const venue of venues) {
    if (!await currentPhysicalRevisionStill(physicalVocabularyId, physicalVocabularyRevisionId)) { result.skipped += 1; continue; }
    const release = await VenueRelease.findOne({ _id: venue.publishedReleaseId, venueId: venue._id, status: "published" }).lean();
    const layout = release ? await LayoutRevision.findOne({ _id: release.layoutRevisionId, venueId: venue._id }).lean() : null;
    if (!release || !layout) { result.skipped += 1; continue; }
    const issues = await computeVenueReleaseIssues({ venue, release, layout });
    if (!await currentPhysicalRevisionStill(physicalVocabularyId, physicalVocabularyRevisionId)) { result.skipped += 1; continue; }
    const validation = buildValidation({
      consumerSnapshotId: release._id,
      dependencyRevisionId: revision._id,
      issues,
    });
    const update = await Venue.updateOne({
      _id: venue._id,
      publishedReleaseId: release._id,
      physicalVocabularyId: physicalVocabulary._id,
      "physicalVocabularyDependency.versionPolicy": "follow_current",
    }, { $set: { "physicalVocabularyDependency.validation": validation } });
    if (update.modifiedCount !== 1) { result.skipped += 1; continue; }
    result.checked += 1;
    if (validation.status === "valid") result.compatible += 1;
    else result.requiresReview += 1;
  }
  return result;
}

async function auditItemEditionsAgainstNamespace({ namespaceId, namespaceRevisionId }) {
  const [namespace, revision] = await Promise.all([
    Namespace.findById(namespaceId).lean(),
    NamespaceRevision.findById(namespaceRevisionId).lean(),
  ]);
  if (!namespace || !revision || id(revision.namespaceId) !== id(namespaceId)) return { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 };
  const editions = await ItemEdition.find({
    namespaceId: namespace._id,
    publishedRevisionId: { $ne: null },
    "namespaceDependency.versionPolicy": "follow_current",
  }).lean();
  const items = await ItemV2.find({ _id: { $in: editions.map((entry) => entry.itemId) }, lifecycleStatus: "active" }).select("_id ownerType ownerId").lean();
  const itemById = new Map(items.map((entry) => [id(entry._id), entry]));
  const result = { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 };
  for (const edition of editions) {
    const item = itemById.get(id(edition.itemId));
    if (!item || !sameOwner(item.ownerType, item.ownerId, namespace)) { result.skipped += 1; continue; }
    const itemRevision = await ItemRevisionV2.findOne({ _id: edition.publishedRevisionId, itemEditionId: edition._id }).lean();
    if (!itemRevision) { result.skipped += 1; continue; }
    const issues = validatePresentationAgainstNamespace(itemRevision, revision);
    if (!await currentNamespaceRevisionStill(namespaceId, namespaceRevisionId)) { result.skipped += 1; continue; }
    const validation = buildValidation({ consumerSnapshotId: itemRevision._id, dependencyRevisionId: revision._id, issues });
    const update = await ItemEdition.updateOne({
      _id: edition._id,
      publishedRevisionId: itemRevision._id,
      namespaceId: namespace._id,
      "namespaceDependency.versionPolicy": "follow_current",
    }, { $set: { "namespaceDependency.validation": validation } });
    if (update.modifiedCount !== 1) { result.skipped += 1; continue; }
    result.checked += 1;
    if (validation.status === "valid") result.compatible += 1;
    else result.requiresReview += 1;
  }
  return result;
}

async function auditSemanticGraphsAgainstNamespace({ namespaceId, namespaceRevisionId }) {
  const [namespace, revision] = await Promise.all([
    Namespace.findById(namespaceId).lean(),
    NamespaceRevision.findById(namespaceRevisionId).lean(),
  ]);
  if (!namespace || !revision || id(revision.namespaceId) !== id(namespaceId)) return { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 };
  const graphs = await SemanticGraph.find({
    namespaceId: namespace._id,
    workingRevisionId: { $ne: null },
    lifecycleStatus: "active",
    "namespaceDependency.versionPolicy": "follow_current",
  }).lean();
  const result = { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 };
  for (const graph of graphs) {
    if (!sameOwner(graph.ownerType, graph.ownerId, namespace)) { result.skipped += 1; continue; }
    const graphRevision = await SemanticGraphRevision.findOne({ _id: graph.workingRevisionId, semanticGraphId: graph._id }).lean();
    if (!graphRevision) { result.skipped += 1; continue; }
    const [subjectBindings, edges] = await Promise.all([
      GraphSubjectBinding.find({ graphRevisionId: graphRevision._id }).lean(),
      SemanticEdgeV2.find({ graphRevisionId: graphRevision._id }).lean(),
    ]);
    const issues = validateGraphSnapshotAgainstNamespace({ subjectBindings, edges }, revision);
    if (!await currentNamespaceRevisionStill(namespaceId, namespaceRevisionId)) { result.skipped += 1; continue; }
    const validation = buildValidation({ consumerSnapshotId: graphRevision._id, dependencyRevisionId: revision._id, issues });
    const update = await SemanticGraph.updateOne({
      _id: graph._id,
      workingRevisionId: graphRevision._id,
      namespaceId: namespace._id,
      "namespaceDependency.versionPolicy": "follow_current",
    }, { $set: { "namespaceDependency.validation": validation } });
    if (update.modifiedCount !== 1) { result.skipped += 1; continue; }
    result.checked += 1;
    if (validation.status === "valid") result.compatible += 1;
    else result.requiresReview += 1;
  }
  return result;
}

async function auditEditorialContextsAgainstNamespace({ namespaceId, namespaceRevisionId }) {
  const [namespace, revision] = await Promise.all([
    Namespace.findById(namespaceId).lean(),
    NamespaceRevision.findById(namespaceRevisionId).lean(),
  ]);
  if (!namespace || !revision || id(revision.namespaceId) !== id(namespaceId)) return { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 };
  const contexts = await EditorialContext.find({
    namespaceId: namespace._id,
    publishedReleaseId: { $ne: null },
    lifecycleStatus: "active",
    "namespaceDependency.versionPolicy": "follow_current",
  }).lean();
  const spaces = await ContentSpace.find({ _id: { $in: contexts.map((entry) => entry.contentSpaceId) }, lifecycleStatus: "active" }).select("_id ownerType ownerId").lean();
  const spaceById = new Map(spaces.map((entry) => [id(entry._id), entry]));
  const result = { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 };
  for (const context of contexts) {
    const space = spaceById.get(id(context.contentSpaceId));
    if (!space || !sameOwner(space.ownerType, space.ownerId, namespace)) { result.skipped += 1; continue; }
    const release = await EditorialRelease.findOne({ _id: context.publishedReleaseId, editorialContextId: context._id }).lean();
    if (!release) { result.skipped += 1; continue; }
    const issues = await validateEditorialReleaseCoherence({
      editorialContextId: context._id,
      namespaceRevisionId: revision._id,
      graphRevisionId: release.graphRevisionId,
      itemBindings: release.itemBindings || [],
    });
    if (!await currentNamespaceRevisionStill(namespaceId, namespaceRevisionId)) { result.skipped += 1; continue; }
    const validation = buildValidation({ consumerSnapshotId: release._id, dependencyRevisionId: revision._id, issues });
    const update = await EditorialContext.updateOne({
      _id: context._id,
      publishedReleaseId: release._id,
      namespaceId: namespace._id,
      "namespaceDependency.versionPolicy": "follow_current",
    }, { $set: { "namespaceDependency.validation": validation } });
    if (update.modifiedCount !== 1) { result.skipped += 1; continue; }
    result.checked += 1;
    if (validation.status === "valid") result.compatible += 1;
    else result.requiresReview += 1;
  }
  return result;
}

module.exports = {
  auditVenuesAgainstPhysicalVocabulary,
  auditItemEditionsAgainstNamespace,
  auditSemanticGraphsAgainstNamespace,
  auditEditorialContextsAgainstNamespace,
};
