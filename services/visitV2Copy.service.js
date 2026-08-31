const mongoose = require("mongoose");

function plain(value) { return value?.toObject ? value.toObject() : (value || {}); }
function oid() { return new mongoose.Types.ObjectId(); }
function id(value) { return String(value?._id || value || ""); }

function cloneDetachedVisitRevision(sourceRevision, { title = null } = {}) {
  const source = plain(sourceRevision);
  const sourceMap = new Map();
  const anchorMap = new Map();

  const contentSources = (source.contentSources || []).map((entry) => {
    const nextId = oid();
    sourceMap.set(id(entry._id), nextId);
    return {
      _id: nextId,
      sourceType: entry.sourceType,
      editorialReleaseId: entry.editorialReleaseId || null,
      itemRevisionId: entry.itemRevisionId || null,
    };
  });

  const editorialSources = (source.editorialSources || []).map((entry) => {
    const nextId = oid();
    sourceMap.set(id(entry._id), nextId);
    return { _id: nextId, editorialReleaseId: entry.editorialReleaseId };
  });

  const visitAnchors = (source.visitAnchors || []).map((anchor) => {
    const nextId = oid();
    anchorMap.set(id(anchor._id), nextId);
    return { _id: nextId, venueTargetId: anchor.venueTargetId };
  });

  const contentEntries = (source.contentEntries || []).map((entry) => ({
    _id: oid(),
    contentSourceId: entry.contentSourceId ? sourceMap.get(id(entry.contentSourceId)) : null,
    editorialSourceId: entry.editorialSourceId ? sourceMap.get(id(entry.editorialSourceId)) : null,
    itemId: entry.itemId,
    itemEditionId: entry.itemEditionId,
    itemRevisionId: entry.itemRevisionId,
    deliveryAnchorId: entry.deliveryAnchorId ? anchorMap.get(id(entry.deliveryAnchorId)) || null : null,
    role: entry.role || "recommended",
  }));

  const routeHints = (source.logistics?.routeHints || []).map((hint) => ({
    _id: oid(),
    fromAnchorId: anchorMap.get(id(hint.fromAnchorId)),
    toAnchorId: anchorMap.get(id(hint.toAnchorId)),
    type: hint.type,
    instructionOverride: hint.instructionOverride || null,
    note: hint.note || null,
    estimatedTransferSeconds: hint.estimatedTransferSeconds ?? null,
  }));

  return {
    title: title || source.title,
    description: source.description || null,
    contentSources,
    editorialSources,
    contentEntries,
    visitAnchors,
    deliveryMode: source.deliveryMode || "self_guided",
    synchronization: {
      joinAlias: source.synchronization?.joinAlias || null,
    },
    quiz: {
      questions: (source.quiz?.questions || []).map((question) => ({
        _id: oid(),
        question: question.question || "",
        options: [...(question.options || [])],
        correctOptionIndex: Number(question.correctOptionIndex) || 0,
        points: question.points ?? null,
      })),
    },
    presentationBaseline: source.presentationBaseline || null,
    logistics: {
      preVisitNotes: [...(source.logistics?.preVisitNotes || [])],
      routeHints,
    },
  };
}

module.exports = { cloneDetachedVisitRevision };
