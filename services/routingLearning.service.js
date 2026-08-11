const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const ConnectionLearnedProfile = require("../models/connectionLearnedProfile.model");
const RoutingAttributeLearnedProfile = require("../models/routingAttributeLearnedProfile.model");
const { confidenceFromSamples, robustMedian } = require("./adaptiveLearning.service");

function valueSignature(value) {
  if (value === null) return "null";
  if (["string", "number", "boolean"].includes(typeof value)) return JSON.stringify(value);
  return JSON.stringify(value);
}

function canonicalFacts(layoutRevision, connection) {
  const definitions = new Map((layoutRevision.routingAttributes || []).map((entry) => [entry.key, entry]));
  const facts = [];
  for (const [localKey, value] of Object.entries(connection.attributes || {})) {
    const definition = definitions.get(localKey);
    if (!definition?.canonicalKey) continue;
    facts.push({ canonicalAttributeKey: definition.canonicalKey, valueSignature: valueSignature(value) });
  }
  return facts;
}

async function updateProfile(query, residual, sampleCount) {
  const profile = await RoutingAttributeLearnedProfile.findOneAndUpdate(
    query,
    { $setOnInsert: query },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const previous = profile.contributingSessionCount;
  const alpha = Math.max(0.03, Math.min(0.2, 1 / Math.sqrt(previous + 2)));
  profile.typicalResidualSeconds = previous === 0
    ? residual
    : profile.typicalResidualSeconds * (1 - alpha) + residual * alpha;
  profile.sampleCount += sampleCount;
  profile.contributingSessionCount += 1;
  profile.confidence = confidenceFromSamples(profile.sampleCount, profile.contributingSessionCount);
  profile.updatedAt = new Date();
  await profile.save();
}

async function updateRoutingAttributePriors({ session, userSpeedMps }) {
  const valid = (session.transitionObservations || []).filter((entry) => (entry.reliability || 0) >= 0.5);
  const byLayout = new Map();
  for (const observation of valid) {
    const key = String(observation.layoutRevisionId);
    if (!byLayout.has(key)) byLayout.set(key, []);
    byLayout.get(key).push(observation);
  }

  for (const [layoutRevisionId, observations] of byLayout.entries()) {
    const layoutRevision = await MuseumLayoutRevision.findById(layoutRevisionId).lean();
    if (!layoutRevision) continue;
    const layout = await MuseumLayout.findById(layoutRevision.layoutId).lean();
    if (!layout) continue;
    const connections = new Map((layoutRevision.connections || []).map((entry) => [String(entry._id), entry]));
    const grouped = new Map();
    for (const observation of observations) {
      const connection = connections.get(String(observation.connectionId));
      if (!connection) continue;
      const expected = observation.distanceMeters / Math.max(0.1, userSpeedMps);
      const residual = observation.observedSeconds - expected;
      for (const fact of canonicalFacts(layoutRevision, connection)) {
        const key = `${fact.canonicalAttributeKey}::${fact.valueSignature}`;
        if (!grouped.has(key)) grouped.set(key, { fact, residuals: [] });
        grouped.get(key).residuals.push(residual);
      }
    }
    for (const { fact, residuals } of grouped.values()) {
      const residual = robustMedian(residuals);
      if (!Number.isFinite(residual)) continue;
      await updateProfile(
        { scope: "museum", museumId: layout.museumId, ...fact },
        residual,
        residuals.length,
      );
      await updateProfile(
        { scope: "global", museumId: null, ...fact },
        residual,
        residuals.length,
      );
    }
  }
}

function weightedResidual(candidates) {
  const valid = candidates.filter((entry) => Number.isFinite(entry?.typicalResidualSeconds) && (entry.confidence || 0) > 0);
  if (!valid.length) return 0;
  const total = valid.reduce((sum, entry) => sum + entry.confidence, 0);
  return valid.reduce((sum, entry) => sum + entry.typicalResidualSeconds * entry.confidence, 0) / total;
}

async function getLearnedResidualByConnection(layoutRevision) {
  const layout = await MuseumLayout.findById(layoutRevision.layoutId).lean();
  const [edgeProfiles, museumPriors, globalPriors] = await Promise.all([
    ConnectionLearnedProfile.find({ layoutRevisionId: layoutRevision._id }).lean(),
    layout ? RoutingAttributeLearnedProfile.find({ scope: "museum", museumId: layout.museumId }).lean() : [],
    RoutingAttributeLearnedProfile.find({ scope: "global", museumId: null }).lean(),
  ]);
  const edgeById = new Map(edgeProfiles.map((entry) => [String(entry.connectionId), entry]));
  const priorKey = (entry) => `${entry.canonicalAttributeKey}::${entry.valueSignature}`;
  const museumByKey = new Map(museumPriors.map((entry) => [priorKey(entry), entry]));
  const globalByKey = new Map(globalPriors.map((entry) => [priorKey(entry), entry]));
  const result = {};

  for (const connection of layoutRevision.connections || []) {
    const edge = edgeById.get(String(connection._id));
    if (edge?.confidence >= 0.2) {
      result[String(connection._id)] = edge.typicalResidualSeconds;
      continue;
    }
    const museumCandidates = [];
    const globalCandidates = [];
    for (const fact of canonicalFacts(layoutRevision, connection)) {
      const key = `${fact.canonicalAttributeKey}::${fact.valueSignature}`;
      if (museumByKey.has(key)) museumCandidates.push(museumByKey.get(key));
      if (globalByKey.has(key)) globalCandidates.push(globalByKey.get(key));
    }
    const museumResidual = weightedResidual(museumCandidates);
    const globalResidual = weightedResidual(globalCandidates);
    result[String(connection._id)] = museumCandidates.some((entry) => entry.confidence >= 0.2)
      ? museumResidual
      : globalResidual;
  }
  return result;
}

module.exports = { valueSignature, canonicalFacts, updateRoutingAttributePriors, getLearnedResidualByConnection };
