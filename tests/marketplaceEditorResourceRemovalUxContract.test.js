const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");

const root = path.resolve(__dirname, "..");
const helperPath = path.join(root, "clients/marketplace/src/ui/owned-resource-removal.js");
const workspacePath = path.join(root, "clients/marketplace/src/ui/workspace-view.js");
const namespaceEditorPath = path.join(root, "clients/marketplace/src/ui/namespace-editor-view.js");
const physicalEditorPath = path.join(root, "clients/marketplace/src/ui/physical-vocabulary-editor-view.js");
const helper = fs.readFileSync(helperPath, "utf8");
const workspace = fs.readFileSync(workspacePath, "utf8");
const namespaceEditor = fs.readFileSync(namespaceEditorPath, "utf8");
const physicalEditor = fs.readFileSync(physicalEditorPath, "utf8");
const { namespaceOperations, physicalVocabularyOperations } = require("../services/marketplaceManagementV2.service");

function oid() { return new mongoose.Types.ObjectId(); }

test("le projection di management espongono il lifecycle solo a chi può gestirlo", () => {
  const organizationId = oid();
  const namespace = { ownerType: "organization", ownerId: organizationId, workingRevisionId: oid() };
  const physicalVocabulary = { ownerType: "organization", ownerId: organizationId, workingRevisionId: oid() };
  const revision = { status: "draft" };

  assert.equal(
    namespaceOperations({ namespace, revision, permissions: new Set(["namespace.view", "namespace.edit"]) })
      .some((entry) => entry.code === "namespace.trash"),
    false,
  );
  assert.equal(
    namespaceOperations({ namespace, revision, permissions: new Set(["namespace.view", "namespace.lifecycle.manage"]) })
      .some((entry) => entry.code === "namespace.trash"),
    true,
  );
  assert.equal(
    physicalVocabularyOperations({ physicalVocabulary, revision, permissions: new Set(["physical_vocabulary.view", "physical_vocabulary.edit"]) })
      .some((entry) => entry.code === "physical_vocabulary.trash"),
    false,
  );
  assert.equal(
    physicalVocabularyOperations({ physicalVocabulary, revision, permissions: new Set(["physical_vocabulary.view", "physical_vocabulary.lifecycle.manage"]) })
      .some((entry) => entry.code === "physical_vocabulary.trash"),
    true,
  );
});

test("Namespace e Physical Vocabulary espongono la danger zone nell'editor e preservano le modifiche non salvate nella conferma", () => {
  assert.match(namespaceEditor, /renderOwnedResourceRemoval\(\{ resourceType: "namespace", availableOperations, operationCodes: \["namespace\.trash"\] \}\)/);
  assert.match(namespaceEditor, /requestOwnedResourceRemoval\(\{/);
  assert.match(namespaceEditor, /unsavedChanges: this\.dirty/);
  assert.match(namespaceEditor, /data-owned-resource-removal/);

  assert.match(physicalEditor, /renderOwnedResourceRemoval\(\{ resourceType: "physical_vocabulary", availableOperations: this\.operations\(\), operationCodes: \["physical_vocabulary\.trash"\] \}\)/);
  assert.match(physicalEditor, /requestOwnedResourceRemoval\(\{/);
  assert.match(physicalEditor, /unsavedChanges: this\.dirty/);
  assert.match(physicalEditor, /data-owned-resource-removal/);
});

test("Libreria ed editor riusano un solo contratto di rimozione Workspace", () => {
  assert.match(helper, /marketplaceRepository\.removeWorkspaceResource/);
  assert.match(helper, /Le pubblicazioni verranno ritirate e le offerte rese inattive/);
  assert.match(helper, /Acquisizioni e diritti già concessi restano validi/);
  assert.match(helper, /Le modifiche non ancora salvate nell’editor verranno scartate/);

  assert.match(workspace, /renderOwnedResourceRemoval/);
  assert.match(workspace, /requestOwnedResourceRemoval/);
  assert.doesNotMatch(workspace, /marketplaceRepository\.removeWorkspaceResource/);
  assert.doesNotMatch(namespaceEditor, /marketplaceRepository\.removeWorkspaceResource/);
  assert.doesNotMatch(physicalEditor, /marketplaceRepository\.removeWorkspaceResource/);
});
