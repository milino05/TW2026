const EditorialContext = require("../models/editorialContext.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const { validatePresentationAgainstNamespace } = require("./itemV2Presentation.service");
const { validateGraphSnapshotAgainstNamespace } = require("./semanticGraphV2.service");

async function validateEditorialReleaseCoherence({ editorialContextId, namespaceRevisionId, graphRevisionId, itemBindings = [] }) {
  const issues = [];
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" }).lean();
  if (!context) return [{ field: "editorialContextId", code: "EDITORIAL_CONTEXT_NOT_FOUND", message: "EditorialContext non trovato" }];

  const namespaceRevision = await NamespaceRevision.findOne({ _id: namespaceRevisionId, namespaceId: context.namespaceId }).lean();
  if (!namespaceRevision) return [{ field: "namespaceRevisionId", code: "NAMESPACE_REVISION_MISMATCH", message: "NamespaceRevision non appartiene al Namespace del Context" }];
  if (namespaceRevision.status !== "published" || namespaceRevision.integrity?.status !== "valid") {
    issues.push({ field: "namespaceRevisionId", code: "NAMESPACE_REVISION_NOT_RELEASE_READY", message: "La NamespaceRevision deve essere pubblicata e valida" });
  }

  const graphRevision = await SemanticGraphRevision.findOne({ _id: graphRevisionId, semanticGraphId: context.semanticGraphId }).lean();
  if (!graphRevision) {
    issues.push({ field: "graphRevisionId", code: "GRAPH_REVISION_MISMATCH", message: "GraphRevision non appartiene al grafo semantico usato dalla raccolta" });
  } else {
    const authoredNamespaceRevision = await NamespaceRevision.findOne({ _id: graphRevision.authoredAgainstNamespaceRevisionId, namespaceId: context.namespaceId }).select("_id").lean();
    if (!authoredNamespaceRevision) issues.push({ field: "graphRevisionId", code: "GRAPH_NAMESPACE_LINEAGE_MISMATCH", message: "GraphRevision authored contro un Namespace incompatibile" });
    const [subjectBindings, edges] = await Promise.all([
      GraphSubjectBinding.find({ graphRevisionId: graphRevision._id }).lean(),
      SemanticEdgeV2.find({ graphRevisionId: graphRevision._id }).lean(),
    ]);
    issues.push(...validateGraphSnapshotAgainstNamespace({ subjectBindings, edges }, namespaceRevision));
  }

  const selectionSignalIds = new Set((namespaceRevision.selectionSignals || []).map((entry) => String(entry.definitionId)));
  const editionIds = itemBindings.map((binding) => binding.itemEditionId);
  const editions = await ItemEdition.find({ _id: { $in: editionIds } }).lean();
  const editionById = new Map(editions.map((edition) => [String(edition._id), edition]));
  const itemIds = [...new Set(editions.map((edition) => String(edition.itemId)))];
  const [items, memberships, revisions] = await Promise.all([
    ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).select("_id").lean(),
    ContentSpaceMembership.find({ contentSpaceId: context.contentSpaceId, itemId: { $in: itemIds } }).select("itemId").lean(),
    ItemRevisionV2.find({ _id: { $in: itemBindings.map((binding) => binding.itemRevisionId) } }).lean(),
  ]);
  const authoredRevisionIds = [...new Set(revisions.map((revision) => String(revision.authoredAgainstNamespaceRevisionId || "")).filter(Boolean))];
  const compatibleAuthoredRevisions = await NamespaceRevision.find({ _id: { $in: authoredRevisionIds }, namespaceId: context.namespaceId }).select("_id").lean();
  const compatibleAuthoredRevisionIds = new Set(compatibleAuthoredRevisions.map((revision) => String(revision._id)));
  const activeItemIds = new Set(items.map((item) => String(item._id)));
  const memberItemIds = new Set(memberships.map((membership) => String(membership.itemId)));
  const revisionById = new Map(revisions.map((revision) => [String(revision._id), revision]));

  itemBindings.forEach((binding, index) => {
    const base = `itemBindings[${index}]`;
    const edition = editionById.get(String(binding.itemEditionId));
    if (!edition) {
      issues.push({ field: `${base}.itemEditionId`, code: "ITEM_EDITION_NOT_FOUND", message: "ItemEdition non trovata" });
      return;
    }
    if (String(edition.namespaceId) !== String(context.namespaceId)) issues.push({ field: `${base}.itemEditionId`, code: "ITEM_EDITION_NAMESPACE_MISMATCH", message: "ItemEdition appartiene a un Namespace diverso dal Context" });
    if (!activeItemIds.has(String(edition.itemId))) issues.push({ field: `${base}.itemEditionId`, code: "ITEM_NOT_ACTIVE", message: "Item non disponibile" });
    if (!memberItemIds.has(String(edition.itemId))) issues.push({ field: `${base}.itemEditionId`, code: "ITEM_NOT_IN_CONTENT_SPACE", message: "Item non presente nel ContentSpace del Context" });

    const revision = revisionById.get(String(binding.itemRevisionId));
    if (!revision || String(revision.itemEditionId) !== String(edition._id)) {
      issues.push({ field: `${base}.itemRevisionId`, code: "ITEM_REVISION_MISMATCH", message: "ItemRevision non appartiene alla ItemEdition indicata" });
      return;
    }
    if (!["published", "superseded"].includes(revision.status)) issues.push({ field: `${base}.itemRevisionId`, code: "ITEM_REVISION_NOT_RELEASE_READY", message: "ItemRevision deve essere immutabile/pubblicata prima della Release" });
    if (!compatibleAuthoredRevisionIds.has(String(revision.authoredAgainstNamespaceRevisionId || ""))) issues.push({ field: `${base}.itemRevisionId`, code: "ITEM_NAMESPACE_LINEAGE_MISMATCH", message: "ItemRevision authored contro un Namespace incompatibile" });
    issues.push(...validatePresentationAgainstNamespace(revision, namespaceRevision).map((issue) => ({ ...issue, field: `${base}.${issue.field || "itemRevisionId"}` })));

    (binding.curationSignals || []).forEach((signal, signalIndex) => {
      if (!selectionSignalIds.has(String(signal.definitionId))) issues.push({ field: `${base}.curationSignals[${signalIndex}].definitionId`, code: "UNKNOWN_CURATION_SIGNAL", message: `SelectionSignal non disponibile: ${signal.definitionId}` });
    });
  });

  return issues;
}

module.exports = { validateEditorialReleaseCoherence };
