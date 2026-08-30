const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { createPublishedPhysicalVocabulary } = require("./helpers/physicalVocabulary");

const baseMongoUri = process.env.MONGO_URI;
function isolatedMongoUri(uri) {
  if (!uri) return null;
  const parsed = new URL(uri);
  const dbName = parsed.pathname.replace(/^\/+/, "") || "artaround_test";
  parsed.pathname = `/${dbName}_generator_v2`;
  return parsed.toString();
}
const mongoUri = isolatedMongoUri(baseMongoUri);
function loadAllModels() {
  const modelsDir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(modelsDir)) if (file.endsWith(".js")) require(path.join(modelsDir, file));
}
async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try { await mongoose.connection.dropDatabase(); return await callback(); }
  finally { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); }
}

test("generator v2 resolves Venue primary Context, pins releases and creates VenueTarget anchors", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const Namespace = require("../models/namespace.model");
    const NamespaceRevision = require("../models/namespaceRevision.model");
    const ContentSpace = require("../models/contentSpace.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const ItemRevisionV2 = require("../models/itemRevisionV2.model");
    const EditorialRelease = require("../models/editorialRelease.model");
    const Venue = require("../models/venue.model");
    const VenueTarget = require("../models/venueTarget.model");
    const LayoutRevision = require("../models/layoutRevision.model");
    const VenueRelease = require("../models/venueRelease.model");
    const GeneratedVisitPlanV2 = require("../models/generatedVisitPlanV2.model");
    const { generateVisitPlanV2 } = require("../services/visitGeneratorV2.service");

    const user = await User.create({ username: "generator-v2-test", passwordHash: "test-hash" });
    const organization = await Organization.create({ name: "Generator Org", createdBy: user._id });
    const subject = await Subject.create({ preferredLabel: "Opera target", createdBy: user._id });
    const namespace = await Namespace.create({ name: "Generator Namespace", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      durationTypes: [{ definitionId: "duration-medium", key: "medium", label: "Medio", targetSeconds: 60 }],
      languageLevels: [{ definitionId: "language-medium", key: "medium", label: "Medio" }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const contentSpace = await ContentSpace.create({ name: "Generator Space", ownerType: "user", ownerId: user._id, createdBy: user._id });
    const context = await EditorialContext.create({ contentSpaceId: contentSpace._id, namespaceId: namespace._id, displayName: "Generator Context", shortDescription: "Test", createdBy: user._id });
    const graphRevision = await SemanticGraphRevision.create({ editorialContextId: context._id, version: 1, authoredAgainstNamespaceRevisionId: namespaceRevision._id, createdBy: user._id });
    await GraphSubjectBinding.create({ graphRevisionId: graphRevision._id, subjectId: subject._id, subjectClassDefinitionIds: [] });
    context.workingGraphRevisionId = graphRevision._id;
    await context.save();

    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: user._id });
    const variantId = new mongoose.Types.ObjectId(), representationId = new mongoose.Types.ObjectId();
    const itemRevision = await ItemRevisionV2.create({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: "Descrizione generabile",
      authorCredits: ["Autore"],
      metadata: { license: "CC BY" },
      presentationVariants: [{
        _id: variantId,
        key: "standard",
        label: "Standard",
        semanticFocus: [{ subjectId: subject._id, weight: 1 }],
        representations: [{ _id: representationId, durationTypeDefinitionId: "duration-medium", languageLevelDefinitionId: "language-medium", locale: "it-IT", text: "Descrizione generata per il test." }],
      }],
      defaultPresentation: { variantId, representationId },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    edition.publishedRevisionId = itemRevision._id;
    await edition.save();

    const editorialRelease = await EditorialRelease.create({
      editorialContextId: context._id,
      version: 1,
      namespaceRevisionId: namespaceRevision._id,
      graphRevisionId: graphRevision._id,
      itemBindings: [{ itemEditionId: edition._id, itemRevisionId: itemRevision._id, curationSignals: [] }],
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      releasedAt: new Date(),
      releasedBy: user._id,
    });
    context.publishedReleaseId = editorialRelease._id;
    await context.save();

    const venue = await Venue.create({ name: "Generator Venue", ownerOrganizationId: organization._id, primaryEditorialContextId: context._id, createdBy: user._id });
    const ExhibitSlot = require("../models/exhibitSlot.model");
    const target = await VenueTarget.create({ venueId: venue._id, subjectId: subject._id, displayLabelOverride: "Opera fisica", createdBy: user._id });
    const slot = await ExhibitSlot.create({ venueId: venue._id, createdBy: user._id });
    const physical = await createPublishedPhysicalVocabulary({ userId: user._id });
    const floorId = new mongoose.Types.ObjectId();
    const placeId = new mongoose.Types.ObjectId();
    const layout = await LayoutRevision.create({
      venueId: venue._id,
      version: 1,
      authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
      floors: [{ _id: floorId, label: "Piano terra" }],
      places: [{ _id: placeId, placeTypeDefinitionId: physical.placeTypeByKey.get("room").definitionId, label: "Sala 1", floorId, position: { x: 0.5, y: 0.5 } }],
      exhibitSlots: [{ exhibitSlotId: slot._id, placeId, label: "Slot opera" }],
      connections: [],
      status: "published",
      createdBy: user._id,
      updatedBy: user._id,
    });
    const venueRelease = await VenueRelease.create({
      venueId: venue._id,
      version: 1,
      layoutRevisionId: layout._id,
      targetBindings: [{ venueTargetId: target._id, exhibitSlotId: slot._id, availability: "active", recognitionMedia: [] }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: user._id },
      publication: { publishedAt: new Date(), publishedBy: user._id },
      createdBy: user._id,
      updatedBy: user._id,
    });
    venue.publishedReleaseId = venueRelease._id;
    await venue.save();

    const plan = await generateVisitPlanV2({ userId: user._id, request: { venueIds: [venue._id], timeBudgetSeconds: 900, locale: "it-IT", historyMode: "current_request_only" } });
    assert.equal(plan.contentEntries.length, 1);
    assert.equal(plan.visitAnchors.length, 1);
    assert.equal(String(plan.visitAnchors[0].venueTargetId), String(target._id));
    assert.equal(String(plan.visitAnchors[0].exhibitSlotId), String(slot._id));
    assert.match(plan.visitAnchors[0].approachInstruction, /Slot opera|Sala 1/);
    assert.equal(String(plan.contentEntries[0].itemEditionId), String(edition._id));
    assert.equal(String(plan.contentEntries[0].deliveryAnchorId), String(plan.visitAnchors[0]._id));
    assert.equal(String(plan.sourceEditorialReleaseIds[0]), String(editorialRelease._id));
    assert.equal(String(plan.sourceVenueReleaseIds[0]), String(venueRelease._id));
    assert.equal(String(plan.sourceLayoutRevisionIds[0]), String(layout._id));
    assert.equal(plan.requestSnapshot.editorialScopeSource, "venue_primary_defaults");
    assert.equal(plan.museumId, undefined);
    assert.equal(await GeneratedVisitPlanV2.countDocuments({ userId: user._id }), 1);
  });
});
