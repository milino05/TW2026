const mongoose = require("mongoose");
const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const ItemV2 = require("../models/itemV2.model");
const AppError = require("../utils/AppError");
const { assertCanReferenceItemInEditorialSpace } = require("./itemUsageAuthorization.service");
const { loadAuthoringContext } = require("./editorialGraphCommand.service");
const {
  validateSemanticGraphSnapshot,
  writeSemanticGraphSnapshot,
} = require("./semanticGraphSnapshotWriter.service");
const { loadSemanticGraphRevision } = require("./semanticGraphV2.service");

function id(value) {
  return String(value?._id || value || "");
}

function sameId(left, right) {
  return id(left) === id(right);
}

function assertObjectId(value, field) {
  if (!mongoose.isValidObjectId(value)) {
    throw new AppError(`${field} non valido`, 400, [{ field, code: "INVALID_OBJECT_ID" }]);
  }
}

function normalizeWeight(value) {
  const weight = value === undefined ? 1 : Number(value);
  if (!Number.isFinite(weight) || weight < 0 || weight > 10) {
    throw new AppError("Peso della relazione non valido", 400, [{ field: "weight", code: "OUT_OF_RANGE" }]);
  }
  return weight;
}

function normalizeClassAssignments(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AppError("subjectClassAssignments deve essere un array", 400, [{
      field: "subjectClassAssignments",
      code: "INVALID_TYPE",
    }]);
  }
  const seen = new Set();
  return value.map((entry, index) => {
    const subjectId = entry?.subjectId;
    assertObjectId(subjectId, `subjectClassAssignments[${index}].subjectId`);
    const key = id(subjectId);
    if (seen.has(key)) {
      throw new AppError("Classificazione duplicata per Subject", 400, [{
        field: `subjectClassAssignments[${index}].subjectId`,
        code: "DUPLICATE",
      }]);
    }
    if (!Array.isArray(entry?.subjectClassDefinitionIds)) {
      throw new AppError("subjectClassDefinitionIds deve essere un array", 400, [{
        field: `subjectClassAssignments[${index}].subjectClassDefinitionIds`,
        code: "INVALID_TYPE",
      }]);
    }
    seen.add(key);
    return {
      subjectId,
      subjectClassDefinitionIds: [...new Set(entry.subjectClassDefinitionIds
        .map((definitionId) => String(definitionId || "").trim())
        .filter(Boolean))],
    };
  });
}

function ensureBinding(snapshot, subjectId) {
  const existing = snapshot.subjectBindings.find((binding) => sameId(binding.subjectId, subjectId));
  if (existing) return existing;
  const binding = { subjectId, subjectClassDefinitionIds: [] };
  snapshot.subjectBindings.push(binding);
  return binding;
}

function applyClassAssignments(snapshot, assignments) {
  for (const assignment of assignments) {
    const binding = ensureBinding(snapshot, assignment.subjectId);
    binding.subjectClassDefinitionIds = assignment.subjectClassDefinitionIds;
  }
}

async function collectionSubjectIds(editorialContextId, session) {
  const memberships = await CollectionItemMembership.find({ editorialContextId })
    .select("itemId")
    .session(session)
    .lean();
  if (!memberships.length) return new Set();
  const items = await ItemV2.find({
    _id: { $in: memberships.map((entry) => entry.itemId) },
    lifecycleStatus: "active",
  }).select("primarySubjectId").session(session).lean();
  return new Set(items.map((entry) => id(entry.primarySubjectId)).filter(Boolean));
}

async function itemCandidatesForSubject({ context, subjectId, session }) {
  const items = await ItemV2.find({ primarySubjectId: subjectId, lifecycleStatus: "active" })
    .select("_id primarySubjectId")
    .session(session)
    .lean();
  if (!items.length) return [];
  const memberships = await ContentSpaceItemMembership.find({
    contentSpaceId: context.contentSpaceId,
    itemId: { $in: items.map((item) => item._id) },
  }).select("itemId").session(session).lean();
  const allowed = new Set(memberships.map((entry) => id(entry.itemId)));
  return items.filter((item) => allowed.has(id(item._id)));
}

async function resolveTargetItem({ state, context, targetSubjectId, targetItemId, actorUserId, session }) {
  const candidates = await itemCandidatesForSubject({ context, subjectId: targetSubjectId, session });
  if (!candidates.length) {
    throw new AppError("Il Subject selezionato non ha contenuti utilizzabili nello Spazio editoriale", 409, [{
      field: "targetSubjectId",
      code: "COLLECTION_GRAPH_TARGET_CONTENT_REQUIRED",
      context: { subjectId: targetSubjectId },
    }]);
  }

  let selected = null;
  if (targetItemId) {
    assertObjectId(targetItemId, "targetItemId");
    selected = candidates.find((item) => sameId(item._id, targetItemId)) || null;
    if (!selected) {
      throw new AppError("Il contenuto scelto non rappresenta il Subject o non appartiene allo Spazio editoriale", 409, [{
        field: "targetItemId",
        code: "COLLECTION_GRAPH_TARGET_ITEM_INVALID",
        context: { subjectId: targetSubjectId, itemId: targetItemId },
      }]);
    }
  } else if (candidates.length === 1) {
    [selected] = candidates;
  } else {
    throw new AppError("Scegli quale contenuto aggiungere alla Raccolta per questo Subject", 409, [{
      field: "targetItemId",
      code: "COLLECTION_GRAPH_TARGET_ITEM_SELECTION_REQUIRED",
      context: {
        subjectId: targetSubjectId,
        itemIds: candidates.map((item) => item._id),
      },
    }]);
  }

  await assertCanReferenceItemInEditorialSpace({
    itemId: selected._id,
    actorUserId,
    principalType: state.contentSpace.ownerType,
    principalId: state.contentSpace.ownerId,
  });
  return selected;
}

async function addCollectionGraphEdge({ editorialContextId, payload, actorUserId }) {
  const sourceSubjectId = payload?.sourceSubjectId;
  const targetSubjectId = payload?.targetSubjectId;
  const relationTypeDefinitionId = String(payload?.relationTypeDefinitionId || "").trim();
  assertObjectId(sourceSubjectId, "sourceSubjectId");
  assertObjectId(targetSubjectId, "targetSubjectId");
  if (!relationTypeDefinitionId) {
    throw new AppError("Tipo di relazione obbligatorio", 400, [{
      field: "relationTypeDefinitionId",
      code: "REQUIRED",
    }]);
  }
  if (sameId(sourceSubjectId, targetSubjectId)) {
    throw new AppError("Una relazione deve collegare due Subject distinti", 400, [{ code: "SELF_RELATION_NOT_ALLOWED" }]);
  }

  const state = await loadAuthoringContext({ editorialContextId, actorUserId });
  if (state.snapshot.edges.some((edge) => (
    sameId(edge.sourceSubjectId, sourceSubjectId)
    && sameId(edge.targetSubjectId, targetSubjectId)
    && String(edge.relationTypeDefinitionId) === relationTypeDefinitionId
  ))) {
    throw new AppError("Questa relazione esiste già", 409, [{ code: "SEMANTIC_EDGE_EXISTS" }]);
  }

  ensureBinding(state.snapshot, sourceSubjectId);
  ensureBinding(state.snapshot, targetSubjectId);
  applyClassAssignments(state.snapshot, normalizeClassAssignments(payload?.subjectClassAssignments));
  state.snapshot.edges.push({
    sourceSubjectId,
    targetSubjectId,
    relationTypeDefinitionId,
    weight: normalizeWeight(payload?.weight),
    metadata: payload?.metadata ?? null,
    provenance: { origin: "human" },
  });

  // Department MongoDB runs standalone, so the unit-of-work fallback cannot roll
  // back earlier writes. Validate the complete graph mutation before touching
  // Collection membership or workingVersion; the writer validates again at commit.
  const graphIssues = await validateSemanticGraphSnapshot({
    snapshot: state.snapshot,
    namespaceRevision: state.namespaceRevision,
  });
  if (graphIssues.length) {
    throw new AppError("Il grafo non rispetta le regole editoriali", 409, graphIssues);
  }

  const expectedContextVersion = Number(state.context.workingVersion || 0);
  let revisionId = null;
  try {
    await mongoose.connection.transaction(async (session) => {
      const context = await EditorialContext.findOne({
        _id: state.context._id,
        lifecycleStatus: "active",
        semanticGraphId: state.semanticGraph._id,
      }).session(session);
      if (!context) throw new AppError("Raccolta editoriale non trovata", 404);

      let allowedSubjects = await collectionSubjectIds(context._id, session);
      if (!allowedSubjects.has(id(sourceSubjectId))) {
        throw new AppError("Il Subject di partenza non è più rappresentato dai contenuti della Raccolta", 409, [{
          field: "sourceSubjectId",
          code: "GRAPH_SUBJECT_WITHOUT_COLLECTION_CONTENT",
          context: { subjectId: sourceSubjectId },
        }]);
      }

      const targetAlreadyBacked = allowedSubjects.has(id(targetSubjectId));
      if (!targetAlreadyBacked) {
        if (context.activeReviewRevisionId) {
          throw new AppError("La Raccolta è in revisione: ritira la richiesta prima di modificarne i contenuti", 409, [{
            code: "EDITORIAL_CONTEXT_REVIEW_LOCKED",
          }]);
        }
        const targetItem = await resolveTargetItem({
          state,
          context,
          targetSubjectId,
          targetItemId: payload?.targetItemId || null,
          actorUserId,
          session,
        });
        await ContentSpaceSubjectMembership.findOneAndUpdate(
          { contentSpaceId: context.contentSpaceId, subjectId: targetSubjectId },
          { $setOnInsert: { contentSpaceId: context.contentSpaceId, subjectId: targetSubjectId, addedBy: actorUserId } },
          { upsert: true, new: true, session },
        );
        await CollectionItemMembership.create([{
          editorialContextId: context._id,
          itemId: targetItem._id,
          curationSignals: [],
          addedBy: actorUserId,
          updatedBy: actorUserId,
        }], { session });
        const contextPointer = await EditorialContext.updateOne({
          _id: context._id,
          lifecycleStatus: "active",
          activeReviewRevisionId: null,
          workingVersion: expectedContextVersion,
        }, { $inc: { workingVersion: 1 } }, { session });
        if (contextPointer.modifiedCount !== 1) {
          throw new AppError("La Raccolta è stata modificata da un'altra operazione", 409, [{
            code: "EDITORIAL_CONTEXT_WORKING_CONFLICT",
          }]);
        }
        allowedSubjects = new Set([...allowedSubjects, id(targetSubjectId)]);
      }

      const unsupported = state.snapshot.subjectBindings
        .map((binding) => id(binding.subjectId))
        .filter((subjectId) => !allowedSubjects.has(subjectId));
      if (unsupported.length) {
        throw new AppError("Il grafo non rispetta i contenuti della Raccolta", 409, unsupported.map((subjectId) => ({
          field: "subjectId",
          code: "GRAPH_SUBJECT_WITHOUT_COLLECTION_CONTENT",
          context: { subjectId },
        })));
      }

      const revision = await writeSemanticGraphSnapshot({
        semanticGraph: state.semanticGraph,
        namespaceRevision: state.namespaceRevision,
        snapshot: state.snapshot,
        actorUserId,
        session,
      });
      revisionId = revision._id;
    });
  } catch (error) {
    if (error?.code === 11000) {
      throw new AppError("Il contenuto è già entrato nella Raccolta durante questa operazione: riprova", 409, [{
        code: "COLLECTION_ITEM_MEMBERSHIP_CONFLICT",
      }]);
    }
    throw error;
  }

  return loadSemanticGraphRevision(revisionId, { bypassCache: true });
}

module.exports = {
  addCollectionGraphEdge,
};
