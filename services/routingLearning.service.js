const MuseumLayout = require("../models/museumLayout.model");
const MuseumLayoutRevision = require("../models/museumLayoutRevision.model");
const ConnectionLearnedProfile = require("../models/connectionLearnedProfile.model");
const RoutingAttributeLearnedProfile = require("../models/routingAttributeLearnedProfile.model");
const { robustMedian } = require("./adaptiveLearning.service");
const { updateContributor, aggregate } = require("./collectiveLearning.service");
const policy = require("../config/adaptivePolicy");

function valueSignature(value) { return value === null ? "null" : JSON.stringify(value); }
function canonicalFacts(layoutRevision, connection) { const definitions = new Map((layoutRevision.routingAttributes || []).map((entry) => [entry.key, entry])); const facts = []; for (const [localKey, value] of Object.entries(connection.attributes || {})) { const definition = definitions.get(localKey); if (definition?.canonicalKey) facts.push({ canonicalAttributeKey: definition.canonicalKey, valueSignature: valueSignature(value) }); } return facts; }

async function updateConnectionProfile({ userId, layoutRevisionId, connectionId, residual, sampleCount }) { const scopeKey = `edge:${layoutRevisionId}:${connectionId}`; await updateContributor({ userId, metricType: "connection_residual", scopeKey, value: residual, sampleCount }); const result = await aggregate("connection_residual", scopeKey); return ConnectionLearnedProfile.findOneAndUpdate({ layoutRevisionId, connectionId }, { $set: { typicalResidualSeconds: result.value || 0, confidence: result.confidence, sampleCount: result.sampleCount, contributorCount: result.contributorCount, updatedAt: result.updatedAt } }, { upsert: true, new: true, setDefaultsOnInsert: true }); }
async function updateAttributeProfile({ userId, query, residual, sampleCount }) { const scopeKey = query.scope === "global" ? `routing:global:${query.canonicalAttributeKey}:${query.valueSignature}` : `routing:museum:${query.museumId}:${query.canonicalAttributeKey}:${query.valueSignature}`; await updateContributor({ userId, metricType: "routing_attribute_residual", scopeKey, value: residual, sampleCount }); const result = await aggregate("routing_attribute_residual", scopeKey); return RoutingAttributeLearnedProfile.findOneAndUpdate(query, { $set: { typicalResidualSeconds: result.value || 0, confidence: result.confidence, sampleCount: result.sampleCount, contributorCount: result.contributorCount, updatedAt: result.updatedAt } }, { upsert: true, new: true, setDefaultsOnInsert: true }); }

async function updateRoutingProfiles({ session, personalExpectedSpeedMps }) {
  const valid = (session.transitionObservations || []).filter((entry) => (entry.reliability || 0) >= policy.learning.minimumReliability);
  const byLayout = new Map();
  for (const observation of valid) { const key = String(observation.layoutRevisionId); if (!byLayout.has(key)) byLayout.set(key, []); byLayout.get(key).push(observation); }
  for (const [layoutRevisionId, observations] of byLayout.entries()) {
    const layoutRevision = await MuseumLayoutRevision.findById(layoutRevisionId).lean();
    if (!layoutRevision) continue;
    const layout = await MuseumLayout.findById(layoutRevision.layoutId).lean();
    if (!layout) continue;
    const connections = new Map((layoutRevision.connections || []).map((entry) => [String(entry._id), entry]));
    const perConnection = new Map();
    const perFact = new Map();
    for (const observation of observations) {
      const connection = connections.get(String(observation.connectionId));
      if (!connection) continue;
      const expectedMovement = observation.distanceMeters / Math.max(policy.movement.minSpeedMps, personalExpectedSpeedMps);
      const residual = observation.observedSeconds - (expectedMovement + (Number(connection.additionalDelaySeconds) || 0));
      const connectionKey = String(connection._id);
      if (!perConnection.has(connectionKey)) perConnection.set(connectionKey, []);
      perConnection.get(connectionKey).push(residual);
      for (const fact of canonicalFacts(layoutRevision, connection)) { const key = `${fact.canonicalAttributeKey}::${fact.valueSignature}`; if (!perFact.has(key)) perFact.set(key, { fact, residuals: [] }); perFact.get(key).residuals.push(residual); }
    }
    for (const [connectionId, residuals] of perConnection.entries()) { const residual = robustMedian(residuals); if (Number.isFinite(residual)) await updateConnectionProfile({ userId: session.userId, layoutRevisionId, connectionId, residual, sampleCount: residuals.length }); }
    for (const { fact, residuals } of perFact.values()) { const residual = robustMedian(residuals); if (!Number.isFinite(residual)) continue; await updateAttributeProfile({ userId: session.userId, query: { scope: "museum", museumId: layout.museumId, ...fact }, residual, sampleCount: residuals.length }); await updateAttributeProfile({ userId: session.userId, query: { scope: "global", museumId: null, ...fact }, residual, sampleCount: residuals.length }); }
  }
}

function weightedResidual(candidates) { const valid = candidates.filter((entry) => Number.isFinite(entry?.typicalResidualSeconds) && (entry.confidence || 0) > 0); if (!valid.length) return 0; const total = valid.reduce((sum, entry) => sum + entry.confidence, 0); return valid.reduce((sum, entry) => sum + entry.typicalResidualSeconds * entry.confidence, 0) / total; }

async function getLearnedResidualByConnection(layoutRevision) {
  const layout = await MuseumLayout.findById(layoutRevision.layoutId).lean();
  const [edgeProfiles, museumPriors, globalPriors] = await Promise.all([ConnectionLearnedProfile.find({ layoutRevisionId: layoutRevision._id }).lean(), layout ? RoutingAttributeLearnedProfile.find({ scope: "museum", museumId: layout.museumId }).lean() : [], RoutingAttributeLearnedProfile.find({ scope: "global", museumId: null }).lean()]);
  const edgeById = new Map(edgeProfiles.map((entry) => [String(entry.connectionId), entry]));
  const priorKey = (entry) => `${entry.canonicalAttributeKey}::${entry.valueSignature}`;
  const museumByKey = new Map(museumPriors.map((entry) => [priorKey(entry), entry]));
  const globalByKey = new Map(globalPriors.map((entry) => [priorKey(entry), entry]));
  const result = {};
  for (const connection of layoutRevision.connections || []) {
    const edge = edgeById.get(String(connection._id));
    if (edge?.confidence >= policy.confidence.usableThreshold) { result[String(connection._id)] = edge.typicalResidualSeconds; continue; }
    const museumCandidates = []; const globalCandidates = [];
    for (const fact of canonicalFacts(layoutRevision, connection)) { const key = `${fact.canonicalAttributeKey}::${fact.valueSignature}`; if (museumByKey.has(key)) museumCandidates.push(museumByKey.get(key)); if (globalByKey.has(key)) globalCandidates.push(globalByKey.get(key)); }
    result[String(connection._id)] = museumCandidates.some((entry) => entry.confidence >= policy.confidence.usableThreshold) ? weightedResidual(museumCandidates) : weightedResidual(globalCandidates);
  }
  return result;
}

module.exports = { valueSignature, canonicalFacts, updateRoutingProfiles, getLearnedResidualByConnection };
