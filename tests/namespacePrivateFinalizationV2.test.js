const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");

const mongoUri = process.env.MONGO_URI;

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    return await callback();
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
}

function validDefinitions() {
  return {
    subjectClasses: [{ definitionId: randomUUID(), key: "artwork", label: "Opera", semanticRefs: [] }],
    relationTypes: [],
    durationTypes: [{ definitionId: randomUUID(), key: "short", label: "Breve", targetSeconds: 60, semanticRefs: [] }],
    languageLevels: [{ definitionId: randomUUID(), key: "simple", label: "Semplice", semanticRefs: [] }],
    presentationAspects: [],
    selectionSignals: [],
  };
}

test("il controllo consolida una regola valida come privata", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const { checkNamespaceConsistency } = require("../services/namespaceRevision.service");

    const user = await User.create({ username: "namespace-private-owner", passwordHash: "test-hash" });
    const namespace = await Namespace.create({ name: "Regole private", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const revision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      ...validDefinitions(),
      status: "draft",
      createdBy: user._id,
      updatedBy: user._id,
    });
    namespace.workingRevisionId = revision._id;
    await namespace.save();

    const result = await checkNamespaceConsistency({ namespaceId: namespace._id, actorUserId: user._id });
    assert.equal(result.finalized, true);
    assert.equal(result.visibility, "private");
    assert.deepEqual(result.issues, []);

    const [storedNamespace, storedRevision] = await Promise.all([
      Namespace.findById(namespace._id).lean(),
      NamespaceRevision.findById(revision._id).lean(),
    ]);
    assert.equal(String(storedNamespace.publishedRevisionId), String(revision._id));
    assert.equal(storedNamespace.workingRevisionId, null);
    assert.equal(storedRevision.status, "published");
    assert.equal(storedRevision.integrity.status, "valid");
  });
});

test("una regola incompleta resta bozza e mostra i problemi", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const { checkNamespaceConsistency } = require("../services/namespaceRevision.service");

    const user = await User.create({ username: "namespace-draft-owner", passwordHash: "test-hash" });
    const namespace = await Namespace.create({ name: "Regole incomplete", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const revision = await NamespaceRevision.create({ namespaceId: namespace._id, version: 1, status: "draft", createdBy: user._id, updatedBy: user._id });
    namespace.workingRevisionId = revision._id;
    await namespace.save();

    const result = await checkNamespaceConsistency({ namespaceId: namespace._id, actorUserId: user._id });
    assert.equal(result.finalized, false);
    assert.equal(result.visibility, "draft");
    assert.ok(result.issues.some((issue) => issue.field === "durationTypes"));
    assert.ok(result.issues.some((issue) => issue.field === "languageLevels"));

    const storedNamespace = await Namespace.findById(namespace._id).lean();
    assert.equal(storedNamespace.publishedRevisionId, null);
    assert.equal(String(storedNamespace.workingRevisionId), String(revision._id));
  });
});
