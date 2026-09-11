const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const studioService = fs.readFileSync(path.join(root, "services/editorialStudioV2.service.js"), "utf8");
const studioView = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/editorial-studio-view.js"), "utf8");
const relationViews = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/semantic-relation-views.js"), "utf8");

test("la projection Studio conserva la semantica necessaria alle viste inverse", () => {
  assert.match(studioService, /domainDefinitionIds:\s*entry\.domainDefinitionIds/);
  assert.match(studioService, /rangeDefinitionIds:\s*entry\.rangeDefinitionIds/);
  assert.match(studioService, /directionality:\s*entry\.directionality/);
  assert.match(studioService, /reverse:\s*entry\.reverse\s*\?/);
  assert.match(studioService, /label:\s*entry\.reverse\.label/);
  assert.match(studioService, /description:\s*entry\.reverse\.description/);
  assert.match(studioView, /relationTypes:\s*this\.data\.namespace\.revision\?\.relationTypes/);
  assert.match(relationViews, /relation\.reverse\?\.label/);
  assert.match(relationViews, /focusDefinitionIds:\s*strings\(relation\.rangeDefinitionIds\)/);
  assert.match(relationViews, /otherDefinitionIds:\s*strings\(relation\.domainDefinitionIds\)/);
});
