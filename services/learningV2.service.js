const Subject = require("../models/subject.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const VenueTarget = require("../models/venueTarget.model");
const UserSubjectAffinity = require("../models/userSubjectAffinity.model");
const UserSubjectKnowledge = require("../models/userSubjectKnowledge.model");
const UserItemEditionAffinity = require("../models/userItemEditionAffinity.model");
const UserContentExposureV2 = require("../models/userContentExposureV2.model");
const UserNamespaceFeatureAffinity = require("../models/userNamespaceFeatureAffinity.model");
const VenueTargetObservationProfile = require("../models/venueTargetObservationProfile.model");
const AppError = require("../utils/AppError");
const policy = require("../config/adaptivePolicy");
const { clamp, computePhysicalObservationReliability } = require("./adaptiveLearning.service");
const { updateContributor, aggregate, removeContributor } = require("./collectiveLearning.service");

const NAMESPACE_FEATURE_GROUPS = Object.freeze({
  subject_class: "subjectClasses",
  relation_type: "relationTypes",
  presentation_aspect: "presentationAspects",
  selection_signal: "selectionSignals",
});

function confidenceForCount(count) {
  return Math.min(policy.confidence.maximum, 1 - Math.exp(-Math.max(0, count) / 5));
}

function recencyWeight(date, now = new Date()) {
  if (!date) return 1;
  const ageDays = Math.max(0, (now.getTime() - new Date(date).getTime()) / 86400000);
  return Math.pow(0.5, ageDays / policy.interests.recencyHalfLifeDays);
}

function effectiveAffinity(record, now = new Date()) {
  return clamp(Number(record?.value) || 0, -1, 1)
    * clamp(Number(record?.confidence) || 0, 0, 1)
    * recencyWeight(record?.lastObservedAt, now);
}

async function assertSubject(subjectId) {
  if (!await Subject.exists({ _id: subjectId })) throw new AppError("Subject non trovato", 404);
}

async function assertEdition(itemEditionId) {
  const edition = await ItemEdition.findById(itemEditionId).lean();
  if (!edition) throw new AppError("ItemEdition non trovata", 404);
  const item = await ItemV2.findById(edition.itemId).lean();
  if (!item) throw new AppError("Item della Edition non trovato", 409);
  return { edition, item };
}

async function resolveNamespaceFeature({ namespaceId, namespaceRevisionId = null, kind, definitionId }) {
  const group = NAMESPACE_FEATURE_GROUPS[kind];
  if (!group) throw new AppError("Namespace feature kind non valido", 400, [{ field: "kind", code: "INVALID_ENUM", allowedValues: Object.keys(NAMESPACE_FEATURE_GROUPS) }]);
  const namespace = await Namespace.findById(namespaceId).lean();
  if (!namespace) throw new AppError("Namespace non trovato", 404);
  const revisionId = namespaceRevisionId || namespace.publishedRevisionId || namespace.workingRevisionId;
  if (!revisionId) throw new AppError("Namespace senza revisione utilizzabile", 409);
  const revision = await NamespaceRevision.findOne({ _id: revisionId, namespaceId }).lean();
  if (!revision) throw new AppError("NamespaceRevision non trovata", 404);
  const definition = (revision[group] || []).find((entry) => entry.definitionId === definitionId);
  if (!definition) throw new AppError("Definition non presente nella NamespaceRevision", 409, [{ field: "definitionId", code: "UNKNOWN_DEFINITION_ID", context: { kind, definitionId, namespaceRevisionId: revision._id } }]);
  return { namespace, revision, definition };
}

async function updateSignedAffinity({ Model, filter, identity, evidence, now = new Date() }) {
  const current = await Model.findOne(filter).lean();
  const count = (Number(current?.sampleCount) || 0) + 1;
  const alpha = Math.min(0.5, 1 / Math.sqrt(count + 1));
  const previous = Number(current?.value) || 0;
  const value = clamp(previous * (1 - alpha) + clamp(Number(evidence) || 0, -1, 1) * alpha, -1, 1);
  return Model.findOneAndUpdate(
    filter,
    { $set: { ...identity, value, confidence: confidenceForCount(count), sampleCount: count, lastObservedAt: now } },
    { upsert: true, new: true, runValidators: true },
  );
}

async function upsertSubjectAffinity({ userId, subjectId, evidence, now = new Date() }) {
  await assertSubject(subjectId);
  return updateSignedAffinity({
    Model: UserSubjectAffinity,
    filter: { userId, subjectId },
    identity: { userId, subjectId },
    evidence,
    now,
  });
}

async function upsertSubjectKnowledge({ userId, subjectId, level, confidence = 1, source = "interaction", now = new Date() }) {
  await assertSubject(subjectId);
  if (!Number.isFinite(Number(level))) throw new AppError("Knowledge level non valido", 400);
  const current = await UserSubjectKnowledge.findOne({ userId, subjectId }).lean();
  const count = (Number(current?.sampleCount) || 0) + 1;
  const previous = Number.isFinite(Number(current?.level)) ? Number(current.level) : Number(level);
  const alpha = source === "explicit" ? 1 : Math.min(0.4, 1 / Math.sqrt(count + 1));
  const next = clamp(previous * (1 - alpha) + clamp(Number(level), 0, 1) * alpha, 0, 1);
  return UserSubjectKnowledge.findOneAndUpdate(
    { userId, subjectId },
    { $set: { userId, subjectId, level: next, confidence: clamp(Number(confidence) || 0, 0, 1), sampleCount: count, lastObservedAt: now, source } },
    { upsert: true, new: true, runValidators: true },
  );
}

async function upsertItemEditionAffinity({ userId, itemEditionId, evidence, now = new Date() }) {
  await assertEdition(itemEditionId);
  return updateSignedAffinity({
    Model: UserItemEditionAffinity,
    filter: { userId, itemEditionId },
    identity: { userId, itemEditionId },
    evidence,
    now,
  });
}

async function upsertNamespaceFeatureAffinity({ userId, namespaceId, namespaceRevisionId = null, kind, definitionId, evidence, now = new Date() }) {
  await resolveNamespaceFeature({ namespaceId, namespaceRevisionId, kind, definitionId });
  return updateSignedAffinity({
    Model: UserNamespaceFeatureAffinity,
    filter: { userId, namespaceId, kind, definitionId },
    identity: { userId, namespaceId, kind, definitionId },
    evidence,
    now,
  });
}

async function recordContentExposure({
  userId,
  itemEditionId,
  itemRevisionId,
  variantId,
  representationId,
  completionRatio = 1,
  now = new Date(),
}) {
  await assertEdition(itemEditionId);
  const revision = await ItemRevisionV2.findOne({ _id: itemRevisionId, itemEditionId }).lean();
  if (!revision) throw new AppError("ItemRevision non appartiene alla ItemEdition", 409);
  const variant = (revision.presentationVariants || []).find((entry) => String(entry._id) === String(variantId));
  if (!variant) throw new AppError("PresentationVariant non presente nella ItemRevision", 409);
  const representation = (variant.representations || []).find((entry) => String(entry._id) === String(representationId));
  if (!representation) throw new AppError("Representation non presente nella PresentationVariant", 409);
  const filter = { userId, itemEditionId, variantId, representationId };
  const current = await UserContentExposureV2.findOne(filter).lean();
  const count = (Number(current?.exposureCount) || 0) + 1;
  const completion = clamp(Number(completionRatio) || 0, 0, 1);
  const completionEma = count === 1 ? completion : (Number(current?.completionEma) || 0) * 0.7 + completion * 0.3;
  return UserContentExposureV2.findOneAndUpdate(
    filter,
    { $set: { ...filter, lastItemRevisionId: itemRevisionId, exposureCount: count, completionEma, lastExposedAt: now } },
    { upsert: true, new: true, runValidators: true },
  );
}

function candidateNovelty(state, { itemEditionId, variantId, representationId }) {
  const records = state?.exposuresByEdition?.get(String(itemEditionId)) || [];
  if (!records.length) return { score: 1, reason: "new_edition" };
  const sameVariant = records.filter((entry) => String(entry.variantId) === String(variantId));
  if (!sameVariant.length) return { score: 0.7, reason: "new_variant" };
  const exact = sameVariant.find((entry) => String(entry.representationId) === String(representationId));
  if (!exact) return { score: 0.3, reason: "new_representation" };
  return { score: 0.05, reason: "familiar_content" };
}

async function recordVenueTargetObservation({ userId, venueTargetId, observedSeconds, reliability = null }) {
  const target = await VenueTarget.findById(venueTargetId).lean();
  if (!target) throw new AppError("VenueTarget non trovato", 404);
  const effectiveReliability = reliability == null
    ? computePhysicalObservationReliability({ observedSeconds: Number(observedSeconds) })
    : clamp(Number(reliability) || 0, 0, 1);
  if (effectiveReliability < policy.learning.minimumReliability) {
    return { accepted: false, profile: await VenueTargetObservationProfile.findOne({ venueTargetId }) };
  }
  const metricType = "venue_target_observation_seconds";
  const scopeKey = `venue_target:${String(venueTargetId)}`;
  await updateContributor({
    userId,
    metricType,
    scopeKey,
    value: Number(observedSeconds),
    sampleCount: 1,
    reliability: effectiveReliability,
  });
  const summary = await aggregate(metricType, scopeKey);
  if (!Number.isFinite(summary.value)) return { accepted: false, profile: null };
  const observationFactor = clamp(summary.value / policy.coldStart.observationSeconds, 0.1, 10);
  const profile = await VenueTargetObservationProfile.findOneAndUpdate(
    { venueTargetId },
    { $set: {
      venueTargetId,
      observationFactor,
      typicalObservationSeconds: summary.value,
      confidence: summary.confidence,
      sampleCount: summary.sampleCount,
      contributorCount: summary.contributorCount,
      updatedAt: summary.updatedAt,
    } },
    { upsert: true, new: true, runValidators: true },
  );
  return { accepted: true, profile };
}

async function loadUserLearningState({ userId, subjectIds = [], itemEditionIds = [], namespaceIds = [] }) {
  const [subjectAffinities, subjectKnowledge, editionAffinities, exposures, namespaceFeatureAffinities] = await Promise.all([
    subjectIds.length ? UserSubjectAffinity.find({ userId, subjectId: { $in: subjectIds } }).lean() : [],
    subjectIds.length ? UserSubjectKnowledge.find({ userId, subjectId: { $in: subjectIds } }).lean() : [],
    itemEditionIds.length ? UserItemEditionAffinity.find({ userId, itemEditionId: { $in: itemEditionIds } }).lean() : [],
    itemEditionIds.length ? UserContentExposureV2.find({ userId, itemEditionId: { $in: itemEditionIds } }).lean() : [],
    namespaceIds.length ? UserNamespaceFeatureAffinity.find({ userId, namespaceId: { $in: namespaceIds } }).lean() : [],
  ]);
  const exposuresByEdition = new Map();
  for (const record of exposures) {
    const key = String(record.itemEditionId);
    if (!exposuresByEdition.has(key)) exposuresByEdition.set(key, []);
    exposuresByEdition.get(key).push(record);
  }
  return {
    subjectAffinities,
    subjectAffinityById: new Map(subjectAffinities.map((record) => [String(record.subjectId), record])),
    subjectKnowledge,
    subjectKnowledgeById: new Map(subjectKnowledge.map((record) => [String(record.subjectId), record])),
    editionAffinities,
    editionAffinityById: new Map(editionAffinities.map((record) => [String(record.itemEditionId), record])),
    exposures,
    exposuresByEdition,
    namespaceFeatureAffinities,
    namespaceFeatureAffinityByKey: new Map(namespaceFeatureAffinities.map((record) => [`${record.namespaceId}:${record.kind}:${record.definitionId}`, record])),
  };
}

async function removeUserLearningV2(userId) {
  const [subjectAffinities, subjectKnowledge, editionAffinities, exposures, namespaceFeatures] = await Promise.all([
    UserSubjectAffinity.deleteMany({ userId }),
    UserSubjectKnowledge.deleteMany({ userId }),
    UserItemEditionAffinity.deleteMany({ userId }),
    UserContentExposureV2.deleteMany({ userId }),
    UserNamespaceFeatureAffinity.deleteMany({ userId }),
  ]);
  await removeContributor(userId);
  return { subjectAffinities, subjectKnowledge, editionAffinities, exposures, namespaceFeatures };
}

module.exports = {
  NAMESPACE_FEATURE_GROUPS,
  confidenceForCount,
  recencyWeight,
  effectiveAffinity,
  upsertSubjectAffinity,
  upsertSubjectKnowledge,
  upsertItemEditionAffinity,
  upsertNamespaceFeatureAffinity,
  recordContentExposure,
  candidateNovelty,
  recordVenueTargetObservation,
  loadUserLearningState,
  removeUserLearningV2,
};
