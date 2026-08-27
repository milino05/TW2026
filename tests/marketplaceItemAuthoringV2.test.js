const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

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

async function createPublishedNamespace({ userId, name = "Namespace authoring" }) {
  const Namespace = require("../models/namespace.model");
  const NamespaceRevision = require("../models/namespaceRevision.model");
  const namespace = await Namespace.create({ name, ownerType: "user", ownerId: userId, createdBy: userId });
  const revision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [{ definitionId: "duration-short", key: "short", label: "Breve", targetSeconds: 60 }],
    languageLevels: [{ definitionId: "language-simple", key: "simple", label: "Semplice" }],
    presentationAspects: [{ definitionId: "aspect-story", key: "story", label: "Racconto" }],
    selectionSignals: [{ definitionId: "signal-core", key: "core", label: "Principale" }],
    relationTypes: [],
    subjectClasses: [],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: userId },
    publication: { publishedAt: new Date(), publishedBy: userId },
    createdBy: userId,
    updatedBy: userId,
  });
  namespace.publishedRevisionId = revision._id;
  await namespace.save();
  return { namespace, revision };
}

async function createEdition({ item, namespace, namespaceRevision, userId, label, status = "published", relatedSubjectIds = [], semanticFocus = [], knowledgeRequirements = [] }) {
  const ItemEdition = require("../models/itemEdition.model");
  const ItemRevisionV2 = require("../models/itemRevisionV2.model");
  const variantId = oid();
  const representationId = oid();
  const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: userId });
  const revision = await ItemRevisionV2.create({
    itemEditionId: edition._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    label,
    relatedSubjectIds,
    authorCredits: ["Autore demo"],
    metadata: { license: "CC BY" },
    selectionSignals: [{ definitionId: "signal-core", weight: 1 }],
    presentationVariants: [{
      _id: variantId,
      key: "default",
      label: "Default",
      semanticFocus,
      presentationAspects: [{ definitionId: "aspect-story", weight: 1 }],
      knowledgeRequirements,
      representations: [{
        _id: representationId,
        durationTypeDefinitionId: "duration-short",
        languageLevelDefinitionId: "language-simple",
        locale: "it-IT",
        text: "Testo di prova",
      }],
    }],
    defaultPresentation: { variantId, representationId },
    status,
    integrity: { status: status === "published" ? "valid" : "needs_review", issues: [] },
    publication: status === "published" ? { publishedAt: new Date(), publishedBy: userId } : {},
    createdBy: userId,
    updatedBy: userId,
  });
  if (status === "published") edition.publishedRevisionId = revision._id;
  else edition.workingRevisionId = revision._id;
  await edition.save();
  return { edition, revision };
}

test("two independent Items can share a non-physical Subject and ItemAuthoringProjection stays Venue-free", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const ContentSpace = require("../models/contentSpace.model");
    const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
    const { getItemAuthoringProjection } = require("../services/itemAuthoringV2.service");

    const user = await User.create({ username: "nonphysical-author", passwordHash: "hash" });
    const subject = await Subject.create({ preferredLabel: "Impressionismo", createdBy: user._id });
    const [itemA, itemB] = await ItemV2.create([
      { primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id },
      { primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id },
    ]);
    const { namespace, revision: namespaceRevision } = await createPublishedNamespace({ userId: user._id });
    const { edition } = await createEdition({
      item: itemA,
      namespace,
      namespaceRevision,
      userId: user._id,
      label: "L'Impressionismo in breve",
    });
    const space = await ContentSpace.create({ name: "Spazio personale", ownerType: "user", ownerId: user._id, createdBy: user._id });
    await ContentSpaceMembership.create({ contentSpaceId: space._id, itemId: itemA._id, addedBy: user._id });

    const projection = await getItemAuthoringProjection({ itemId: itemA._id, editionId: edition._id, actorUserId: user._id });
    assert.equal(projection.subject.preferredLabel, "Impressionismo");
    assert.equal(String(projection.lineage.id), String(itemA._id));
    assert.equal(projection.selected.revision.label, "L'Impressionismo in breve");
    assert.equal(projection.workspaceMemberships.length, 1);
    assert.equal(projection.workspaceMemberships[0].member, true);
    assert.equal(projection.venueId, undefined);
    assert.equal(projection.venueTargetId, undefined);
    assert.equal(projection.lineage.venueId, undefined);
    assert.equal(projection.lineage.venueTargetId, undefined);

    const siblings = await ItemV2.find({ primarySubjectId: subject._id }).select("_id").lean();
    assert.deepEqual(new Set(siblings.map((entry) => String(entry._id))), new Set([String(itemA._id), String(itemB._id)]));
  });
});

test("a draft without texts is persisted but fails the publication readiness check", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const itemService = require("../services/itemV2.service");
    const { checkEditionConsistency } = require("../services/itemAuthoringV2.service");

    const user = await User.create({ username: "textless-draft", passwordHash: "hash" });
    const subject = await Subject.create({ preferredLabel: "Bozza senza testo", createdBy: user._id });
    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
    const { namespace, revision: namespaceRevision } = await createPublishedNamespace({ userId: user._id });

    const created = await itemService.createEdition({
      itemId: item._id,
      actorUserId: user._id,
      payload: {
        namespaceId: namespace._id,
        authoredAgainstNamespaceRevisionId: namespaceRevision._id,
        revision: {
          label: "Bozza salvabile",
          authorCredits: ["Autore demo"],
          metadata: { license: "CC BY" },
          relatedSubjectIds: [],
          tags: [],
          illustrativeMedia: [],
          selectionSignals: [],
          presentationVariants: [{ key: "standard", label: "Standard", representations: [] }],
          defaultPresentation: null,
        },
      },
    });

    assert.equal(created.revision.presentationVariants[0].representations.length, 0);
    assert.equal(created.revision.defaultPresentation, null);

    const checked = await checkEditionConsistency({ editionId: created.edition._id, actorUserId: user._id });
    assert.equal(checked.revision.integrity.status, "needs_review");
    assert.deepEqual(checked.issues.map((issue) => issue.code), ["EMPTY_REPRESENTATIONS"]);
    await assert.rejects(
      () => itemService.publishEdition({ editionId: created.edition._id, actorUserId: user._id }),
      (error) => error?.status === 409,
    );
  });
});

test("a valid content check finalizes the edition as private without a separate publish action", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const ItemEdition = require("../models/itemEdition.model");
    const { checkEditionConsistency, getItemAuthoringProjection } = require("../services/itemAuthoringV2.service");

    const user = await User.create({ username: "private-after-check", passwordHash: "hash" });
    const subject = await Subject.create({ preferredLabel: "Contenuto controllato", createdBy: user._id });
    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
    const { namespace, revision: namespaceRevision } = await createPublishedNamespace({ userId: user._id });
    const { edition, revision } = await createEdition({
      item,
      namespace,
      namespaceRevision,
      userId: user._id,
      label: "Contenuto pronto",
      status: "draft",
    });

    const checked = await checkEditionConsistency({ editionId: edition._id, actorUserId: user._id });
    assert.equal(checked.finalized, true);
    assert.equal(checked.visibility, "private");
    assert.deepEqual(checked.issues, []);
    assert.equal(checked.revision.status, "published");

    const storedEdition = await ItemEdition.findById(edition._id).lean();
    assert.equal(storedEdition.workingRevisionId, null);
    assert.equal(String(storedEdition.publishedRevisionId), String(revision._id));

    const projection = await getItemAuthoringProjection({ itemId: item._id, editionId: edition._id, actorUserId: user._id });
    assert.equal(projection.publicationState.status, "private");
    assert.equal(projection.availableOperations.some((operation) => operation.code === "workflow.publish"), false);
    assert.equal(projection.availableOperations.some((operation) => operation.code === "workflow.check"), false);
  });
});

test("dangling relatedSubject, semanticFocus and knowledgeRequirement keep ItemRevision needs_review and block publish", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const itemService = require("../services/itemV2.service");
    const { checkEditionConsistency } = require("../services/itemAuthoringV2.service");

    const user = await User.create({ username: "subject-integrity", passwordHash: "hash" });
    const primary = await Subject.create({ preferredLabel: "Opera valida", createdBy: user._id });
    const item = await ItemV2.create({ primarySubjectId: primary._id, ownerType: "user", ownerId: user._id, createdBy: user._id });
    const { namespace, revision: namespaceRevision } = await createPublishedNamespace({ userId: user._id });
    const missingRelated = oid();
    const missingFocus = oid();
    const missingKnowledge = oid();
    const { edition } = await createEdition({
      item,
      namespace,
      namespaceRevision,
      userId: user._id,
      label: "Revision con Subject mancanti",
      status: "draft",
      relatedSubjectIds: [missingRelated],
      semanticFocus: [{ subjectId: missingFocus, weight: 1 }],
      knowledgeRequirements: [{ subjectId: missingKnowledge, minLevel: 0, maxLevel: 1, weight: 1 }],
    });

    const checked = await checkEditionConsistency({ editionId: edition._id, actorUserId: user._id });
    const subjectIssues = checked.issues.filter((issue) => issue.code === "SUBJECT_REFERENCE_NOT_FOUND");
    assert.equal(subjectIssues.length, 3);
    assert.equal(checked.revision.integrity.status, "needs_review");
    assert.deepEqual(
      new Set(subjectIssues.map((issue) => String(issue.context.subjectId))),
      new Set([String(missingRelated), String(missingFocus), String(missingKnowledge)]),
    );
    await assert.rejects(
      () => itemService.publishEdition({ editionId: edition._id, actorUserId: user._id }),
      (error) => error?.status === 409,
    );
  });
});

test("EditorialReleaseComposer exposes only ContentSpace members that the Context owner principal may use", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const ContentSpace = require("../models/contentSpace.model");
    const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
    const EditorialContext = require("../models/editorialContext.model");
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const { getEditorialReleaseComposer } = require("../services/editorialReleaseComposerV2.service");

    const owner = await User.create({ username: "composer-owner", passwordHash: "hash" });
    const external = await User.create({ username: "composer-external", passwordHash: "hash" });
    const [subjectOwned, subjectExternal, subjectNonMember] = await Subject.create([
      { preferredLabel: "Owned", createdBy: owner._id },
      { preferredLabel: "External", createdBy: external._id },
      { preferredLabel: "Non member", createdBy: owner._id },
    ]);
    const { namespace, revision: namespaceRevision } = await createPublishedNamespace({ userId: owner._id });
    const space = await ContentSpace.create({ name: "Context corpus", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const context = await EditorialContext.create({
      contentSpaceId: space._id,
      namespaceId: namespace._id,
      displayName: "Contesto demo",
      createdBy: owner._id,
    });
    const graph = await SemanticGraphRevision.create({
      editorialContextId: context._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      createdBy: owner._id,
    });
    context.workingGraphRevisionId = graph._id;
    await context.save();

    const ownedItem = await ItemV2.create({ primarySubjectId: subjectOwned._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const externalItem = await ItemV2.create({ primarySubjectId: subjectExternal._id, ownerType: "user", ownerId: external._id, createdBy: external._id });
    const nonMemberItem = await ItemV2.create({ primarySubjectId: subjectNonMember._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const ownedEdition = await createEdition({ item: ownedItem, namespace, namespaceRevision, userId: owner._id, label: "Owned content" });
    await createEdition({ item: externalItem, namespace, namespaceRevision, userId: external._id, label: "External content" });
    await createEdition({ item: nonMemberItem, namespace, namespaceRevision, userId: owner._id, label: "Non-member content" });
    await ContentSpaceMembership.create([
      { contentSpaceId: space._id, itemId: ownedItem._id, addedBy: owner._id },
      { contentSpaceId: space._id, itemId: externalItem._id, addedBy: owner._id },
    ]);

    const projection = await getEditorialReleaseComposer({ editorialContextId: context._id, actorUserId: owner._id });
    assert.equal(projection.context.name, "Contesto demo");
    assert.equal(String(projection.releaseInputs.namespaceRevisionId), String(namespaceRevision._id));
    assert.equal(String(projection.releaseInputs.graphRevisionId), String(graph._id));
    assert.equal(projection.candidates.length, 1);
    assert.equal(projection.candidates[0].title, "Owned content");
    assert.equal(String(projection.candidates[0].itemEditionId), String(ownedEdition.edition._id));
    assert.equal(projection.candidates[0].accessBasis, "ownership");
  });
});
