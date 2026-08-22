const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

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

test("context.import_snapshot crea workspace detached riusando Subject e Item esterni", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const ContentSpace = require("../models/contentSpace.model");
    const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
    const EditorialContext = require("../models/editorialContext.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const { Adoption } = require("../models/adoption.model");
    const { createListing, createOffer, acquireOffer } = require("../services/marketplaceV2.service");
    const { importEditorialContextSnapshot } = require("../services/marketplaceContextImportV2.service");

    const [seller, buyer] = await User.create([
      { username: "context-import-seller", passwordHash: "test-hash" },
      { username: "context-import-buyer", passwordHash: "test-hash" },
    ]);
    const [subjectA, subjectB] = await Subject.create([
      { preferredLabel: "Opera importata", createdBy: seller._id },
      { preferredLabel: "Concetto collegato", createdBy: seller._id },
    ]);
    const namespace = await Namespace.create({ name: "Namespace import", ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id, version: 1,
      durationTypes: [], languageLevels: [], presentationAspects: [],
      relationTypes: [{ definitionId: "related", key: "related", label: "Collegato", domainSubjectClassDefinitionIds: [], rangeSubjectClassDefinitionIds: [] }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id, updatedBy: seller._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const item = await ItemV2.create({ primarySubjectId: subjectA._id, ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: seller._id });
    const itemRevision = await ItemRevisionV2.create({
      itemEditionId: edition._id, version: 1, authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Contenuto importato", presentationVariants: [], status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id }, createdBy: seller._id, updatedBy: seller._id,
    });
    edition.publishedRevisionId = itemRevision._id;
    await edition.save();

    const sourceSpace = await ContentSpace.create({ name: "Source space", ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    await ContentSpaceMembership.create({ contentSpaceId: sourceSpace._id, itemId: item._id, addedBy: seller._id });
    const sourceContext = await EditorialContext.create({ contentSpaceId: sourceSpace._id, namespaceId: namespace._id, displayName: "Source context", createdBy: seller._id });
    const sourceGraph = await SemanticGraphRevision.create({
      editorialContextId: sourceContext._id, version: 1, authoredAgainstNamespaceRevisionId: namespaceRevision._id, createdBy: seller._id,
    });
    await GraphSubjectBinding.create([
      { graphRevisionId: sourceGraph._id, subjectId: subjectA._id, subjectClassDefinitionIds: [] },
      { graphRevisionId: sourceGraph._id, subjectId: subjectB._id, subjectClassDefinitionIds: [] },
    ]);
    await SemanticEdgeV2.create({
      graphRevisionId: sourceGraph._id,
      sourceSubjectId: subjectA._id,
      targetSubjectId: subjectB._id,
      relationTypeDefinitionId: "related",
      weight: 1,
      provenance: { origin: "human" },
    });
    const sourceRelease = await EditorialRelease.create({
      editorialContextId: sourceContext._id,
      version: 1,
      namespaceRevisionId: namespaceRevision._id,
      graphRevisionId: sourceGraph._id,
      itemBindings: [{ itemEditionId: edition._id, itemRevisionId: itemRevision._id }],
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      releasedAt: new Date(), releasedBy: seller._id,
    });
    sourceContext.workingGraphRevisionId = sourceGraph._id;
    sourceContext.publishedReleaseId = sourceRelease._id;
    await sourceContext.save();

    const listing = await createListing({ resourceType: "editorial_context", resourceId: sourceContext._id, sellerType: "user", sellerId: seller._id, actorUserId: seller._id });
    const offer = await createOffer({
      listingId: listing._id,
      actorUserId: seller._id,
      payload: {
        pricing: { type: "free" },
        grants: [
          { resourceType: "editorial_context", resourceId: sourceContext._id, capability: "context.import_snapshot", versionPolicy: "pin_at_acquisition" },
          { resourceType: "namespace", resourceId: namespace._id, capability: "namespace.author", versionPolicy: "pin_at_acquisition" },
        ],
      },
    });
    await acquireOffer({ offerId: offer._id, actorUserId: buyer._id });

    const beforeSubjectCount = await Subject.countDocuments();
    const imported = await importEditorialContextSnapshot({
      sourceEditorialContextId: sourceContext._id,
      ownerType: "user",
      ownerId: buyer._id,
      actorUserId: buyer._id,
      contentSpaceName: "Buyer imported space",
      displayName: "Buyer imported context",
    });

    const targetSpace = await ContentSpace.findById(imported.contentSpace.id).lean();
    const targetContext = await EditorialContext.findById(imported.editorialContext.id).lean();
    assert.equal(String(targetSpace.ownerId), String(buyer._id));
    assert.equal(targetSpace.ownerType, "user");
    assert.equal(targetContext.displayName, "Buyer imported context");
    assert.equal(targetContext.publishedReleaseId, null, "import must not fabricate a published release");
    assert.equal(String(targetContext.namespaceId), String(namespace._id));
    assert.equal(await Subject.countDocuments(), beforeSubjectCount, "Subject identities must be reused, not copied");

    const memberships = await ContentSpaceMembership.find({ contentSpaceId: targetSpace._id }).lean();
    assert.deepEqual(memberships.map((entry) => String(entry.itemId)), [String(item._id)]);
    assert.equal(String(item.ownerId), String(seller._id), "external Item ownership must stay unchanged");

    const bindings = await GraphSubjectBinding.find({ graphRevisionId: targetContext.workingGraphRevisionId }).lean();
    const edges = await SemanticEdgeV2.find({ graphRevisionId: targetContext.workingGraphRevisionId }).lean();
    assert.deepEqual(new Set(bindings.map((entry) => String(entry.subjectId))), new Set([String(subjectA._id), String(subjectB._id)]));
    assert.equal(edges.length, 1);
    assert.equal(edges[0].provenance.origin, "imported");
    assert.equal(String(edges[0].provenance.sourceGraphRevisionId), String(sourceGraph._id));

    const adoptions = await Adoption.find({ beneficiaryId: buyer._id }).sort({ action: 1 }).lean();
    assert.deepEqual(adoptions.map((entry) => entry.action).sort(), ["context_import", "namespace_use"]);
    const contextImport = adoptions.find((entry) => entry.action === "context_import");
    assert.equal(String(contextImport.sourceSnapshotRef.resourceId), String(sourceRelease._id));
    assert.equal(String(contextImport.resultResourceRef.resourceId), String(targetContext._id));
  });
});
