const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const service = fs.readFileSync(path.join(root, "services/marketplaceWorkspaceResourcesV2.service.js"), "utf8");
const projector = fs.readFileSync(path.join(root, "services/marketplaceWorkspaceResourceProjectionV2.service.js"), "utf8");
const workspaceProjector = fs.readFileSync(path.join(root, "services/marketplaceWorkspaceV2.service.js"), "utf8");
const presentation = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/presentation.js"), "utf8");
const controller = fs.readFileSync(path.join(root, "controllers/marketplaceV2.controller.js"), "utf8");
const routes = fs.readFileSync(path.join(root, "routes/marketplaceV2.routes.js"), "utf8");
const removal = fs.readFileSync(path.join(root, "services/marketplaceResourceRemovalV2.service.js"), "utf8");
const view = fs.readFileSync(path.join(root, "clients/marketplace/src/ui/workspace-view.js"), "utf8");

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

test("dettagli e azioni espone una rimozione confermata che preserva lo storico", () => {
  assert.match(routes, /workspace\/resources\/:resourceType\/:resourceId\/remove/);
  assert.match(removal, /lifecycleStatus = "trashed"/);
  assert.match(removal, /status: "withdrawn"/);
  assert.match(removal, /status: "inactive"/);
  assert.doesNotMatch(removal, /MarketplaceAcquisition\.(?:delete|update)/);
  assert.doesNotMatch(removal, /Entitlement\.(?:delete|update)/);
  assert.doesNotMatch(removal, /Adoption\.(?:delete|update)/);
  assert.match(view, /data-request-removal/);
  assert.match(view, /data-confirm-removal/);
  assert.match(view, /Acquisizioni, diritti già concessi e adozioni resteranno validi/);
  assert.match(removal, /"editorial_context"/);
  assert.match(removal, /"visit"/);
  assert.match(view, /puoi perdere molti collegamenti/);
  assert.match(view, /dovranno essere ricreati manualmente/);
  assert.match(view, /data-removal-ack/);
});

test("contenuti e regole controllati restano privati finché listing e offerta non sono pubblici", () => {
  for (const source of [projector, workspaceProjector]) {
    assert.match(source, /function itemState/);
    assert.match(source, /listing\?\.status === "published" && Number\(listing\.activeOfferCount\) > 0/);
    assert.match(source, /finalizePrivatelyOnCheck: \["item_edition", "namespace"\]\.includes\(resourceType\)/);
    assert.match(source, /publishedRevisionId \? "private" : "empty"/);
  }
  assert.match(presentation, /private: "Privato"/);
});
