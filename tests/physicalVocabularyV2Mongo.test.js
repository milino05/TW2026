const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_physical_vocabulary_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);

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

async function jsonFetch(url, { cookie = null, ...init } = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => null);
  return { response, body };
}

test("lifecycle personale: starter, publish, nuova working revision, fork e cestino", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
    const physicalVocabularyService = require("../services/physicalVocabulary.service");
    const revisionService = require("../services/physicalVocabularyRevision.service");
    const [user, licensee] = await User.create([
      { username: "physical-personal", passwordHash: "hash" },
      { username: "physical-licensee", passwordHash: "hash" },
    ]);

    const created = await physicalVocabularyService.createPhysicalVocabulary({
      actorUserId: user._id,
      payload: {
        name: "Vocabolario personale",
        description: "Configurazione fisica personalizzata",
        ownerType: "user",
        ownerId: user._id,
        applyStarter: true,
      },
    });
    assert.equal(created.revision.placeTypes.length, 13);
    assert.equal(created.revision.status, "draft");
    const checked = await revisionService.evaluatePhysicalVocabulary({ physicalVocabularyId: created.physicalVocabulary._id, actorUserId: user._id });
    assert.deepEqual(checked.issues, []);
    assert.equal(checked.revision.integrity.status, "valid");
    const published = await revisionService.publishPhysicalVocabulary({ physicalVocabularyId: created.physicalVocabulary._id, actorUserId: user._id });
    assert.equal(published.revision.status, "published");
    assert.equal(published.physicalVocabulary.workingRevisionId, null);

    const marketplace = require("../services/marketplaceV2.service");
    const listing = await marketplace.createListing({
      resourceType: "physical_vocabulary",
      resourceId: created.physicalVocabulary._id,
      sellerType: "user",
      sellerId: user._id,
      actorUserId: user._id,
    });
    const offer = await marketplace.createOffer({
      listingId: listing._id,
      actorUserId: user._id,
      payload: {
        pricing: { type: "free" },
        grants: [{
          resourceType: "physical_vocabulary",
          resourceId: created.physicalVocabulary._id,
          capability: "physical_vocabulary.fork",
          versionPolicy: "follow_current",
        }],
      },
    });
    await marketplace.acquireOffer({ offerId: offer._id, actorUserId: licensee._id, beneficiaryType: "user", beneficiaryId: licensee._id });
    const licensedFork = await physicalVocabularyService.forkPhysicalVocabulary({
      physicalVocabularyId: created.physicalVocabulary._id,
      actorUserId: licensee._id,
      payload: { ownerType: "user", ownerId: licensee._id, name: "Vocabolario acquisito" },
    });
    const { Adoption } = require("../models/adoption.model");
    const adoption = await Adoption.findOne({ action: "physical_vocabulary_fork", "resultResourceRef.resourceId": licensedFork.physicalVocabulary._id }).lean();
    assert.equal(String(adoption.sourceSnapshotRef.resourceId), String(published.revision._id));

    const working = await revisionService.getWorkingPhysicalVocabularyRevision({ physicalVocabularyId: created.physicalVocabulary._id, actorUserId: user._id, create: true });
    assert.equal(working.revision.version, 2);
    assert.equal(String(working.revision.basedOnRevisionId), String(published.revision._id));
    const starterAgain = await revisionService.applyStarterToPhysicalVocabularyDraft({ physicalVocabularyId: created.physicalVocabulary._id, actorUserId: user._id });
    assert.deepEqual(starterAgain.applied, {
      starterVersion: 1,
      placeTypesAdded: 0,
      connectionTypesAdded: 0,
      physicalAttributesAdded: 0,
      routingProfilesAdded: 0,
    });

    const forked = await physicalVocabularyService.forkPhysicalVocabulary({
      physicalVocabularyId: created.physicalVocabulary._id,
      actorUserId: user._id,
      payload: { ownerType: "user", ownerId: user._id, name: "Vocabolario derivato" },
    });
    assert.equal(String(forked.physicalVocabulary.forkedFromPhysicalVocabularyRevisionId), String(published.revision._id));
    assert.notEqual(forked.revision.placeTypes[0].definitionId, published.revision.placeTypes[0].definitionId);
    const originalSemantic = published.revision.placeTypes[0].semanticRefs.map((entry) => entry.toObject());
    const forkSemantic = forked.revision.placeTypes[0].semanticRefs.map((entry) => entry.toObject());
    assert.deepEqual(forkSemantic, originalSemantic);

    const workspace = await require("../services/marketplaceWorkspaceResourcesV2.service").listCreatorWorkspaceResources({
      actorUserId: user._id,
      principalType: "user",
      principalId: user._id,
      ownership: "owned",
      resourceTypes: ["physical_vocabulary"],
    });
    assert.equal(workspace.results.every((entry) => entry.resourceType === "physical_vocabulary"), true);
    assert.ok(workspace.results.some((entry) => String(entry.resourceId) === String(created.physicalVocabulary._id)));

    const trashed = await physicalVocabularyService.trashPhysicalVocabulary({ physicalVocabularyId: forked.physicalVocabulary._id, actorUserId: user._id });
    assert.equal(trashed.lifecycleStatus, "trashed");
    await assert.rejects(() => physicalVocabularyService.getPhysicalVocabularyById({ physicalVocabularyId: trashed._id }), (error) => error?.status === 404);
    const restored = await physicalVocabularyService.restorePhysicalVocabulary({ physicalVocabularyId: trashed._id, actorUserId: user._id });
    assert.equal(restored.lifecycleStatus, "active");
    assert.equal(await PhysicalVocabularyRevision.countDocuments({ physicalVocabularyId: created.physicalVocabulary._id }), 2);
  });
});

test("un Physical Vocabulary di Organization richiede review prima del publish", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const organizationService = require("../services/organization.service");
    const { resolveOrganizationAuthority } = require("../services/organizationAuthorization.service");
    const physicalVocabularyService = require("../services/physicalVocabulary.service");
    const revisionService = require("../services/physicalVocabularyRevision.service");
    const [owner, publisher] = await User.create([
      { username: "physical-organization-owner", passwordHash: "hash" },
      { username: "physical-organization-publisher", passwordHash: "hash" },
    ]);
    const organization = await organizationService.createOrganization({ payload: { name: "Fondazione fisica" }, actorUserId: owner._id });
    const publisherRole = await organizationService.createOrganizationRole({
      organizationId: organization._id,
      actorUserId: owner._id,
      payload: { name: "Publisher fisico", permissionCodes: ["physical_vocabulary.publish"] },
    });
    await organizationService.setMemberRoles({
      organizationId: organization._id,
      targetUserId: publisher._id,
      roleIds: [publisherRole._id],
      actorUserId: owner._id,
      createOnly: true,
    });
    const publisherAuthority = await resolveOrganizationAuthority({ userId: publisher._id, organizationId: organization._id });
    assert.equal(publisherAuthority.effectivePermissions.includes("physical_vocabulary.edit"), false);
    const created = await physicalVocabularyService.createPhysicalVocabulary({
      actorUserId: owner._id,
      payload: { name: "Vocabolario della fondazione", ownerType: "organization", ownerId: organization._id, applyStarter: true },
    });
    const personalDefaultList = await physicalVocabularyService.listPhysicalVocabularies({ actorUserId: owner._id });
    assert.equal(personalDefaultList.some((entry) => String(entry._id) === String(created.physicalVocabulary._id)), false);
    const organizationList = await physicalVocabularyService.listPhysicalVocabularies({
      actorUserId: owner._id,
      ownerType: "organization",
      ownerId: organization._id,
    });
    assert.equal(organizationList.some((entry) => String(entry._id) === String(created.physicalVocabulary._id)), true);
    await assert.rejects(
      () => revisionService.publishPhysicalVocabulary({ physicalVocabularyId: created.physicalVocabulary._id, actorUserId: owner._id }),
      (error) => error?.status === 409 && error?.details?.[0]?.code === "INVALID_APPROVAL_PUBLISH_TRANSITION",
    );
    const review = await revisionService.requestPhysicalVocabularyReview({ physicalVocabularyId: created.physicalVocabulary._id, actorUserId: owner._id });
    assert.equal(review.revision.status, "in_review");
    const published = await revisionService.publishPhysicalVocabulary({ physicalVocabularyId: created.physicalVocabulary._id, actorUserId: publisher._id });
    assert.equal(published.revision.status, "published");
    assert.equal(published.revision.review.decision, "approved");
  });
});

test("le API Physical Vocabulary espongono command autenticati e revisione pubblica", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const { hashPassword } = require("../services/auth.service");
    const app = require("../app");
    const user = await User.create({ username: "physical-api", passwordHash: await hashPassword("12345678") });
    const server = app.listen(0);
    try {
      await new Promise((resolve) => server.once("listening", resolve));
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const login = await jsonFetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ username: user.username, password: "12345678" }),
      });
      assert.equal(login.response.status, 200);
      const cookie = login.response.headers.get("set-cookie").split(";")[0];
      const created = await jsonFetch(`${baseUrl}/api/physical-vocabularies`, {
        cookie,
        method: "POST",
        body: JSON.stringify({ name: "Vocabolario via API", ownerType: "user", ownerId: user._id, applyStarter: true }),
      });
      assert.equal(created.response.status, 201);
      const physicalVocabularyId = created.body.physicalVocabulary._id;
      const checked = await jsonFetch(`${baseUrl}/api/physical-vocabularies/${physicalVocabularyId}/working-revision/check-consistency`, { cookie, method: "POST", body: "{}" });
      assert.equal(checked.response.status, 200);
      assert.equal(checked.body.revision.integrity.status, "valid");
      const published = await jsonFetch(`${baseUrl}/api/physical-vocabularies/${physicalVocabularyId}/working-revision/publish`, { cookie, method: "POST", body: "{}" });
      assert.equal(published.response.status, 200);
      const publicRevision = await jsonFetch(`${baseUrl}/api/physical-vocabularies/${physicalVocabularyId}/revision`);
      assert.equal(publicRevision.response.status, 200, JSON.stringify(publicRevision.body));
      assert.equal(publicRevision.body.revision.status, "published");
      const unauthenticatedCreate = await jsonFetch(`${baseUrl}/api/physical-vocabularies`, { method: "POST", body: JSON.stringify({}) });
      assert.equal(unauthenticatedCreate.response.status, 401);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
