const fs = require("fs");

let failed = false;
function read(file) { return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""; }
function rejectPattern(file, pattern, label) {
  const text = read(file);
  if (text && pattern.test(text)) {
    console.error(`${label} in ${file}`);
    failed = true;
  }
}
function requirePattern(file, pattern, label) {
  const text = read(file);
  if (!text || !pattern.test(text)) {
    console.error(`${label} missing in ${file}`);
    failed = true;
  }
}

for (const file of [
  "services/revisionWorkflow.service.js",
  "services/visitV2Publication.service.js",
  "services/itemV2.service.js",
  "services/namespaceRevision.service.js",
  "services/venueRelease.service.js",
]) {
  rejectPattern(file, /\bmarkPublished\b/, "Ambiguous legacy publication helper");
}

requirePattern(
  "services/revisionWorkflow.service.js",
  /function publishWithoutReview[\s\S]*function approveReviewAndPublish/,
  "Separated direct publication and managerial approval",
);
requirePattern(
  "services/revisionWorkflow.service.js",
  /publishWithoutReview[\s\S]*revision\.publication/,
  "Direct publication path",
);
rejectPattern(
  "services/revisionWorkflow.service.js",
  /function publishWithoutReview[\s\S]{0,700}?review\.decision\s*=\s*["']approved["']/,
  "Direct publication must not fabricate review approval",
);

requirePattern(
  "services/visitV2Publication.service.js",
  /visit\.ownerType\s*===\s*["']organization["'][\s\S]*approveReviewAndPublish[\s\S]*publishWithoutReview/,
  "Owner-aware Visit publication",
);
requirePattern(
  "services/itemV2.service.js",
  /item\.ownerType\s*===\s*["']organization["'][\s\S]*approveReviewAndPublish[\s\S]*publishWithoutReview/,
  "Owner-aware Item publication",
);
requirePattern(
  "services/namespaceRevision.service.js",
  /namespace\.ownerType\s*===\s*["']organization["'][\s\S]*approveReviewAndPublish[\s\S]*publishWithoutReview/,
  "Owner-aware Namespace publication",
);
requirePattern(
  "services/venueRelease.service.js",
  /approveReviewAndPublish\(release, actorUserId\)/,
  "VenueRelease publication requires managerial approval",
);

requirePattern(
  "services/editorialWorkflowOperationsV2.service.js",
  /workflow\.request_review[\s\S]*workflow\.request_changes[\s\S]*workflow\.publish/,
  "Backend-authoritative editorial workflow operation projection",
);
requirePattern(
  "services/marketplaceWorkspaceV2.service.js",
  /projectEditorialWorkflowOperations/,
  "Creator Workspace consumes backend workflow operation projection",
);
requirePattern(
  "services/marketplaceWorkspaceOperationsV2.service.js",
  /startsWith\(["']workflow\.["']\)[\s\S]*executeEditorialWorkflowOperation/,
  "Creator Workspace dispatches editorial workflow commands",
);

rejectPattern(
  "clients/marketplace/src/ui/item-authoring-view.js",
  /availableOperations\?\.includes\(["']item\.publish["']\)|data-publish-edition|data-check-edition/,
  "Item editor must not hardcode publication authorization or old workflow buttons",
);
requirePattern(
  "clients/marketplace/src/ui/item-authoring-view.js",
  /data-workflow-operation[\s\S]*executeWorkspaceOperation/,
  "Item editor executes projected workflow operations",
);
requirePattern(
  "clients/marketplace/src/ui/workspace-view.js",
  /isWorkflowOperation[\s\S]*data-requires-message/,
  "Workspace renders projected workflow operations generically",
);
rejectPattern(
  "clients/marketplace/src/ui/workspace-view.js",
  /workflow\.[\w.]+[\s\S]{0,160}?(?:ownerType|actorRole|===\s*["']manager["']|===\s*["']operator["'])/,
  "Workspace must not infer editorial authorization from ownership or role",
);

if (failed) process.exit(1);
console.log("Slice 8 editorial publication/review boundaries are intact.");
