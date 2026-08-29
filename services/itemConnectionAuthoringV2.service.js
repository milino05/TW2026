const mongoose = require("mongoose");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const ItemV2 = require("../models/itemV2.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { createContentSpace } = require("./contentSpace.service");
const { createEditorialContext } = require("./editorialContext.service");
const { loadSemanticGraphRevision, createGraphRevision } = require("./semanticGraphV2.service");
const { findItemOrFail, assertCanManageItem } = require("./itemV2.service");
const {
  normalizeItemConnectionPayload,
  validateItemConnectionPayload,
} = require("./validation/itemConnectionAuthoringV2.validation");

const MAX_GRAPH_WRITE_ATTEMPTS = 3;
function id(value) { return String(value?._id || value?.id || value || ""); }
function sameId(left, right) { return id(left) === id(right); }
function escapeRegex(value) { return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function isGraphWriteConflict(error) {
  return error?.details?.some((entry) => entry?.code === "GRAPH_REVISION_CONFLICT")
    || [11000, 112, 251].includes(Number(error?.code));
}

async function loadEditionContext({ itemId, editionId, actorUserId }) {
  if (!mongoose.isValidObjectId(editionId)) throw new AppError("Versione editoriale non valida", 400);
  const item = await findItemOrFail(itemId);
  await assertCanManageItem(item, actorUserId);
  const edition = await ItemEdition.findOne({ _id: editionId, itemId: item._id });
  if (!edition) throw new AppError("La versione editoriale non appartiene a questo contenuto", 404);
  const revisionId = edition.workingRevisionId || edition.publishedRevisionId;
  const [revision, namespace] = await Promise.all([
    revisionId ? ItemRevisionV2.findById(revisionId).lean() : null,
    Namespace.findOne({ _id: edition.namespaceId, lifecycleStatus: "active" }).lean(),
  ]);
  if (!revision || !namespace) throw new AppError("Salva prima la versione editoriale per gestire i collegamenti", 409);
  const namespaceRevision = await NamespaceRevision.findOne({
    _id: revision.authoredAgainstNamespaceRevisionId,
    namespaceId: edition.namespaceId,
  }).lean();
  if (!namespaceRevision) throw new AppError("Le regole editoriali usate dal contenuto non sono più disponibili", 409);
  return { item, edition, revision, namespace, namespaceRevision };
}

async function ownerScopes({ item, namespace }) {
  const spaces = await ContentSpace.find({
    ownerType: item.ownerType,
    ownerId: item.ownerId,
    lifecycleStatus: "active",
  }).sort({ name: 1, createdAt: 1 }).lean();
  const contexts = spaces.length ? await EditorialContext.find({
    contentSpaceId: { $in: spaces.map((entry) => entry._id) },
    namespaceId: namespace._id,
    lifecycleStatus: "active",
  }).lean() : [];
  const contextBySpaceId = new Map(contexts.map((entry) => [id(entry.contentSpaceId), entry]));
  if (!spaces.length) return [{
    key: "new",
    contextId: null,
    contentSpaceId: null,
    label: "Collegamenti personali",
    description: "Verrà preparato automaticamente un ambito editoriale privato.",
    willCreate: true,
  }];
  return spaces.map((space) => {
    const context = contextBySpaceId.get(id(space));
    return {
      key: context ? `context:${id(context)}` : `space:${id(space)}`,
      contextId: context?._id || null,
      contentSpaceId: space._id,
      label: context?.displayName || space.name,
      description: context
        ? `Collegamenti nello spazio “${space.name}”.`
        : `Verrà preparato un ambito per le regole “${namespace.name}” nello spazio “${space.name}”.`,
      willCreate: !context,
    };
  });
}

async function effectiveGraph(context) {
  if (context.workingGraphRevisionId) return loadSemanticGraphRevision(context.workingGraphRevisionId);
  if (!context.publishedReleaseId) return null;
  const release = await EditorialRelease.findOne({
    _id: context.publishedReleaseId,
    editorialContextId: context._id,
  }).select("graphRevisionId namespaceRevisionId").lean();
  if (!release) return null;
  return loadSemanticGraphRevision(release.graphRevisionId, { namespaceRevisionId: release.namespaceRevisionId });
}

function writableGraph(graph) {
  if (!graph) return { basedOnRevisionId: null, subjectBindings: [], edges: [] };
  return {
    basedOnRevisionId: graph.revision._id,
    subjectBindings: [...graph.nodes.values()].map((node) => ({
      subjectId: node.subject._id,
      subjectClassDefinitionIds: [...(node.binding?.subjectClassDefinitionIds || [])],
    })),
    edges: graph.authoritativeEdges.map((edge) => ({
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: edge.provenance ?? { origin: "human" },
    })),
  };
}

function projectedDefinitions(namespaceRevision) {
  const classById = new Map((namespaceRevision.subjectClasses || []).map((entry) => [String(entry.definitionId), entry]));
  const projectClasses = (definitionIds = []) => definitionIds.map((definitionId) => ({
    definitionId,
    label: classById.get(String(definitionId))?.label || definitionId,
  }));
  return {
    subjectClasses: (namespaceRevision.subjectClasses || []).map((entry) => ({
      definitionId: entry.definitionId,
      label: entry.label,
      description: entry.description || "",
    })),
    relationTypes: (namespaceRevision.relationTypes || []).map((entry) => ({
      definitionId: entry.definitionId,
      label: entry.label,
      description: entry.description || "",
      category: entry.category,
      strength: entry.strength,
      directionality: entry.directionality,
      domain: projectClasses(entry.domainDefinitionIds),
      range: projectClasses(entry.rangeDefinitionIds),
      validationRules: entry.validationRules || { allowMultiple: true, targetRequired: true },
    })),
  };
}

async function targetItemsBySubject({ item, namespaceId, subjectIds }) {
  const values = [...new Set(subjectIds.map(id).filter(Boolean))];
  if (!values.length) return new Map();
  const items = await ItemV2.find({
    _id: { $ne: item._id },
    ownerType: item.ownerType,
    ownerId: item.ownerId,
    lifecycleStatus: "active",
    primarySubjectId: { $in: values },
  }).sort({ updatedAt: -1 }).lean();
  const editions = await ItemEdition.find({ itemId: { $in: items.map((entry) => entry._id) }, namespaceId }).lean();
  const editionByItemId = new Map(editions.map((entry) => [id(entry.itemId), entry]));
  const revisionIds = editions.map((entry) => entry.workingRevisionId || entry.publishedRevisionId).filter(Boolean);
  const [revisions, subjects] = await Promise.all([
    ItemRevisionV2.find({ _id: { $in: revisionIds } }).select("label illustrativeMedia").lean(),
    Subject.find({ _id: { $in: values } }).select("preferredLabel description").lean(),
  ]);
  const revisionById = new Map(revisions.map((entry) => [id(entry), entry]));
  const subjectById = new Map(subjects.map((entry) => [id(entry), entry]));
  const result = new Map();
  for (const target of items) {
    const edition = editionByItemId.get(id(target));
    const revision = revisionById.get(id(edition?.workingRevisionId || edition?.publishedRevisionId));
    const subject = subjectById.get(id(target.primarySubjectId));
    if (!edition || !revision || result.has(id(target.primarySubjectId))) continue;
    result.set(id(target.primarySubjectId), {
      id: target._id,
      editionId: edition._id,
      title: revision.label,
      subject: { id: target.primarySubjectId, label: subject?.preferredLabel || revision.label },
      image: revision.illustrativeMedia?.[0] || null,
    });
  }
  return result;
}

async function projectConnections({ item, edition, namespaceRevision, scopes }) {
  const contextIds = scopes.map((entry) => entry.contextId).filter(Boolean);
  if (!contextIds.length) return [];
  const contexts = await EditorialContext.find({ _id: { $in: contextIds }, lifecycleStatus: "active" }).lean();
  const sourceSubjectId = id(item.primarySubjectId);
  const rows = [];
  for (const context of contexts) {
    const graph = await effectiveGraph(context);
    if (!graph) continue;
    const outgoing = graph.authoritativeEdges.filter((edge) => sameId(edge.sourceSubjectId, sourceSubjectId));
    const targets = await targetItemsBySubject({
      item,
      namespaceId: edition.namespaceId,
      subjectIds: outgoing.map((edge) => edge.targetSubjectId),
    });
    const relationById = new Map((namespaceRevision.relationTypes || []).map((entry) => [String(entry.definitionId), entry]));
    const scope = scopes.find((entry) => sameId(entry.contextId, context._id));
    for (const edge of outgoing) {
      const relation = relationById.get(String(edge.relationTypeDefinitionId));
      const targetSubject = graph.nodes.get(id(edge.targetSubjectId))?.subject;
      rows.push({
        id: edge._id,
        contextId: context._id,
        scopeLabel: scope?.label || context.displayName,
        relationType: {
          definitionId: edge.relationTypeDefinitionId,
          label: relation?.label || edge.relationTypeDefinitionId,
          directionality: relation?.directionality || "directed",
        },
        targetContent: targets.get(id(edge.targetSubjectId)) || null,
        targetSubject: { id: edge.targetSubjectId, label: targetSubject?.preferredLabel || "Soggetto collegato" },
        weight: edge.weight,
        note: typeof edge.metadata?.note === "string" ? edge.metadata.note : "",
        provenance: edge.provenance || { origin: "human" },
      });
    }
  }
  return rows.sort((left, right) => String(left.relationType.label).localeCompare(String(right.relationType.label), "it"));
}

async function getItemConnectionAuthoring({ itemId, editionId, actorUserId }) {
  const { item, edition, namespace, namespaceRevision } = await loadEditionContext({ itemId, editionId, actorUserId });
  const scopes = await ownerScopes({ item, namespace });
  const definitions = projectedDefinitions(namespaceRevision);
  return {
    sourceContent: { itemId: item._id, editionId: edition._id, subjectId: item.primarySubjectId },
    scopes,
    defaultScopeKey: scopes.length === 1 ? scopes[0].key : "",
    ...definitions,
    connections: await projectConnections({ item, edition, namespaceRevision, scopes }),
    targetSearch: { minimumQueryLength: 2, limit: 20 },
  };
}

async function searchItemConnectionTargets({ itemId, editionId, query, actorUserId, limit = 20 }) {
  const { item, edition } = await loadEditionContext({ itemId, editionId, actorUserId });
  const normalized = String(query || "").trim();
  if (normalized.length < 2) return { results: [], minimumQueryLength: 2 };
  const regex = new RegExp(escapeRegex(normalized), "i");
  const safeLimit = Math.max(1, Math.min(30, Number(limit) || 20));
  const [subjects, matchingRevisions] = await Promise.all([
    Subject.find({ $or: [{ preferredLabel: regex }, { description: regex }] }).select("_id").limit(safeLimit * 3).lean(),
    ItemRevisionV2.find({ label: regex }).select("_id itemEditionId").limit(safeLimit * 3).lean(),
  ]);
  const subjectItems = await ItemV2.find({
    _id: { $ne: item._id }, ownerType: item.ownerType, ownerId: item.ownerId, lifecycleStatus: "active",
    primarySubjectId: { $in: subjects.map((entry) => entry._id) },
  }).select("_id").lean();
  const revisionEditions = await ItemEdition.find({
    _id: { $in: matchingRevisions.map((entry) => entry.itemEditionId) },
    namespaceId: edition.namespaceId,
  }).select("itemId").lean();
  const candidateItemIds = [...new Set([...subjectItems.map((entry) => id(entry)), ...revisionEditions.map((entry) => id(entry.itemId))])];
  if (!candidateItemIds.length) return { results: [], minimumQueryLength: 2 };
  const candidateItems = await ItemV2.find({
    _id: { $in: candidateItemIds, $ne: item._id },
    ownerType: item.ownerType,
    ownerId: item.ownerId,
    lifecycleStatus: "active",
  }).lean();
  const candidateEditions = await ItemEdition.find({
    itemId: { $in: candidateItems.map((entry) => entry._id) },
    namespaceId: edition.namespaceId,
  }).lean();
  const targetMap = await targetItemsBySubject({
    item,
    namespaceId: edition.namespaceId,
    subjectIds: candidateItems.map((entry) => entry.primarySubjectId),
  });
  const editionItemIds = new Set(candidateEditions.map((entry) => id(entry.itemId)));
  const results = candidateItems
    .filter((entry) => editionItemIds.has(id(entry)))
    .map((entry) => targetMap.get(id(entry.primarySubjectId)))
    .filter(Boolean)
    .sort((left, right) => String(left.title).localeCompare(String(right.title), "it"))
    .slice(0, safeLimit);
  return { results, minimumQueryLength: 2 };
}

async function ensureScope({ scopeKey, item, namespace, actorUserId }) {
  const scopes = await ownerScopes({ item, namespace });
  const requested = scopes.find((entry) => entry.key === String(scopeKey || ""));
  if (!requested) throw new AppError("Scegli l’ambito editoriale del collegamento", 400);
  if (requested.contextId) return EditorialContext.findById(requested.contextId);
  let contentSpace = requested.contentSpaceId ? await ContentSpace.findById(requested.contentSpaceId) : null;
  if (!contentSpace) {
    contentSpace = await createContentSpace({
      payload: {
        name: "Collegamenti personali",
        description: "Spazio preparato automaticamente per i collegamenti tra contenuti.",
        ownerType: item.ownerType,
        ownerId: item.ownerId,
      },
      actorUserId,
    });
  }
  let context = await EditorialContext.findOne({ contentSpaceId: contentSpace._id, namespaceId: namespace._id, lifecycleStatus: "active" });
  if (!context) {
    context = await EditorialContext.findOneAndUpdate({
      contentSpaceId: contentSpace._id,
      namespaceId: namespace._id,
      lifecycleStatus: "trashed",
    }, {
      $set: {
        lifecycleStatus: "active",
        trashedAt: null,
        trashedBy: null,
        workingGraphRevisionId: null,
        publishedReleaseId: null,
      },
    }, { new: true });
  }
  if (!context) {
    context = await EditorialContext.findOne({ contentSpaceId: contentSpace._id, namespaceId: namespace._id, lifecycleStatus: "active" });
  }
  if (!context) {
    try {
      const created = await createEditorialContext({
        payload: {
          contentSpaceId: contentSpace._id,
          namespaceId: namespace._id,
          displayName: `${namespace.name} · Collegamenti`,
          shortDescription: "Collegamenti semantici tra contenuti.",
        },
        actorUserId,
      });
      context = await EditorialContext.findById(created.id);
    } catch (error) {
      if (error?.status !== 409 && error?.code !== 11000) throw error;
      context = await EditorialContext.findOne({ contentSpaceId: contentSpace._id, namespaceId: namespace._id, lifecycleStatus: "active" });
      if (!context) throw error;
    }
  }
  return context;
}

function upsertBinding(bindings, subjectId, classDefinitionId) {
  let binding = bindings.find((entry) => sameId(entry.subjectId, subjectId));
  if (!binding) {
    binding = { subjectId, subjectClassDefinitionIds: [] };
    bindings.push(binding);
  }
  if (classDefinitionId && !binding.subjectClassDefinitionIds.some((entry) => String(entry) === String(classDefinitionId))) {
    binding.subjectClassDefinitionIds.push(classDefinitionId);
  }
}

function resolveClass({ allowed, requested, existing, role }) {
  const allowedIds = (allowed || []).map(String);
  if (!allowedIds.length) return null;
  if (requested) {
    if (!allowedIds.includes(String(requested))) throw new AppError(`Il tipo scelto per il contenuto ${role} non è compatibile con la relazione`, 400);
    return String(requested);
  }
  const alreadyCompatible = (existing || []).find((entry) => allowedIds.includes(String(entry)));
  if (alreadyCompatible) return String(alreadyCompatible);
  if (allowedIds.length === 1) return allowedIds[0];
  throw new AppError(`Scegli il tipo del contenuto ${role}`, 400, [{ code: role === "di partenza" ? "SOURCE_CLASS_REQUIRED" : "TARGET_CLASS_REQUIRED" }]);
}

async function createItemConnectionAttempt({ itemId, editionId, payload, actorUserId }) {
  const { item, edition, namespace, namespaceRevision } = await loadEditionContext({ itemId, editionId, actorUserId });
  if (!mongoose.isValidObjectId(payload?.targetItemId)) throw new AppError("Scegli il contenuto da collegare", 400);
  const relation = (namespaceRevision.relationTypes || []).find((entry) => String(entry.definitionId) === String(payload?.relationTypeDefinitionId || ""));
  if (!relation) throw new AppError("Scegli una relazione prevista dalle regole editoriali", 400);
  const targetItem = await ItemV2.findOne({
    _id: payload.targetItemId,
    ownerType: item.ownerType,
    ownerId: item.ownerId,
    lifecycleStatus: "active",
  });
  if (!targetItem || sameId(targetItem._id, item._id)) throw new AppError("Il contenuto da collegare non è disponibile nel tuo account", 404);
  const targetEdition = await ItemEdition.findOne({ itemId: targetItem._id, namespaceId: edition.namespaceId });
  if (!targetEdition) throw new AppError("Il contenuto scelto non usa queste regole editoriali", 409);
  const context = await ensureScope({ scopeKey: payload?.scopeKey, item, namespace, actorUserId });
  const graph = await effectiveGraph(context);
  const snapshot = writableGraph(graph);
  const sourceSubjectId = item.primarySubjectId;
  const targetSubjectId = targetItem.primarySubjectId;
  if (sameId(sourceSubjectId, targetSubjectId)) throw new AppError("Scegli un contenuto che parli di un soggetto diverso", 409);
  const duplicate = snapshot.edges.some((edge) => sameId(edge.sourceSubjectId, sourceSubjectId)
    && sameId(edge.targetSubjectId, targetSubjectId)
    && String(edge.relationTypeDefinitionId) === String(relation.definitionId));
  if (duplicate) throw new AppError("Questo collegamento è già presente", 409);
  if (relation.validationRules?.allowMultiple === false && snapshot.edges.some((edge) => sameId(edge.sourceSubjectId, sourceSubjectId)
    && String(edge.relationTypeDefinitionId) === String(relation.definitionId))) {
    throw new AppError(`La relazione “${relation.label}” consente un solo contenuto collegato`, 409);
  }
  const existingSourceClasses = snapshot.subjectBindings.find((entry) => sameId(entry.subjectId, sourceSubjectId))?.subjectClassDefinitionIds || [];
  const existingTargetClasses = snapshot.subjectBindings.find((entry) => sameId(entry.subjectId, targetSubjectId))?.subjectClassDefinitionIds || [];
  const sourceClass = resolveClass({ allowed: relation.domainDefinitionIds, requested: payload?.sourceSubjectClassDefinitionId, existing: existingSourceClasses, role: "di partenza" });
  const targetClass = resolveClass({ allowed: relation.rangeDefinitionIds, requested: payload?.targetSubjectClassDefinitionId, existing: existingTargetClasses, role: "collegato" });
  upsertBinding(snapshot.subjectBindings, sourceSubjectId, sourceClass);
  upsertBinding(snapshot.subjectBindings, targetSubjectId, targetClass);
  const weight = payload?.weight === undefined || payload?.weight === "" ? 5 : Number(payload.weight);
  const origin = String(payload?.provenanceOrigin || "human");
  const note = String(payload?.note || "").trim();
  snapshot.edges.push({
    sourceSubjectId,
    targetSubjectId,
    relationTypeDefinitionId: relation.definitionId,
    weight,
    metadata: note ? { note } : null,
    provenance: { origin },
  });
  await Promise.all([
    ContentSpaceMembership.updateOne(
      { contentSpaceId: context.contentSpaceId, itemId: item._id },
      { $setOnInsert: { addedBy: actorUserId } },
      { upsert: true },
    ),
    ContentSpaceMembership.updateOne(
      { contentSpaceId: context.contentSpaceId, itemId: targetItem._id },
      { $setOnInsert: { addedBy: actorUserId } },
      { upsert: true },
    ),
  ]);
  await createGraphRevision({
    editorialContextId: context._id,
    actorUserId,
    payload: {
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      basedOnRevisionId: snapshot.basedOnRevisionId,
      subjectBindings: snapshot.subjectBindings,
      edges: snapshot.edges,
    },
  });
  return getItemConnectionAuthoring({ itemId, editionId, actorUserId });
}

async function createItemConnection({ itemId, editionId, payload, actorUserId }) {
  const issues = validateItemConnectionPayload(payload || {});
  if (issues.length) throw new AppError("Dati del collegamento non validi", 400, issues);
  const normalized = normalizeItemConnectionPayload(payload);
  let lastError;
  for (let attempt = 1; attempt <= MAX_GRAPH_WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await createItemConnectionAttempt({ itemId, editionId, payload: normalized, actorUserId });
    } catch (error) {
      lastError = error;
      if (!isGraphWriteConflict(error) || attempt === MAX_GRAPH_WRITE_ATTEMPTS) throw error;
    }
  }
  throw lastError;
}

async function removeItemConnectionAttempt({ itemId, editionId, connectionId, contextId, actorUserId }) {
  const { item, edition, namespace, namespaceRevision } = await loadEditionContext({ itemId, editionId, actorUserId });
  const scopes = await ownerScopes({ item, namespace });
  const scope = scopes.find((entry) => sameId(entry.contextId, contextId));
  if (!scope || !mongoose.isValidObjectId(connectionId)) throw new AppError("Collegamento non disponibile", 404);
  const context = await EditorialContext.findById(scope.contextId);
  const graph = await effectiveGraph(context);
  if (!graph) throw new AppError("Collegamento non disponibile", 404);
  const edge = graph.authoritativeEdges.find((entry) => sameId(entry._id, connectionId) && sameId(entry.sourceSubjectId, item.primarySubjectId));
  if (!edge) throw new AppError("Collegamento non disponibile", 404);
  const snapshot = writableGraph(graph);
  snapshot.edges = snapshot.edges.filter((entry) => !(sameId(entry.sourceSubjectId, edge.sourceSubjectId)
    && sameId(entry.targetSubjectId, edge.targetSubjectId)
    && String(entry.relationTypeDefinitionId) === String(edge.relationTypeDefinitionId)));
  await createGraphRevision({
    editorialContextId: context._id,
    actorUserId,
    payload: {
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      basedOnRevisionId: snapshot.basedOnRevisionId,
      subjectBindings: snapshot.subjectBindings,
      edges: snapshot.edges,
    },
  });
  return getItemConnectionAuthoring({ itemId, editionId, actorUserId });
}

async function removeItemConnection(args) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_GRAPH_WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await removeItemConnectionAttempt(args);
    } catch (error) {
      lastError = error;
      if (!isGraphWriteConflict(error) || attempt === MAX_GRAPH_WRITE_ATTEMPTS) throw error;
    }
  }
  throw lastError;
}

module.exports = {
  getItemConnectionAuthoring,
  searchItemConnectionTargets,
  createItemConnection,
  removeItemConnection,
};
