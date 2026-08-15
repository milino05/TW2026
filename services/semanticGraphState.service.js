const MuseumSemanticGraphState = require("../models/museumSemanticGraphState.model");

async function getPublishedGraphEpoch(museumId) {
  const state = await MuseumSemanticGraphState.findOneAndUpdate(
    { museumId },
    { $setOnInsert: { museumId, publishedEpoch: 1, lastPublishedChangeAt: new Date() } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return Number(state?.publishedEpoch) || 1;
}

async function bumpPublishedGraphEpoch(museumId) {
  const state = await MuseumSemanticGraphState.findOneAndUpdate(
    { museumId },
    {
      $inc: { publishedEpoch: 1 },
      $set: { lastPublishedChangeAt: new Date() },
      $setOnInsert: { museumId },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return Number(state?.publishedEpoch) || 1;
}

async function deleteSemanticGraphState(museumId) {
  await MuseumSemanticGraphState.deleteOne({ museumId });
}

module.exports = { getPublishedGraphEpoch, bumpPublishedGraphEpoch, deleteSemanticGraphState };
