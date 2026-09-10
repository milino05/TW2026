const mongoose = require("mongoose");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const Subject = require("../models/subject.model");
const AppError = require("../utils/AppError");
const { validateGraphSnapshotAgainstNamespace } = require("./semanticGraphV2.service");

function id(value) {
  return String(value?._id || value || "");
}

function graphConflict() {
  return new AppError("Il grafo semantico è stato modificato da un'altra operazione", 409, [{
    code: "SEMANTIC_GRAPH_WORKING_CONFLICT",
  }]);
}

async function validateSubjects(snapshot) {
  const values = [...new Set((snapshot.subjectBindings || []).map((entry) => id(entry.subjectId)).filter(Boolean))];
  if (!values.length) return [];
  const found = await Subject.find({ _id: { $in: values } }).select("_id").lean();
  const foundIds = new Set(found.map((entry) => id(entry._id)));
  return values
    .filter((value) => !foundIds.has(value))
    .map((value) => ({
      field: "subjectId",
      code: "SUBJECT_NOT_FOUND",
      message: `Subject non trovato: ${value}`,
    }));
}

async function validateSemanticGraphSnapshot({ snapshot, namespaceRevision = null }) {
  return [
    ...await validateSubjects(snapshot),
    ...(namespaceRevision ? validateGraphSnapshotAgainstNamespace(snapshot, namespaceRevision) : []),
  ];
}

async function nextVersion(semanticGraphId, session) {
  const latest = await SemanticGraphRevision.findOne({ semanticGraphId })
    .sort({ version: -1 })
    .select("version")
    .session(session)
    .lean();
  return (latest?.version || 0) + 1;
}

async function persistSnapshot({
  semanticGraph,
  authoredAgainstNamespaceRevisionId,
  snapshot,
  actorUserId,
  session,
  afterPersist = null,
}) {
  const expectedWorkingVersion = Number(semanticGraph.workingVersion || 0);
  const expectedGraphRevisionId = semanticGraph.workingRevisionId || null;
  const lockedGraph = await SemanticGraph.findOne({
    _id: semanticGraph._id,
    lifecycleStatus: "active",
    workingVersion: expectedWorkingVersion,
    workingRevisionId: expectedGraphRevisionId,
  }).session(session);
  if (!lockedGraph) throw graphConflict();

  const [revision] = await SemanticGraphRevision.create([{
    semanticGraphId: lockedGraph._id,
    version: await nextVersion(lockedGraph._id, session),
    basedOnRevisionId: expectedGraphRevisionId,
    authoredAgainstNamespaceRevisionId,
    createdBy: actorUserId,
  }], { session });

  if ((snapshot.subjectBindings || []).length) {
    await GraphSubjectBinding.insertMany(snapshot.subjectBindings.map((binding) => ({
      graphRevisionId: revision._id,
      subjectId: binding.subjectId,
      subjectClassDefinitionIds: binding.subjectClassDefinitionIds || [],
    })), { session, ordered: true });
  }

  if ((snapshot.edges || []).length) {
    await SemanticEdgeV2.insertMany(snapshot.edges.map((edge) => ({
      graphRevisionId: revision._id,
      sourceSubjectId: edge.sourceSubjectId,
      targetSubjectId: edge.targetSubjectId,
      relationTypeDefinitionId: edge.relationTypeDefinitionId,
      weight: edge.weight,
      metadata: edge.metadata ?? null,
      provenance: edge.provenance || { origin: "human" },
    })), { session, ordered: true });
  }

  lockedGraph.workingRevisionId = revision._id;
  lockedGraph.workingVersion = expectedWorkingVersion + 1;
  await lockedGraph.save({ session });

  if (afterPersist) await afterPersist({ session, revision, semanticGraph: lockedGraph });
  return revision;
}

async function writeSemanticGraphSnapshot({
  semanticGraph,
  namespaceRevision = null,
  authoredAgainstNamespaceRevisionId = null,
  snapshot,
  actorUserId,
  session = null,
  afterPersist = null,
}) {
  const effectiveNamespaceRevisionId = namespaceRevision?._id || authoredAgainstNamespaceRevisionId;
  if (!effectiveNamespaceRevisionId) {
    throw new AppError("La revisione delle Regole editoriali è obbligatoria", 409, [{
      code: "NAMESPACE_REVISION_REQUIRED",
    }]);
  }

  const issues = await validateSemanticGraphSnapshot({ snapshot, namespaceRevision });
  if (issues.length) throw new AppError("Il grafo non rispetta le regole editoriali", 409, issues);

  const execute = (activeSession) => persistSnapshot({
    semanticGraph,
    authoredAgainstNamespaceRevisionId: effectiveNamespaceRevisionId,
    snapshot,
    actorUserId,
    session: activeSession,
    afterPersist,
  });

  if (session) return execute(session);

  let revision = null;
  await mongoose.connection.transaction(async (activeSession) => {
    revision = await execute(activeSession);
  });
  return revision;
}

module.exports = {
  validateSemanticGraphSnapshot,
  writeSemanticGraphSnapshot,
};
