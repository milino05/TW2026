const LearningContribution = require("../models/learningContribution.model");
const { contributorHash } = require("./contributorIdentity.service");
const { robustMedian, percentile, confidenceFromSamples, updateEstimate } = require("./adaptiveLearning.service");

async function updateContributor({ userId, metricType, scopeKey, value, sampleCount = 1, reliability = 1 }) {
  if (!Number.isFinite(value) || reliability <= 0) return null;
  const hash = contributorHash(userId);
  const contribution = await LearningContribution.findOne({ contributorHash: hash, metricType, scopeKey }).select("+contributorHash");
  if (!contribution) {
    return LearningContribution.create({ contributorHash: hash, metricType, scopeKey, value, sampleCount: Math.max(1, sampleCount), confidence: Math.min(0.98, reliability * (1 - Math.exp(-Math.max(1, sampleCount) / 5))), lastObservedAt: new Date() });
  }
  const updated = updateEstimate({ value: contribution.value, sampleCount: contribution.sampleCount }, value, reliability);
  contribution.value = updated.value;
  contribution.sampleCount += Math.max(1, sampleCount);
  contribution.confidence = Math.min(0.98, 1 - Math.exp(-contribution.sampleCount / 5));
  contribution.lastObservedAt = new Date();
  await contribution.save();
  return contribution;
}

async function aggregate(metricType, scopeKey) {
  const contributions = await LearningContribution.find({ metricType, scopeKey }).lean();
  const values = contributions.map((entry) => entry.value).filter(Number.isFinite);
  const sampleCount = contributions.reduce((sum, entry) => sum + (entry.sampleCount || 0), 0);
  const contributorCount = contributions.length;
  return { value: robustMedian(values), lower: percentile(values, 0.25), upper: percentile(values, 0.75), sampleCount, contributorCount, confidence: confidenceFromSamples(sampleCount, contributorCount), updatedAt: new Date() };
}

async function removeContributor(userId) {
  const hash = contributorHash(userId);
  return LearningContribution.deleteMany({ contributorHash: hash });
}

module.exports = { updateContributor, aggregate, removeContributor };
