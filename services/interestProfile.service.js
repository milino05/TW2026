const UserSemanticAffinity = require("../models/userSemanticAffinity.model");
const UserKnowledgeState = require("../models/userKnowledgeState.model");
const UserContentExposure = require("../models/userContentExposure.model");
const policy = require("../config/adaptivePolicy");
const { featureKey: unscopedFeatureKey } = require("./semanticGraph.service");

function clamp(value, min = 0, max = 1) { return Math.min(max, Math.max(min, value)); }
function scopedFeatureKey(feature = {}) {
  const base = unscopedFeatureKey(feature);
  if (["item_type", "relation_type", "presentation_aspect", "selection_signal", "tag"].includes(feature.kind)) return `${base}@${String(feature.museumId || "global")}`;
  return base;
}
function recencyWeight(date, now = new Date()) { if (!date) return 1; const ageDays = Math.max(0, (now.getTime() - new Date(date).getTime()) / 86400000); return Math.pow(0.5, ageDays / policy.interests.recencyHalfLifeDays); }
function effectiveAffinity(record, now = new Date()) { return clamp(Number(record?.value) || 0, -1, 1) * clamp(Number(record?.confidence) || 0) * recencyWeight(record?.lastObservedAt, now); }
function recordToFeature(record) { return { kind: record.kind, museumId: record.museumId, itemId: record.itemId, key: record.key, scheme: record.scheme, refId: record.refId }; }
async function loadUserSemanticState({ userId, museumId }) {
  const localOrGlobal = { $or: [{ museumId: null }, { museumId }] };
  const [affinities, knowledge, exposures] = await Promise.all([
    UserSemanticAffinity.find({ userId, ...localOrGlobal }).lean(),
    UserKnowledgeState.find({ userId, ...localOrGlobal }).lean(),
    UserContentExposure.find({ userId, museumId }).lean(),
  ]);
  return {
    affinities,
    affinityByKey: new Map(affinities.map((record) => [record.featureKey, record])),
    knowledge,
    knowledgeByKey: new Map(knowledge.map((record) => [record.featureKey, record])),
    exposures,
    exposuresByItem: new Map(exposures.reduce((pairs, record) => { const key = String(record.itemId); if (!pairs.has(key)) pairs.set(key, []); pairs.get(key).push(record); return pairs; }, new Map())),
  };
}
function affinityScore(state, feature, now = new Date()) { const record = state?.affinityByKey?.get(scopedFeatureKey(feature)); return record ? effectiveAffinity(record, now) : 0; }
function explicitKnowledgeMap(values = [], museumId = null) { return new Map(values.map((entry) => [scopedFeatureKey({ ...(entry.feature || {}), museumId: entry.feature?.museumId || museumId }), { level: clamp(Number(entry.level) || 0), confidence: 1, source: "current_request" }])); }
function knowledgeForFeature(state, feature, explicit = new Map()) {
  const key = scopedFeatureKey(feature);
  if (explicit.has(key)) return explicit.get(key);
  const record = state?.knowledgeByKey?.get(key);
  return record ? { level: clamp(Number(record.level) || 0), confidence: clamp(Number(record.confidence) || 0), source: "learned_history" } : { level: null, confidence: 0, source: "unknown" };
}
function candidateNovelty(state, { itemId, variantKey, semanticFeatureKeys = [], presentationAspectKeys = [], durationKey = null, languageLevelKey = null }) {
  const records = state?.exposuresByItem?.get(String(itemId)) || [];
  if (!records.length) return { score: 1, reason: "new_item" };
  const same = records.find((record) => record.variantKey === variantKey);
  if (!same) return { score: 0.72, reason: "new_variant" };
  const previousFeatures = new Set(same.semanticFeatureKeys || []), previousAspects = new Set(same.presentationAspectKeys || []);
  const novelFeatureCount = semanticFeatureKeys.filter((key) => !previousFeatures.has(key)).length, novelAspectCount = presentationAspectKeys.filter((key) => !previousAspects.has(key)).length;
  if (novelFeatureCount || novelAspectCount) return { score: 0.5, reason: "new_semantic_angle" };
  const durationNew = durationKey && !(same.durationKeys || []).includes(durationKey), languageNew = languageLevelKey && !(same.languageLevelKeys || []).includes(languageLevelKey);
  if (durationNew || languageNew) return { score: 0.25, reason: "new_representation_level" };
  return { score: 0.05, reason: "familiar_content" };
}
async function upsertAffinity({ userId, feature, evidence, now = new Date() }) {
  const featureKey = scopedFeatureKey(feature), current = await UserSemanticAffinity.findOne({ userId, featureKey }).lean(), count = (Number(current?.sampleCount) || 0) + 1, alpha = Math.min(0.5, 1 / Math.sqrt(count + 1)), value = clamp((Number(current?.value) || 0) * (1 - alpha) + clamp(Number(evidence) || 0, -1, 1) * alpha, -1, 1), confidence = Math.min(policy.confidence.maximum, 1 - Math.exp(-count / 5));
  return UserSemanticAffinity.findOneAndUpdate({ userId, featureKey }, { $set: { kind: feature.kind, museumId: feature.museumId || null, itemId: feature.itemId || null, key: feature.key || null, scheme: feature.scheme || null, refId: feature.refId || feature.id || null, value, confidence, sampleCount: count, lastObservedAt: now } }, { upsert: true, new: true, runValidators: true });
}
async function upsertKnowledge({ userId, feature, level, confidence = 1, source = "explicit", now = new Date() }) {
  const featureKey = scopedFeatureKey(feature), current = await UserKnowledgeState.findOne({ userId, featureKey }).lean(), count = (Number(current?.sampleCount) || 0) + 1;
  const previous = Number.isFinite(Number(current?.level)) ? Number(current.level) : Number(level), alpha = source === "explicit" ? 1 : Math.min(0.4, 1 / Math.sqrt(count + 1));
  const next = clamp(previous * (1 - alpha) + clamp(Number(level) || 0) * alpha);
  return UserKnowledgeState.findOneAndUpdate({ userId, featureKey }, { $set: { kind: feature.kind, museumId: feature.museumId || null, itemId: feature.itemId || null, key: feature.key || null, scheme: feature.scheme || null, refId: feature.refId || feature.id || null, level: next, confidence: clamp(confidence), sampleCount: count, lastObservedAt: now, source } }, { upsert: true, new: true, runValidators: true });
}
async function upsertExposure({ userId, museumId, itemId, itemRevisionId, variantKey, durationKey, languageLevelKey, semanticFeatureKeys = [], presentationAspectKeys = [], completionRatio = 1, now = new Date() }) {
  const current = await UserContentExposure.findOne({ userId, itemId, variantKey }).lean(), count = (Number(current?.exposureCount) || 0) + 1, previousCompletion = Number(current?.completionEma) || 0, completionEma = count === 1 ? clamp(completionRatio) : previousCompletion * 0.7 + clamp(completionRatio) * 0.3;
  return UserContentExposure.findOneAndUpdate({ userId, itemId, variantKey }, { $set: { museumId, lastItemRevisionId: itemRevisionId || null, exposureCount: count, completionEma, lastExposedAt: now }, $addToSet: { durationKeys: durationKey, languageLevelKeys: languageLevelKey, semanticFeatureKeys: { $each: semanticFeatureKeys }, presentationAspectKeys: { $each: presentationAspectKeys } } }, { upsert: true, new: true, runValidators: true });
}
module.exports = { clamp, scopedFeatureKey, recencyWeight, effectiveAffinity, recordToFeature, loadUserSemanticState, affinityScore, explicitKnowledgeMap, knowledgeForFeature, candidateNovelty, upsertAffinity, upsertKnowledge, upsertExposure };
