const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");

const mongoUri = process.env.MONGO_URI;
function oid() { return new mongoose.Types.ObjectId(); }

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

async function createContext({ userId, name, ownerId = userId }) {
  const Namespace = require("../models/namespace.model");
  const ContentSpace = require("../models/contentSpace.model");
  const EditorialContext = require("../models/editorialContext.model");
  const EditorialRelease = require("../models/editorialRelease.model");

  const namespace = await Namespace.create({ name: `${name} namespace`, ownerType: "user", ownerId, createdBy: userId });
  const space = await ContentSpace.create({ name: `${name} space`, ownerType: "user", ownerId, createdBy: userId });
  const context = await EditorialContext.create({
    contentSpaceId: space._id,
    namespaceId: namespace._id,
    displayName: `${name} context`,
    createdBy: userId,
  });
  const release = await EditorialRelease.create({
    editorialContextId: context._id,
    version: 1,
    namespaceRevisionId: oid(),
    graphRevisionId: oid(),
    itemBindings: [],
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    releasedAt: new Date(),
    releasedBy: userId,
  });
  context.publishedReleaseId = release._id;
  await context.save();
  return { namespace, space, context, release };
}

async function createReadyVenue({ userId, organizationId, primaryEditorialContextId = null, name = "Venue pronta" }) {
  const Venue = require("../models/venue.model");
  const LayoutRevision = require("../models/layoutRevision.model");
  const VenueRelease = require("../models/venueRelease.model");
  const venue = await Venue.create({
    name,
    ownerOrganizationId: organizationId,
    primaryEditorialContextId,
    createdBy: userId,
  });
  const physical = await createPublishedPhysicalVocabulary({ userId });
  const layout = await LayoutRevision.create({
    venueId: venue._id,
    version: 1,
    authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
    status: "published",
    createdBy: userId,
    updatedBy: userId,
  });
  const release = await VenueRelease.create({
    venueId: venue._id,
    version: 1,
    layoutRevisionId: layout._id,
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
  venue.publishedReleaseId = release._id;
  await venue.save();
  return { venue, layout, release };
}

function flattenSources(projection) {
  return (projection.editorialScope?.contentSpaces || []).flatMap((space) =>
    (space.contexts || []).flatMap((context) =>
      (context.sources || []).map((source) => ({ space, context, source })),
    ),
  );
}

test("GenerationOptions keeps PhysicalScope independent and defaults only an authorized primary Context", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Entitlement = require("../models/entitlement.model");
    const { getGenerationOptionsProjection } = require("../services/generationOptionsV2.service");

    const owner = await User.create({ username: "options-owner", passwordHash: "hash" });
    const external = await User.create({ username: "options-external", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Venue organization", createdBy: owner._id });
    const primary = await createContext({ userId: owner._id, name: "Primary" });
    const externalContext = await createContext({ userId: external._id, ownerId: external._id, name: "External" });
    const { venue } = await createReadyVenue({
      userId: owner._id,
      organizationId: organization._id,
      primaryEditorialContextId: primary.context._id,
    });

    await Entitlement.create({
      beneficiaryType: "user",
      beneficiaryId: owner._id,
      resourceType: "editorial_release",
      resourceId: externalContext.release._id,
      capability: "context.generate",
      versionPolicy: "pinned",
      baselineSnapshotRef: { resourceType: "editorial_release", resourceId: externalContext.release._id },
      status: "active",
    });

    const projection = await getGenerationOptionsProjection({ actorUserId: owner._id, selectedVenueIds: [venue._id] });
    assert.deepEqual(projection.physicalScope.selectedVenueIds.map(String), [String(venue._id)]);
    assert.equal(projection.editorialScope.independentFromPhysicalScope, true);

    const sources = flattenSources(projection);
    const primarySource = sources.find((entry) => String(entry.context.id) === String(primary.context._id) && entry.source.sourceRef.resourceType === "editorial_context");
    const pinnedExternal = sources.find((entry) => String(entry.context.id) === String(externalContext.context._id) && entry.source.sourceRef.resourceType === "editorial_release");
    assert.ok(primarySource);
    assert.equal(primarySource.source.versionMode, "follow_current");
    assert.ok(pinnedExternal, "Una source autorizzata esterna deve restare disponibile anche se la Venue selezionata appartiene a un'altra Organization");
    assert.equal(pinnedExternal.source.versionMode, "pinned");
    assert.deepEqual(projection.editorialScope.defaultSources.map((entry) => `${entry.resourceType}:${entry.resourceId}`), [
      `editorial_context:${primary.context._id}`,
    ]);
  });
});

test("GenerationOptions returns no editorial sources for an actor without ownership or context.generate", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const { getGenerationOptionsProjection } = require("../services/generationOptionsV2.service");

    const owner = await User.create({ username: "options-owner-empty", passwordHash: "hash" });
    const viewer = await User.create({ username: "options-viewer-empty", passwordHash: "hash" });
    const organization = await Organization.create({ name: "Empty options organization", createdBy: owner._id });
    const primary = await createContext({ userId: owner._id, name: "Unlicensed" });
    const { venue } = await createReadyVenue({ userId: owner._id, organizationId: organization._id, primaryEditorialContextId: primary.context._id });

    const projection = await getGenerationOptionsProjection({ actorUserId: viewer._id, selectedVenueIds: [venue._id] });
    assert.deepEqual(projection.editorialScope.contentSpaces, []);
    assert.deepEqual(projection.editorialScope.defaultSources, []);
    assert.equal(projection.physicalScope.organizations.length, 1, "La disponibilità fisica della Venue non dipende dai diritti editoriali del viewer");
  });
});
