const { loadPinnedBundle } = require("./physicalExecutionV2.service");
const { profileProjection } = require("./routingProfileV2.service");

function id(value) { return String(value?._id || value || ""); }

async function projectExecutionNavigationOptions(venuePins = []) {
  const pseudoSession = { venuePins };
  const profilesByVenue = [];
  for (const pin of venuePins || []) {
    const bundle = await loadPinnedBundle(pseudoSession, pin.venueId);
    profilesByVenue.push({
      venueId: id(pin.venueId),
      physicalVocabularyRevisionId: bundle.physicalVocabularyRevision._id,
      profiles: profileProjection(bundle.physicalVocabularyRevision),
    });
  }
  return { profilesByVenue };
}

module.exports = { projectExecutionNavigationOptions };
