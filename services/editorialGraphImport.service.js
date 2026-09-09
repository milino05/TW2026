const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const EditorialGraphImportSource = require("../models/editorialGraphImportSource.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Subject = require("../models/subject.model");
const SemanticGraph = require("../models/semanticGraph.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const AppError = require("../utils/AppError");
const { findContentSpaceOrFail, assertCanManageContentSpace } = require("./contentSpace.service");
const { assertCanReferenceItemInEditorialSpace } = require("./itemUsageAuthorization.service");
const { loadSemanticGraphRevision, validateGraphSnapshotAgainstNamespace } = require("./semanticGraphV2.service");
const { writeSemanticGraphSnapshot } = require("./semanticGraphSnapshotWriter.service");
const { loadCompatibleGraph } = require("./editorialStudioCreationV2.service");
const { findContextOrFail, assertWorkingStateEditable } = require("./editorialContextEntry.service");
const NamespaceRevision = require("../models/namespaceRevision.model");

function id(value) { return String(value?._id || value || ""); }
function sameId(left, right) { return id(left) === id(right); }
function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
}
function collectionConflict() {
  return new AppError("La raccolta è stata modificata da un'altra operazione", 409, [{ code: "EDITORIAL_CONTEXT_WORKING_CONFLICT" }]);
}

async function loadContextImportState({ editorialContextId, actorUserId, write = false }) {
  const context = await findContextOrFail(editorialContextId);
  const contentSpace = await findContentSpaceOrFail({ contentSpaceId: context.contentSpaceId });
  await assertCanManageContentSpace(contentSpace, actorUserId, write ? "editorial_context.edit" : "editorial_context.view");
  if (write) {
    await assertCanManageContentSpace(contentSpace, actorUserId, "semantic_graph.edit");
    assertWorkingStateEditable(context);
  }
  const semanticGraph = await SemanticGraph.findOne({ _id: context.semanticGraphId, lifecycleStatus: "active" });
  if (!semanticGraph) throw new AppError("Grafo semantico della Raccolta non disponibile", 409);
  if (semanticGraph.ownerType !== contentSpace.ownerType || !sameId(semanticGraph.ownerId, contentSpace.ownerId)) {
    throw new AppError("Il grafo della Raccolta appartiene a un'altra area di lavoro", 409, [{ code: "SEMANTIC_GRAPH_OWNER_MISMATCH" }]);
  }
  if (!sameId(semanticGraph.namespaceId, context.namespaceId)) {
    throw new AppError("Il grafo della Raccolta usa Regole editoriali diverse", 409, [{ code: "SEMANTIC_GRAPH_NAMESPACE_MISMATCH" }]);
  }
  return { context, contentSpace, semanticGraph };
}

async function contentSpaceInventory({ contentSpaceId, namespaceId }) {
  const memberships = await ContentSpaceItemMembership.find({ contentSpaceId }).select("itemId").lean();
  if (!memberships.length) return new Map();
  const itemIds = memberships.map((entry) => entry.itemId);
  const [items, editions] = await Promise.all([
    ItemV2.find({ _id: { $in: itemIds }, lifecycleStatus: "active" }).select("_id primarySubjectId ownerType ownerId").lean(),
    ItemEdition.find({ itemId: { $in: itemIds }, namespaceId }).select("_id itemId workingRevisionId publishedRevisionId").lean(),
  ]);
  const editionByItem = new Map(editions.map((entry) => [id(entry.itemId), entry]));
  const revisionIds = [...new Set(editions.map((entry) => id(entry.workingRevisionId || entry.publishedRevisionId)).filter(Boolean))];
  const revisions = revisionIds.length
    ? await ItemRevisionV2.find({ _id: { $in: revisionIds } }).select("_id label status version").lean()
    : [];
  const revisionById = new Map(revisions.map((entry) => [id(entry), entry]));
  const inventory = new Map();
  for (const item of items) {
    const subjectId = id(item.primarySubjectId);
    if (!subjectId) continue;
    const edition = editionByItem.get(id(item)) || null;
    const revision = edition ? revisionById.get(id(edition.workingRevisionId || edition.publishedRevisionId)) || null : null;
    const rows = inventory.get(subjectId) || [];
    rows.push({
      itemId: item._id,
      editionId: edition?._id || null,
      revisionId: revision?._id || null,
      label: revision?.label || null,
      status: revision?.status || null,
      version: revision?.version || null,
    });
    inventory.set(subjectId, rows);
  }
  return inventory;
}

async function collectionSubjectState(context, semanticGraph) {
  const memberships = await CollectionItemMembership.find({ editorialContextId: context._id }).select("itemId").lean();
  const items = memberships.length
    ? await ItemV2.find({ _id: { $in: memberships.map((entry) => entry.itemId) }, lifecycleStatus: "active" }).select("_id primarySubjectId").lean()
    : [];
  const itemSubjectById = new Map(items.map((entry) => [id(entry), id(entry.primarySubjectId)]));
  const collectionSubjects = new Set();
  for (const membership of memberships) {
    const subjectId = itemSubjectById.get(id(membership.itemId));
    if (subjectId) collectionSubjects.add(subjectId);
  }
  const graphBindings = semanticGraph.workingRevisionId
    ? await GraphSubjectBinding.find({ graphRevisionId: semanticGraph.workingRevisionId }).select("subjectId").lean()
    : [];
  const graphSubjects = new Set(graphBindings.map((entry) => id(entry.subjectId)));
  return { collectionSubjects, graphSubjects };
}

function sourceRelationCounts(sourceSnapshot) {
  const counts = new Map();
  for (const edge of sourceSnapshot.authoritativeEdges) {
    const sourceId = id(edge.sourceSubjectId);
    const targetId = id(edge.targetSubjectId);
    counts.set(sourceId, (counts.get(sourceId) || 0) + 1);
    counts.set(targetId, (counts.get(targetId) || 0) + 1);
  }
  return counts;
}

async function buildImportPreview({ sourceGraph, sourceSnapshot, contentSpace, namespaceId, context = null, semanticGraph = null }) {
  const inventory = await contentSpaceInventory({ contentSpaceId: contentSpace._id, namespaceId });
  const state = context && semanticGraph
    ? await collectionSubjectState(context, semanticGraph)
    : { collectionSubjects: new Set(), graphSubjects: new Set() };
  const sourceBindings = [...sourceSnapshot.nodes.values()].filter((node) => node.binding);
  const sourceSubjectIds = sourceBindings.map((node) => node.subject._id);
  const subjects = sourceSubjectIds.length
    ? await Subject.find({ _id: { $in: sourceSubjectIds } }).select("preferredLabel description externalIdentities").lean()
    : [];
  const subjectById = new Map(subjects.map((entry) => [id(entry), entry]));
  const relationCounts = sourceRelationCounts(sourceSnapshot);

  const results = sourceBindings.map((node) => {
    const subjectId = id(node.subject);
    const candidates = inventory.get(subjectId) || [];
    const inGraph = state.graphSubjects.has(subjectId);
    const inCollection = state.collectionSubjects.has(subjectId);
    let status = "unavailable";
    if (inGraph) status = "active";
    else if (inCollection) status = "in_collection";
    else if (candidates.length === 1) status = "addable";
    else if (candidates.length > 1) status = "ambiguous";
    const subject = subjectById.get(subjectId) || node.subject;
    return {
      subject: {
        id: node.subject._id,
        label: subject?.preferredLabel || "Subject",
        description: subject?.description || "",
      },
      subjectClassDefinitionIds: [...(node.binding.subjectClassDefinitionIds || [])],
      sourceRelationCount: relationCounts.get(subjectId) || 0,
      inGraph,
      inCollection,
      status,
      itemCandidates: candidates,
    };
  });

  const summary = {
    totalSubjectCount: results.length,
    activeSubjectCount: results.filter((entry) => entry.status === "active").length,
    inCollectionSubjectCount: results.filter((entry) => entry.status === "in_collection").length,
    directlyImportableSubjectCount: results.filter((entry) => entry.status === "addable").length,
    ambiguousSubjectCount: results.filter((entry) => entry.status === "ambiguous").length,
    unavailableSubjectCount: results.filter((entry) => entry.status === "unavailable").length,
    sourceRelationCount: sourceSnapshot.authoritativeEdges.length,
  };
  return {
    source: {
      semanticGraphId: sourceGraph._id,
      graphRevisionId: sourceSnapshot.revision._id,
      name: sourceGraph.displayName,
      description: sourceGraph.description || "",
      lifecycleStatus: sourceGraph.lifecycleStatus || "active",
    },
    summary,
    results,
  };
}

async function previewSemanticGraphImport({
  actorUserId,
  sourceSemanticGraphId,
  contentSpaceId = null,
  editorialContextId = null,
  ownerType = null,
  ownerId = null,
  namespaceId = null,
}) {
  let context = null;
  let contentSpace = null;
  let semanticGraph = null;
  if (editorialContextId) {
    ({ context, contentSpace, semanticGraph } = await loadContextImportState({ editorialContextId, actorUserId, write: false }));
    ownerType = contentSpace.ownerType;
    ownerId = contentSpace.ownerId;
    namespaceId = context.namespaceId;
  } else {
    assertObjectId(contentSpaceId, "contentSpaceId");
    assertObjectId(ownerId, "ownerId");
    assertObjectId(namespaceId, "namespaceId");
    contentSpace = await findContentSpaceOrFail({ contentSpaceId });
    if (contentSpace.ownerType !== ownerType || !sameId(contentSpace.ownerId, ownerId)) {
      throw new AppError("Lo spazio editoriale non appartiene all'area di lavoro selezionata", 409, [{ code: "CONTENT_SPACE_OWNER_MISMATCH" }]);
    }
    await assertCanManageContentSpace(contentSpace, actorUserId, "editorial_context.view");
  }

  const sourceGraph = await loadCompatibleGraph({
    semanticGraphId: sourceSemanticGraphId,
    ownerType,
    ownerId,
    namespaceId,
  });
  if (semanticGraph && sameId(sourceGraph._id, semanticGraph._id)) {
    throw new AppError("Il grafo locale della Raccolta non può essere usato come propria sorgente", 409, [{ code: "SEMANTIC_GRAPH_IMPORT_SELF_SOURCE" }]);
  }
  const sourceSnapshot = await loadSemanticGraphRevision(sourceGraph.workingRevisionId);
  return buildImportPreview({ sourceGraph, sourceSnapshot, contentSpace, namespaceId, context, semanticGraph });
}

async function attachEditorialGraphImportSource({ editorialContextId, sourceSemanticGraphId, actorUserId }) {
  const { context, contentSpace, semanticGraph } = await loadContextImportState({ editorialContextId, actorUserId, write: true });
  const sourceGraph = await loadCompatibleGraph({
    semanticGraphId: sourceSemanticGraphId,
    ownerType: contentSpace.ownerType,
    ownerId: contentSpace.ownerId,
    namespaceId: context.namespaceId,
  });
  if (sameId(sourceGraph._id, semanticGraph._id)) {
    throw new AppError("Il grafo locale della Raccolta non può essere usato come propria sorgente", 409, [{ code: "SEMANTIC_GRAPH_IMPORT_SELF_SOURCE" }]);
  }
  const sourceSnapshot = await loadSemanticGraphRevision(sourceGraph.workingRevisionId);
  let source = null;
  try {
    source = await EditorialGraphImportSource.create({
      editorialContextId: context._id,
      targetSemanticGraphId: semanticGraph._id,
      sourceSemanticGraphId: sourceGraph._id,
      sourceGraphRevisionId: sourceSnapshot.revision._id,
      createdBy: actorUserId,
    });
  } catch (error) {
    if (error?.code === 11000) {
      source = await EditorialGraphImportSource.findOne({
        editorialContextId: context._id,
        sourceGraphRevisionId: sourceSnapshot.revision._id,
      });
    } else throw error;
  }
  return {
    source,
    preview: await buildImportPreview({ sourceGraph, sourceSnapshot, contentSpace, namespaceId: context.namespaceId, context, semanticGraph }),
  };
}

async function listEditorialGraphImportSources({ editorialContextId, actorUserId }) {
  const { context, contentSpace, semanticGraph } = await loadContextImportState({ editorialContextId, actorUserId, write: false });
  const sources = await EditorialGraphImportSource.find({ editorialContextId: context._id }).sort({ createdAt: -1 }).lean();
  const results = [];
  for (const source of sources) {
    const [sourceGraph, sourceSnapshot] = await Promise.all([
      SemanticGraph.findById(source.sourceSemanticGraphId).lean(),
      loadSemanticGraphRevision(source.sourceGraphRevisionId),
    ]);
    if (!sourceGraph) continue;
    results.push({
      id: source._id,
      createdAt: source.createdAt,
      preview: await buildImportPreview({ sourceGraph, sourceSnapshot, contentSpace, namespaceId: context.namespaceId, context, semanticGraph }),
    });
  }
  return { results };
}

function cloneGraphSnapshot(graph) {
  if (!graph) return { subjectBindings: [], edges: [] };
  return {
    subjectBindings: [...graph.nodes.values()]
      .filter((node) => node.binding)
      .map((node) => ({
        subjectId: node.subject._id,
        subjectClassDefinitionIds: [...(node.binding.subjectClassDefinitionIds || [])],
      })),
    edges: graph.authoritativeEdges.map((edge) => ({
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: edge.provenance || { origin: "human" },
    })),
  };
}

function edgeKey(edge) {
  return JSON.stringify([
    id(edge.sourceSubjectId),
    String(edge.relationTypeDefinitionId || ""),
    id(edge.targetSubjectId),
  ]);
}

async function importEditorialGraphSubjects({ editorialContextId, sourceId, itemIds = [], actorUserId }) {
  assertObjectId(sourceId, "sourceId");
  if (!Array.isArray(itemIds)) throw new AppError("itemIds deve essere un array", 400, [{ field: "itemIds", code: "INVALID_TYPE" }]);
  const normalizedItemIds = [...new Set(itemIds.map((entry) => String(entry || "").trim()).filter(Boolean))];
  normalizedItemIds.forEach((entry, index) => assertObjectId(entry, `itemIds[${index}]`));
  if (!normalizedItemIds.length) throw new AppError("Seleziona almeno un contenuto da importare", 400, [{ field: "itemIds", code: "REQUIRED" }]);

  const { context, contentSpace, semanticGraph } = await loadContextImportState({ editorialContextId, actorUserId, write: true });
  const source = await EditorialGraphImportSource.findOne({ _id: sourceId, editorialContextId: context._id });
  if (!source) throw new AppError("Sorgente semantica non trovata", 404);
  if (!sameId(source.targetSemanticGraphId, semanticGraph._id)) {
    throw new AppError("La sorgente non appartiene al grafo locale corrente", 409, [{ code: "SEMANTIC_GRAPH_IMPORT_TARGET_MISMATCH" }]);
  }

  const sourceSnapshot = await loadSemanticGraphRevision(source.sourceGraphRevisionId);
  const localGraph = semanticGraph.workingRevisionId ? await loadSemanticGraphRevision(semanticGraph.workingRevisionId) : null;
  const namespaceRevisionId = localGraph?.revision?.authoredAgainstNamespaceRevisionId || sourceSnapshot.revision.authoredAgainstNamespaceRevisionId;
  const namespaceRevision = await NamespaceRevision.findOne({ _id: namespaceRevisionId, namespaceId: context.namespaceId }).lean();
  if (!namespaceRevision) throw new AppError("Revisione delle Regole editoriali non disponibile", 409);

  const objectIds = normalizedItemIds.map((value) => new mongoose.Types.ObjectId(value));
  const [spaceMemberships, items] = await Promise.all([
    ContentSpaceItemMembership.find({ contentSpaceId: contentSpace._id, itemId: { $in: objectIds } }).select("itemId").lean(),
    ItemV2.find({ _id: { $in: objectIds }, lifecycleStatus: "active" }).select("_id primarySubjectId").lean(),
  ]);
  const spaceItemIds = new Set(spaceMemberships.map((entry) => id(entry.itemId)));
  const itemById = new Map(items.map((entry) => [id(entry), entry]));
  const sourceBindingBySubject = new Map([...sourceSnapshot.nodes.values()]
    .filter((node) => node.binding)
    .map((node) => [id(node.subject), node.binding]));

  const selectedItems = [];
  for (const itemId of normalizedItemIds) {
    if (!spaceItemIds.has(itemId)) {
      throw new AppError("Il contenuto deve appartenere allo spazio editoriale", 409, [{
        code: "ITEM_NOT_IN_CONTENT_SPACE",
        context: { itemId },
      }]);
    }
    const item = itemById.get(itemId);
    if (!item) throw new AppError("Contenuto non disponibile", 409, [{ code: "ITEM_NOT_ACTIVE", context: { itemId } }]);
    const subjectId = id(item.primarySubjectId);
    if (!sourceBindingBySubject.has(subjectId)) {
      throw new AppError("Il contenuto non rappresenta un Subject della sorgente", 409, [{
        code: "IMPORT_ITEM_SUBJECT_NOT_IN_SOURCE_GRAPH",
        context: { itemId, subjectId },
      }]);
    }
    await assertCanReferenceItemInEditorialSpace({
      itemId: item._id,
      actorUserId,
      principalType: contentSpace.ownerType,
      principalId: contentSpace.ownerId,
    });
    selectedItems.push(item);
  }

  const snapshot = cloneGraphSnapshot(localGraph);
  const currentSubjectIds = new Set(snapshot.subjectBindings.map((entry) => id(entry.subjectId)));
  const selectedSubjectIds = [...new Set(selectedItems.map((entry) => id(entry.primarySubjectId)))];
  let activatedSubjectCount = 0;
  for (const subjectId of selectedSubjectIds) {
    if (currentSubjectIds.has(subjectId)) continue;
    const sourceBinding = sourceBindingBySubject.get(subjectId);
    snapshot.subjectBindings.push({
      subjectId: new mongoose.Types.ObjectId(subjectId),
      subjectClassDefinitionIds: [...(sourceBinding.subjectClassDefinitionIds || [])],
    });
    currentSubjectIds.add(subjectId);
    activatedSubjectCount += 1;
  }

  const existingEdgeKeys = new Set(snapshot.edges.map(edgeKey));
  const suppressedEdgeKeys = new Set(source.suppressedEdgeKeys || []);
  let activatedRelationCount = 0;
  for (const edge of sourceSnapshot.authoritativeEdges) {
    if (!currentSubjectIds.has(id(edge.sourceSubjectId)) || !currentSubjectIds.has(id(edge.targetSubjectId))) continue;
    const key = edgeKey(edge);
    if (existingEdgeKeys.has(key) || suppressedEdgeKeys.has(key)) continue;
    snapshot.edges.push({
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: {
        origin: "imported",
        sourceGraphRevisionId: source.sourceGraphRevisionId,
        metadata: edge.provenance ? { sourceProvenance: edge.provenance } : null,
      },
    });
    existingEdgeKeys.add(key);
    activatedRelationCount += 1;
  }

  const issues = validateGraphSnapshotAgainstNamespace(snapshot, namespaceRevision);
  if (issues.length) throw new AppError("L'importazione produrrebbe un grafo non compatibile con le Regole editoriali", 409, issues);

  const expectedCollectionVersion = Number(context.workingVersion || 0);
  const alreadyPresent = await CollectionItemMembership.find({
    editorialContextId: context._id,
    itemId: { $in: objectIds },
  }).select("itemId").lean();
  const existingItemIds = new Set(alreadyPresent.map((entry) => id(entry.itemId)));
  const newItems = selectedItems.filter((entry) => !existingItemIds.has(id(entry)));
  const graphChanged = activatedSubjectCount > 0 || activatedRelationCount > 0;
  const collectionChanged = newItems.length > 0 || graphChanged;
  if (!collectionChanged) {
    return {
      importedItemCount: 0,
      activatedSubjectCount: 0,
      activatedRelationCount: 0,
      graphRevisionId: semanticGraph.workingRevisionId || null,
      graph: localGraph,
    };
  }

  let revision = null;
  await mongoose.connection.transaction(async (session) => {
    const lockedContext = await EditorialContext.findOne({
      _id: context._id,
      lifecycleStatus: "active",
      activeReviewRevisionId: null,
      workingVersion: expectedCollectionVersion,
    }).session(session);
    if (!lockedContext) throw collectionConflict();

    if (newItems.length) {
      await CollectionItemMembership.insertMany(newItems.map((item) => ({
        editorialContextId: lockedContext._id,
        itemId: item._id,
        curationSignals: [],
        addedBy: actorUserId,
        updatedBy: actorUserId,
      })), { session, ordered: true });
      for (const subjectId of [...new Set(newItems.map((item) => id(item.primarySubjectId)))]) {
        await ContentSpaceSubjectMembership.findOneAndUpdate(
          { contentSpaceId: lockedContext.contentSpaceId, subjectId },
          { $setOnInsert: { contentSpaceId: lockedContext.contentSpaceId, subjectId, addedBy: actorUserId } },
          { upsert: true, new: true, session },
        );
      }
    }

    lockedContext.workingVersion = expectedCollectionVersion + 1;
    await lockedContext.save({ session });

    if (graphChanged) {
      revision = await writeSemanticGraphSnapshot({
        semanticGraph,
        namespaceRevision,
        snapshot,
        actorUserId,
        session,
      });
    }
  });

  const finalRevisionId = revision?._id || semanticGraph.workingRevisionId || null;
  return {
    importedItemCount: newItems.length,
    activatedSubjectCount,
    activatedRelationCount,
    graphRevisionId: finalRevisionId,
    graph: revision ? await loadSemanticGraphRevision(revision._id, { bypassCache: true }) : localGraph,
  };
}

module.exports = {
  previewSemanticGraphImport,
  attachEditorialGraphImportSource,
  listEditorialGraphImportSources,
  importEditorialGraphSubjects,
  buildImportPreview,
};
