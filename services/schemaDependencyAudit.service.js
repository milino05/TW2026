const ContentSpace = require("../models/contentSpace.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const LayoutRevision = require("../models/layoutRevision.model");
const Namespace = require("../models/namespace.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
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
const { loadVenuePhysicalVocabulary } = require("./layoutPhysicalVocabulary.service");
const { loadEffectiveNamespaceRevision } = require("./namespaceDependency.service");
const { buildValidation, id, isValidationFresh } = require("./versionedSchemaDependency.service");

function sameOwner(type, ownerId, dependency) {
  return dependency?.ownerType === type && id(dependency?.ownerId) === id(ownerId);
}

function blocking(validation) {
  return validation?.status !== "valid";
}

async function physicalDependencyStillEffective(venue, revisionId) {
  const binding = venue.physicalVocabularyDependency;
  if (binding?.versionPolicy === "pinned") return id(binding.pinnedRevisionId) === id(revisionId);
  const row = await PhysicalVocabulary.findById(venue.physicalVocabularyId).select("publishedRevisionId").lean();
  return id(row?.publishedRevisionId) === id(revisionId);
}

async function namespaceDependencyStillEffective({ namespaceId, binding, revisionId }) {
  if (binding?.versionPolicy === "pinned") return id(binding.pinnedRevisionId) === id(revisionId);
  const row = await Namespace.findById(namespaceId).select("publishedRevisionId").lean();
  return id(row?.publishedRevisionId) === id(revisionId);
}

async function revalidateVenuePhysicalDependency({ venueId, expectedDependencyRevisionId = null, force = false }) {
  const venue = await Venue.findOne({ _id: venueId, lifecycleStatus: "active", publishedReleaseId: { $ne: null } }).lean();
  if (!venue?.physicalVocabularyId) return null;
  const release = await VenueRelease.findOne({ _id: venue.publishedReleaseId, venueId: venue._id, status: "published" }).lean();
  const layout = release ? await LayoutRevision.findOne({ _id: release.layoutRevisionId, venueId: venue._id }).lean() : null;
  if (!release || !layout) return null;

  const bundle = await loadVenuePhysicalVocabulary(venue, { requireStable: true });
  if (expectedDependencyRevisionId && id(bundle.revision._id) !== id(expectedDependencyRevisionId)) return null;
  if (!force && isValidationFresh({
    binding: venue.physicalVocabularyDependency,
    consumerSnapshotId: release._id,
    dependencyRevisionId: bundle.revision._id,
  })) {
    return { venue, release, layout, dependencyRevision: bundle.revision, validation: venue.physicalVocabularyDependency.validation, changed: false };
  }

  const issues = await computeVenueReleaseIssues({
    venue,
    release,
    layout,
    physicalVocabularyRevision: bundle.revision,
  });
  if (!await physicalDependencyStillEffective(venue, bundle.revision._id)) return null;
  const validation = buildValidation({ consumerSnapshotId: release._id, dependencyRevisionId: bundle.revision._id, issues });
  const update = await Venue.updateOne({
    _id: venue._id,
    publishedReleaseId: release._id,
    physicalVocabularyId: venue.physicalVocabularyId,
  }, { $set: { "physicalVocabularyDependency.validation": validation } });
  if (update.modifiedCount !== 1) return null;
  return { venue, release, layout, dependencyRevision: bundle.revision, validation, changed: true };
}

async function revalidateItemEditionNamespaceDependency({ editionId, expectedDependencyRevisionId = null, force = false }) {
  const edition = await ItemEdition.findOne({ _id: editionId, publishedRevisionId: { $ne: null } }).lean();
  if (!edition) return null;
  const namespace = await Namespace.findOne({ _id: edition.namespaceId, lifecycleStatus: "active" }).lean();
  if (!namespace) return null;
  const namespaceRevision = await loadEffectiveNamespaceRevision({ namespace, binding: edition.namespaceDependency });
  if (expectedDependencyRevisionId && id(namespaceRevision._id) !== id(expectedDependencyRevisionId)) return null;
  if (!force && isValidationFresh({
    binding: edition.namespaceDependency,
    consumerSnapshotId: edition.publishedRevisionId,
    dependencyRevisionId: namespaceRevision._id,
  })) {
    return { edition, dependencyRevision: namespaceRevision, validation: edition.namespaceDependency.validation, changed: false };
  }

  const itemRevision = await ItemRevisionV2.findOne({
    _id: edition.publishedRevisionId,
    itemEditionId: edition._id,
    status: { $in: ["published", "superseded"] },
  }).lean();
  if (!itemRevision) return null;
  const issues = validatePresentationAgainstNamespace(itemRevision, namespaceRevision);
  if (!await namespaceDependencyStillEffective({ namespaceId: namespace._id, binding: edition.namespaceDependency, revisionId: namespaceRevision._id })) return null;
  const validation = buildValidation({ consumerSnapshotId: itemRevision._id, dependencyRevisionId: namespaceRevision._id, issues });
  const update = await ItemEdition.updateOne({
    _id: edition._id,
    publishedRevisionId: itemRevision._id,
    namespaceId: namespace._id,
  }, { $set: { "namespaceDependency.validation": validation } });
  if (update.modifiedCount !== 1) return null;
  return { edition, itemRevision, dependencyRevision: namespaceRevision, validation, changed: true };
}

async function revalidateSemanticGraphNamespaceDependency({ semanticGraphId, expectedDependencyRevisionId = null, force = false }) {
  const graph = await SemanticGraph.findOne({ _id: semanticGraphId, lifecycleStatus: "active", workingRevisionId: { $ne: null } }).lean();
  if (!graph) return null;
  const namespace = await Namespace.findOne({ _id: graph.namespaceId, lifecycleStatus: "active" }).lean();
  if (!namespace) return null;
  const namespaceRevision = await loadEffectiveNamespaceRevision({ namespace, binding: graph.namespaceDependency });
  if (expectedDependencyRevisionId && id(namespaceRevision._id) !== id(expectedDependencyRevisionId)) return null;
  if (!force && isValidationFresh({
    binding: graph.namespaceDependency,
    consumerSnapshotId: graph.workingRevisionId,
    dependencyRevisionId: namespaceRevision._id,
  })) {
    return { graph, dependencyRevision: namespaceRevision, validation: graph.namespaceDependency.validation, changed: false };
  }

  const graphRevision = await SemanticGraphRevision.findOne({ _id: graph.workingRevisionId, semanticGraphId: graph._id }).lean();
  if (!graphRevision) return null;
  const [subjectBindings, edges] = await Promise.all([
    GraphSubjectBinding.find({ graphRevisionId: graphRevision._id }).lean(),
    SemanticEdgeV2.find({ graphRevisionId: graphRevision._id }).lean(),
  ]);
  const issues = validateGraphSnapshotAgainstNamespace({ subjectBindings, edges }, namespaceRevision);
  if (!await namespaceDependencyStillEffective({ namespaceId: namespace._id, binding: graph.namespaceDependency, revisionId: namespaceRevision._id })) return null;
  const validation = buildValidation({ consumerSnapshotId: graphRevision._id, dependencyRevisionId: namespaceRevision._id, issues });
  const update = await SemanticGraph.updateOne({
    _id: graph._id,
    workingRevisionId: graphRevision._id,
    namespaceId: namespace._id,
  }, { $set: { "namespaceDependency.validation": validation } });
  if (update.modifiedCount !== 1) return null;
  return { graph, graphRevision, dependencyRevision: namespaceRevision, validation, changed: true };
}

async function revalidateEditorialContextNamespaceDependency({ editorialContextId, expectedDependencyRevisionId = null, force = false }) {
  const context = await EditorialContext.findOne({
    _id: editorialContextId,
    lifecycleStatus: "active",
    publishedReleaseId: { $ne: null },
  }).lean();
  if (!context) return null;
  const namespace = await Namespace.findOne({ _id: context.namespaceId, lifecycleStatus: "active" }).lean();
  if (!namespace) return null;
  const namespaceRevision = await loadEffectiveNamespaceRevision({ namespace, binding: context.namespaceDependency });
  if (expectedDependencyRevisionId && id(namespaceRevision._id) !== id(expectedDependencyRevisionId)) return null;
  if (!force && isValidationFresh({
    binding: context.namespaceDependency,
    consumerSnapshotId: context.publishedReleaseId,
    dependencyRevisionId: namespaceRevision._id,
  })) {
    return { context, dependencyRevision: namespaceRevision, validation: context.namespaceDependency.validation, changed: false };
  }

  const release = await EditorialRelease.findOne({ _id: context.publishedReleaseId, editorialContextId: context._id }).lean();
  if (!release) return null;
  const issues = await validateEditorialReleaseCoherence({
    editorialContextId: context._id,
    namespaceRevisionId: namespaceRevision._id,
    graphRevisionId: release.graphRevisionId,
    itemBindings: release.itemBindings || [],
  });
  if (!await namespaceDependencyStillEffective({ namespaceId: namespace._id, binding: context.namespaceDependency, revisionId: namespaceRevision._id })) return null;
  const validation = buildValidation({ consumerSnapshotId: release._id, dependencyRevisionId: namespaceRevision._id, issues });
  const update = await EditorialContext.updateOne({
    _id: context._id,
    publishedReleaseId: release._id,
    namespaceId: namespace._id,
  }, { $set: { "namespaceDependency.validation": validation } });
  if (update.modifiedCount !== 1) return null;
  return { context, release, dependencyRevision: namespaceRevision, validation, changed: true };
}

function summarize(results) {
  return results.reduce((summary, entry) => {
    if (!entry) { summary.skipped += 1; return summary; }
    summary.checked += 1;
    if (blocking(entry.validation)) summary.requiresReview += 1;
    else summary.compatible += 1;
    return summary;
  }, { checked: 0, compatible: 0, requiresReview: 0, skipped: 0 });
}

async function auditVenuesAgainstPhysicalVocabulary({ physicalVocabularyId, physicalVocabularyRevisionId }) {
  const physicalVocabulary = await PhysicalVocabulary.findById(physicalVocabularyId).lean();
  if (!physicalVocabulary || physicalVocabulary.ownerType !== "organization") return summarize([]);
  const venues = await Venue.find({
    physicalVocabularyId: physicalVocabulary._id,
    ownerOrganizationId: physicalVocabulary.ownerId,
    lifecycleStatus: "active",
    publishedReleaseId: { $ne: null },
    "physicalVocabularyDependency.versionPolicy": "follow_current",
  }).select("_id").lean();
  const results = [];
  for (const venue of venues) {
    results.push(await revalidateVenuePhysicalDependency({
      venueId: venue._id,
      expectedDependencyRevisionId: physicalVocabularyRevisionId,
      force: true,
    }));
  }
  return summarize(results);
}

async function auditItemEditionsAgainstNamespace({ namespaceId, namespaceRevisionId }) {
  const namespace = await Namespace.findById(namespaceId).lean();
  if (!namespace) return summarize([]);
  const editions = await ItemEdition.find({
    namespaceId: namespace._id,
    publishedRevisionId: { $ne: null },
    "namespaceDependency.versionPolicy": "follow_current",
  }).select("_id itemId").lean();
  const items = await ItemV2.find({ _id: { $in: editions.map((entry) => entry.itemId) }, lifecycleStatus: "active" }).select("_id ownerType ownerId").lean();
  const itemById = new Map(items.map((entry) => [id(entry._id), entry]));
  const results = [];
  for (const edition of editions) {
    const item = itemById.get(id(edition.itemId));
    if (!item || !sameOwner(item.ownerType, item.ownerId, namespace)) { results.push(null); continue; }
    results.push(await revalidateItemEditionNamespaceDependency({
      editionId: edition._id,
      expectedDependencyRevisionId: namespaceRevisionId,
      force: true,
    }));
  }
  return summarize(results);
}

async function auditSemanticGraphsAgainstNamespace({ namespaceId, namespaceRevisionId }) {
  const namespace = await Namespace.findById(namespaceId).lean();
  if (!namespace) return summarize([]);
  const graphs = await SemanticGraph.find({
    namespaceId: namespace._id,
    workingRevisionId: { $ne: null },
    lifecycleStatus: "active",
    "namespaceDependency.versionPolicy": "follow_current",
  }).select("_id ownerType ownerId").lean();
  const results = [];
  for (const graph of graphs) {
    if (!sameOwner(graph.ownerType, graph.ownerId, namespace)) { results.push(null); continue; }
    results.push(await revalidateSemanticGraphNamespaceDependency({
      semanticGraphId: graph._id,
      expectedDependencyRevisionId: namespaceRevisionId,
      force: true,
    }));
  }
  return summarize(results);
}

async function auditEditorialContextsAgainstNamespace({ namespaceId, namespaceRevisionId }) {
  const namespace = await Namespace.findById(namespaceId).lean();
  if (!namespace) return summarize([]);
  const contexts = await EditorialContext.find({
    namespaceId: namespace._id,
    publishedReleaseId: { $ne: null },
    lifecycleStatus: "active",
    "namespaceDependency.versionPolicy": "follow_current",
  }).select("_id contentSpaceId").lean();
  const spaces = await ContentSpace.find({ _id: { $in: contexts.map((entry) => entry.contentSpaceId) }, lifecycleStatus: "active" }).select("_id ownerType ownerId").lean();
  const spaceById = new Map(spaces.map((entry) => [id(entry._id), entry]));
  const results = [];
  for (const context of contexts) {
    const space = spaceById.get(id(context.contentSpaceId));
    if (!space || !sameOwner(space.ownerType, space.ownerId, namespace)) { results.push(null); continue; }
    results.push(await revalidateEditorialContextNamespaceDependency({
      editorialContextId: context._id,
      expectedDependencyRevisionId: namespaceRevisionId,
      force: true,
    }));
  }
  return summarize(results);
}

module.exports = {
  revalidateVenuePhysicalDependency,
  revalidateItemEditionNamespaceDependency,
  revalidateSemanticGraphNamespaceDependency,
  revalidateEditorialContextNamespaceDependency,
  auditVenuesAgainstPhysicalVocabulary,
  auditItemEditionsAgainstNamespace,
  auditSemanticGraphsAgainstNamespace,
  auditEditorialContextsAgainstNamespace,
};
