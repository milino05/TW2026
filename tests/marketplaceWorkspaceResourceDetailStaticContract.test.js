const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const service = fs.readFileSync(path.join(root, "services/marketplaceWorkspaceResourcesV2.service.js"), "utf8");
const projector = fs.readFileSync(path.join(root, "services/marketplaceWorkspaceResourceProjectionV2.service.js"), "utf8");
const controller = fs.readFileSync(path.join(root, "controllers/marketplaceV2.controller.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "routes/marketplaceV2.routes.js"), "utf8");

test("workspace detail usa projector condiviso e lookup puntuale", () => {
  assert.match(service, /getCreatorWorkspaceResourceDetail/);
  assert.match(service, /CANDIDATE_FACTORIES\[resourceType\]/);
  assert.match(service, /resourceId/);
  assert.match(service, /projectOwnedCandidate/);
  assert.match(service, /projectLicensedCandidate/);
  assert.doesNotMatch(projector, /getCreatorWorkspace\(/);
});

test("workspace detail è esposto come endpoint autenticato con ObjectId validato", () => {
  assert.match(controller, /creatorWorkspaceResourceDetail/);
  assert.match(routes, /workspace\/resources\/:resourceType\/:resourceId/);
  assert.match(routes, /resourceId, controller\.creatorWorkspaceResourceDetail/);
});
