const fs = require("fs");

let failed = false;

function read(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function rejectFields(file, fields, label) {
  const text = read(file);
  if (!text) return;
  for (const field of fields) {
    if (new RegExp(`\\b${field}\\b`).test(text)) {
      console.error(`${label} contains forbidden field ${field} in ${file}`);
      failed = true;
    }
  }
}

function rejectPattern(file, pattern, label) {
  const text = read(file);
  if (text && pattern.test(text)) {
    console.error(`${label} in ${file}`);
    failed = true;
  }
}

// Subject is a global semantic identity. It must not acquire editorial ownership
// or physical placement just to support the Marketplace Venue selector.
rejectFields(
  "models/subject.model.js",
  ["museumId", "venueId", "venueTargetId", "contentSpaceId", "ownerType", "ownerId"],
  "Subject global identity",
);

// Item lineage, Edition and Revision are Editorial Domain resources. Physical
// occurrence and recognition media stay in Venue/VenueRelease.
for (const file of ["models/itemV2.model.js", "models/itemEdition.model.js", "models/itemRevisionV2.model.js"]) {
  rejectFields(
    file,
    ["museumId", "venueId", "venueIds", "venueTargetId", "venueTargetIds", "recognitionMedia", "recognitionImage"],
    "Item authoring domain",
  );
}

// Namespace is reusable semantic/editorial vocabulary and is intrinsically Venue-neutral.
rejectFields(
  "models/namespace.model.js",
  ["museumId", "venueId", "venueIds", "venueTargetId", "contentSpaceId"],
  "Namespace Venue-neutral boundary",
);

// Catalog relevance must remain derived. Never persist physical relevance into Listing.
rejectFields(
  "models/marketplaceListing.model.js",
  ["museumId", "museumIds", "venueId", "venueIds", "venueTargetId", "venueTargetIds"],
  "MarketplaceListing derived Venue relevance",
);

// Venue filtering is allowed to use published physical Subject materialization and
// explicit Context endorsement/corpus evidence, but not to redefine EditorialScope
// by traversing or filtering the SemanticGraph.
rejectPattern(
  "services/venueCatalogRelevanceV2.service.js",
  /SemanticGraph|SemanticEdge|GraphSubjectBinding|federatedSemanticGraph/i,
  "VenueCatalogRelevanceResolver must not filter the SemanticGraph",
);
rejectPattern(
  "services/venueCatalogRelevanceV2.service.js",
  /museumId/i,
  "VenueCatalogRelevanceResolver must not recreate museumId",
);

// Marketplace catalog uses the approved multi-Venue query contract.
rejectPattern(
  "clients/marketplace/src/infrastructure/http/marketplace-repository.js",
  /(?:searchParams|params)\.set\(\s*["']venueId["']/,
  "Marketplace Catalog must use selectedVenueIds rather than singular venueId",
);

if (failed) process.exit(1);
console.log("Slice 6 Subject/Item/Namespace/Venue relevance boundaries are intact.");
