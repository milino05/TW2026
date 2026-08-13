const Item = require("../models/item.model");
const ItemRevision = require("../models/itemRevision.model");
const policy = require("../config/adaptivePolicy");
const { getMuseumVocabulary } = require("./museumVocabulary.service");
const { getPresentationVariants } = require("./presentationModel.service");

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function recencyWeight(date, now = new Date()) {
  if (!date) return 1;
  const ageDays = Math.max(0, (now.getTime() - new Date(date).getTime()) / 86400000);
  return Math.pow(0.5, ageDays / policy.interests.recencyHalfLifeDays);
}
function effectiveAffinity(record, now = new Date()) { return (Number(record?.value) || 0) * (Number(record?.confidence) || 0) * recencyWeight(record?.lastObservedAt, now); }
function sameRef(a, b) { return String(a?.scheme || "").toLowerCase() === String(b?.scheme || "").toLowerCase() && String(a?.id || a?.refId || "") === String(b?.id || b?.refId || ""); }
function semanticAffinityScore(profile, feature, now = new Date()) {
  const records = profile?.semanticAffinities || [];
  let best = 0;
  for (const record of records) {
    let matches = false;
    if (feature.kind === "item" && record.kind === "item" && String(feature.itemId) === String(record.itemId)) matches = true;
    if (["item_type", "relation_type"].includes(feature.kind) && record.kind === feature.kind && record.key === feature.key && (!record.museumId || !feature.museumId || String(record.museumId) === String(feature.museumId))) matches = true;
    if (feature.kind === "canonical" && record.kind === "canonical" && sameRef(feature, record)) matches = true;
    if (matches) { const score = effectiveAffinity(record, now); if (Math.abs(score) > Math.abs(best)) best = score; }
  }
  return best;
}
function aspectAffinityScore(profile, { museumId, key, semanticRefs = [] }, now = new Date()) {
  let best = 0;
  for (const record of profile?.presentationAspectAffinities || []) {
    const local = record.key === key && (!record.museumId || !museumId || String(record.museumId) === String(museumId));
    const canonical = (record.semanticRefs || []).some((left) => semanticRefs.some((right) => sameRef(left, right)));
    if (local || canonical) { const score = effectiveAffinity(record, now); if (Math.abs(score) > Math.abs(best)) best = score; }
  }
  return best;
}
function updateRecord(record, evidence, now = new Date()) {
  const count = (Number(record.sampleCount) || 0) + 1;
  const alpha = Math.min(0.5, 1 / Math.sqrt(count + 1));
  record.value = clamp((Number(record.value) || 0) * (1 - alpha) + clamp(evidence, -1, 1) * alpha, -1, 1);
  record.sampleCount = count;
  record.confidence = Math.min(policy.confidence.maximum, 1 - Math.exp(-count / 5));
  record.lastObservedAt = now;
}
function affinityIdentity(feature) {
  if (feature.kind === "item") return `item:${feature.itemId}`;
  if (feature.kind === "canonical") return `canonical:${String(feature.scheme).toLowerCase()}:${feature.refId || feature.id}`;
  return `${feature.kind}:${feature.museumId || "global"}:${feature.key}`;
}
function upsertSemanticAffinity(profile, feature, evidence, now) {
  const id = affinityIdentity(feature);
  let record = (profile.semanticAffinities || []).find((entry) => affinityIdentity(entry) === id);
  if (!record) {
    profile.semanticAffinities.push({ kind: feature.kind, museumId: feature.museumId || null, itemId: feature.itemId || null, key: feature.key || null, scheme: feature.scheme || null, refId: feature.refId || feature.id || null, value: 0, confidence: 0, sampleCount: 0 });
    record = profile.semanticAffinities.at(-1);
  }
  updateRecord(record, evidence, now);
}
function upsertAspectAffinity(profile, { museumId, key, semanticRefs = [] }, evidence, now) {
  let record = (profile.presentationAspectAffinities || []).find((entry) => entry.key === key && String(entry.museumId || "") === String(museumId || ""));
  if (!record) { profile.presentationAspectAffinities.push({ museumId: museumId || null, key, semanticRefs: semanticRefs.map((ref) => ({ scheme: ref.scheme, id: ref.id })), value: 0, confidence: 0, sampleCount: 0 }); record = profile.presentationAspectAffinities.at(-1); }
  updateRecord(record, evidence, now);
}
function relationStrengthFactor(strength) { return strength === "strong" ? 0.75 : strength === "weak" ? 0.3 : 0.5; }

async function applyInteractionLearning({ profile, session }) {
  const events = (session.interactionEvents || []).filter((event) => policy.interests.eventEvidence[event.type] !== undefined && event.itemId);
  const cache = new Map();
  for (const event of events) {
    const evidence = policy.interests.eventEvidence[event.type]; const itemId = String(event.itemId);
    if (!cache.has(itemId)) {
      const item = await Item.findById(itemId).lean();
      const revision = item?.publishedRevisionId ? await ItemRevision.findById(item.publishedRevisionId).lean() : null;
      const vocabulary = item ? await getMuseumVocabulary(item.museumId) : null;
      cache.set(itemId, { item, revision, vocabulary });
    }
    const { item, revision, vocabulary } = cache.get(itemId); if (!item || !revision || !vocabulary) continue;
    const now = event.at || new Date();
    upsertSemanticAffinity(profile, { kind: "item", itemId: item._id }, evidence, now);
    upsertSemanticAffinity(profile, { kind: "item_type", museumId: item.museumId, key: item.itemType }, evidence * 0.45, now);
    const itemTypeDefinition = (vocabulary.itemTypeDefinitions || []).find((entry) => entry.key === item.itemType);
    for (const ref of itemTypeDefinition?.semanticRefs || []) if (ref.matchType === "exact" || ref.matchType === "close") upsertSemanticAffinity(profile, { kind: "canonical", scheme: ref.scheme, refId: ref.id }, evidence * (ref.matchType === "exact" ? 0.35 : 0.2), now);
    for (const ref of revision.semanticRefs || []) if (ref.matchType === "exact" || ref.matchType === "close") upsertSemanticAffinity(profile, { kind: "canonical", scheme: ref.scheme, refId: ref.id }, evidence * (ref.matchType === "exact" ? 0.75 : 0.5), now);
    const relationTypes = new Map((vocabulary.relationTypes || []).map((entry) => [entry.key, entry]));
    for (const relation of revision.relations || []) {
      const type = relationTypes.get(relation.relationTypeKey); const propagated = evidence * relationStrengthFactor(type?.strength) * Math.min(1, (Number(relation.weight) || 1) / 10);
      upsertSemanticAffinity(profile, { kind: "relation_type", museumId: item.museumId, key: relation.relationTypeKey }, propagated, now);
      for (const ref of type?.semanticRefs || []) if (ref.matchType === "exact" || ref.matchType === "close") upsertSemanticAffinity(profile, { kind: "canonical", scheme: ref.scheme, refId: ref.id }, propagated * (ref.matchType === "exact" ? 0.6 : 0.35), now);
      upsertSemanticAffinity(profile, { kind: "item", itemId: relation.target }, propagated * 0.7, now);
    }
    const variant = getPresentationVariants(revision).find((entry) => entry.key === event.variantKey) || null;
    if (variant) {
      for (const focus of variant.semanticFocus || []) upsertSemanticAffinity(profile, { ...focus, museumId: item.museumId }, evidence * (Number(focus.weight) || 1) * 0.8, now);
      const aspectDefs = new Map((vocabulary.presentationAspects || []).map((entry) => [entry.key, entry]));
      for (const aspect of variant.presentationAspects || []) upsertAspectAffinity(profile, { museumId: item.museumId, key: aspect.key, semanticRefs: aspectDefs.get(aspect.key)?.semanticRefs || [] }, evidence * (Number(aspect.weight) || 1), now);
    }
  }
  return profile;
}

module.exports = { recencyWeight, effectiveAffinity, semanticAffinityScore, aspectAffinityScore, applyInteractionLearning };
