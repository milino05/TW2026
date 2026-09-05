const EditorialContext = require("../models/editorialContext.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const Subject = require("../models/subject.model");
const CollectionSubjectMembership = require("../models/collectionSubjectMembership.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const { validatePresentationAgainstNamespace } = require("./itemV2Presentation.service");
const { validateGraphSnapshotAgainstNamespace } = require("./semanticGraphV2.service");

function id(value) { return String(value?._id || value || ""); }

async function resolveSubjectScope({ editorialContextId, subjectIds }) {
  if (subjectIds !== null && subjectIds !== undefined) {
    return [...new Set((subjectIds || []).map(id).filter(Boolean))];
  }
  const memberships = await CollectionSubjectMembership.find({ editorialContextId }).select("subjectId").lean();
  return [...new Set(memberships.map((membership) => id(membership.subjectId)).filter(Boolean))];
}

async function validateEditorialReleaseCoherence({ editorialContextId, namespaceRevisionId, graphRevisionId, subjectIds = null, itemBindings = [] }) {
  const issues = [];
  const context = await EditorialContext.findOne({ _id: editorialContextId, lifecycleStatus: "active" }).lean();
  if (!context) return [{ field: "editorialContextId", code: "EDITORIAL_CONTEXT_NOT_FOUND", message: "EditorialContext non trovato" }];

  const namespaceRevision = await NamespaceRevision.findOne({ _id: namespaceRevisionId, namespaceId: context.namespaceId }).lean();
  if (!namespaceRevision) return [{ field: "namespaceRevisionId", code: "NAMESPACE_REVISION_MISMATCH", message: "NamespaceRevision non appartiene al Namespace del Context" }];
  if (!["published", "superseded"].includes(namespaceRevision.status) || namespaceRevision.integrity?.status !== "valid") {
    issues.push({ field: "namespaceRevisionId", code: "NAMESPACE_REVISION_NOT_RELEASE_READY", message: "La NamespaceRevision deve essere una versione pubblicata immutabile e valida" });
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

  const normalizedSubjectIds = await resolveSubjectScope({ editorialContextId: context._id, subjectIds });
  const [subjects, spaceSubjectMemberships] = normalizedSubjectIds.length
    ? await Promise.all([
      Subject.find({ _id: { $in: normalizedSubjectIds } }).select("_id").lean(),
      ContentSpaceSubjectMembership.find({ contentSpaceId: context.contentSpaceId, subjectId: { $in: normalizedSubjectIds } }).select("subjectId").lean(),
    ])
    : [[], []];
  const existingSubjectIds = new Set(subjects.map((subject) => id(subject._id)));
  const spaceSubjectIds = new Set(spaceSubjectMemberships.map((membership) => id(membership.subjectId)));
  normalizedSubjectIds.forEach((subjectId, index) => {
    if (!existingSubjectIds.has(subjectId)) issues.push({ field: `subjectIds[${index}]`, code: "SUBJECT_NOT_FOUND", message: "Subject del perimetro editoriale non trovato" });
    if (!spaceSubjectIds.has(subjectId)) issues.push({ field: `subjectIds[${index}]`, code: "SUBJECT_NOT_IN_CONTENT_SPACE", message: "Subject non presente nel perimetro dello spazio editoriale" });
  });
  const subjectScope = new Set(normalizedSubjectIds);

  const selectionSignalIds = new Set((namespaceRevision.selectionSignals || []).map((entry) => String(entry.definitionId)));
  const editionIds = itemBindings.map((binding) => binding.itemEditionId);
  const editions = await ItemEdition.find({ _id: { $in: editionIds } }).lean();
  const editionById = new Map(editions.map((edition) => [id(edition._id), edition]));
  const boundItemIds = [...new Set(itemBindings.map((binding) => id(binding.itemId)).filter(Boolean))];
  const [items, memberships, revisions] = await Promise.all([
    ItemV2.find({ _id: { $in: boundItemIds }, lifecycleStatus: "active" }).select("_id primarySubjectId").lean(),
    ContentSpaceItemMembership.find({ contentSpaceId: context.contentSpaceId, itemId: { $in: boundItemIds } }).select("itemId").lean(),
    ItemRevisionV2.find({ _id: { $in: itemBindings.map((binding) => binding.itemRevisionId) } }).lean(),
  ]);
  const authoredRevisionIds = [...new Set(revisions.map((revision) => id(revision.authoredAgainstNamespaceRevisionId)).filter(Boolean))];
  const compatibleAuthoredRevisions = await NamespaceRevision.find({ _id: { $in: authoredRevisionIds }, namespaceId: context.namespaceId }).select("_id").lean();
  const compatibleAuthoredRevisionIds = new Set(compatibleAuthoredRevisions.map((revision) => id(revision._id)));
  const itemById = new Map(items.map((item) => [id(item._id), item]));
  const memberItemIds = new Set(memberships.map((membership) => id(membership.itemId)));
  const revisionById = new Map(revisions.map((revision) => [id(revision._id), revision]));

  itemBindings.forEach((binding, index) => {
    const base = `itemBindings[${index}]`;
    const bindingItemId = id(binding.itemId);
    if (!bindingItemId) {
      issues.push({ field: `${base}.itemId`, code: "ITEM_ID_REQUIRED", message: "Il binding deve identificare esplicitamente l'Item" });
      return;
    }
    const edition = editionById.get(id(binding.itemEditionId));
    if (!edition) {
      issues.push({ field: `${base}.itemEditionId`, code: "ITEM_EDITION_NOT_FOUND", message: "ItemEdition non trovata" });
      return;
    }
    if (id(edition.itemId) !== bindingItemId) issues.push({ field: `${base}.itemId`, code: "ITEM_EDITION_ITEM_MISMATCH", message: "ItemEdition non appartiene all'Item indicato dal binding" });
    if (id(edition.namespaceId) !== id(context.namespaceId)) issues.push({ field: `${base}.itemEditionId`, code: "ITEM_EDITION_NAMESPACE_MISMATCH", message: "ItemEdition appartiene a un Namespace diverso dal Context" });
    const item = itemById.get(bindingItemId);
    if (!item) issues.push({ field: `${base}.itemId`, code: "ITEM_NOT_ACTIVE", message: "Item non disponibile" });
    else if (!subjectScope.has(id(item.primarySubjectId))) issues.push({ field: `${base}.itemId`, code: "COLLECTION_ITEM_SUBJECT_OUT_OF_SCOPE", message: "Il Subject principale dell'Item non appartiene al perimetro editoriale congelato" });
    if (!memberItemIds.has(bindingItemId)) issues.push({ field: `${base}.itemId`, code: "ITEM_NOT_IN_CONTENT_SPACE", message: "Item non presente nel ContentSpace del Context" });

    const revision = revisionById.get(id(binding.itemRevisionId));
    if (!revision || id(revision.itemEditionId) !== id(edition._id)) {
      issues.push({ field: `${base}.itemRevisionId`, code: "ITEM_REVISION_MISMATCH", message: "ItemRevision non appartiene alla ItemEdition indicata" });
      return;
    }
    if (!["published", "superseded"].includes(revision.status)) issues.push({ field: `${base}.itemRevisionId`, code: "ITEM_REVISION_NOT_RELEASE_READY", message: "ItemRevision deve essere immutabile/pubblicata prima della Release" });
    if (!compatibleAuthoredRevisionIds.has(id(revision.authoredAgainstNamespaceRevisionId))) issues.push({ field: `${base}.itemRevisionId`, code: "ITEM_NAMESPACE_LINEAGE_MISMATCH", message: "ItemRevision authored contro un Namespace incompatibile" });
    issues.push(...validatePresentationAgainstNamespace(revision, namespaceRevision).map((issue) => ({ ...issue, field: `${base}.${issue.field || "itemRevisionId"}` })));

    (binding.curationSignals || []).forEach((signal, signalIndex) => {
      if (!selectionSignalIds.has(String(signal.definitionId))) issues.push({ field: `${base}.curationSignals[${signalIndex}].definitionId`, code: "UNKNOWN_CURATION_SIGNAL", message: `SelectionSignal non disponibile: ${signal.definitionId}` });
    });
  });

  return issues;
}

module.exports = { validateEditorialReleaseCoherence };
