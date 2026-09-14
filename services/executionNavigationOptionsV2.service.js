const { loadPinnedBundle } = require("./physicalExecutionV2.service");
const {
  profileProjection,
  visitorControlsProjection,
  canonicalNeedSupportProjection,
} = require("./routingProfileV2.service");

function id(value) { return String(value?._id || value || ""); }

async function projectExecutionNavigationOptions(venuePins = []) {
  const pseudoSession = { venuePins };
  const venues = [];
  for (const pin of venuePins || []) {
    const bundle = await loadPinnedBundle(pseudoSession, pin.venueId);
    venues.push({
      venueId: id(pin.venueId),
      name: bundle.venue?.name || "Sede",
      physicalVocabularyRevisionId: bundle.physicalVocabularyRevision._id,
      profiles: profileProjection(bundle.physicalVocabularyRevision),
      controls: visitorControlsProjection(bundle.physicalVocabularyRevision),
      personalNeedSupport: canonicalNeedSupportProjection(bundle.physicalVocabularyRevision),
    });
  }
  return { venues };
}

module.exports = { projectExecutionNavigationOptions };
