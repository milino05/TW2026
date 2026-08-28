const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;

async function withFreshDatabase(callback) {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try { await mongoose.connection.dropDatabase(); return await callback(); }
  finally { await mongoose.connection.dropDatabase().catch(() => {}); await mongoose.disconnect(); }
}

test("item authoring crea, proietta e rimuove collegamenti tramite revisioni immutabili del grafo", { skip: !mongoUri }, async () => {
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
    const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
    const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
    const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
    const connections = require("../services/itemConnectionAuthoringV2.service");
    const { removeOwnedWorkspaceResource } = require("../services/marketplaceResourceRemovalV2.service");

    const owner = await User.create({ username: "connection-author", passwordHash: "test-hash" });
    const [sourceSubject, targetSubject] = await Subject.create([
      { preferredLabel: "Opera di partenza", createdBy: owner._id },
      { preferredLabel: "Autore collegato", createdBy: owner._id },
    ]);
    const namespace = await Namespace.create({ name: "Regole con relazioni", ownerType: "user", ownerId: owner._id, createdBy: owner._id });
    const namespaceRevision = await NamespaceRevision.create({
      namespaceId: namespace._id,
      version: 1,
      subjectClasses: [
        { definitionId: "class-work", key: "work", label: "Opera" },
        { definitionId: "class-person", key: "person", label: "Persona" },
      ],
      relationTypes: [{
        definitionId: "relation-created-by",
        key: "created_by",
        label: "Creata da",
        description: "Indica chi ha realizzato l’opera.",
        domainDefinitionIds: ["class-work"],
        rangeDefinitionIds: ["class-person"],
        directionality: "directed",
        strength: "strong",
        validationRules: { allowMultiple: true, targetRequired: true },
      }],
      durationTypes: [{ definitionId: "duration-short", key: "short", label: "Breve", targetSeconds: 60 }],
      languageLevels: [{ definitionId: "language-simple", key: "simple", label: "Semplice" }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: owner._id },
      publication: { publishedAt: new Date(), publishedBy: owner._id },
      createdBy: owner._id,
      updatedBy: owner._id,
    });
    namespace.publishedRevisionId = namespaceRevision._id;
    await namespace.save();

    const [sourceItem, targetItem] = await ItemV2.create([
      { primarySubjectId: sourceSubject._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
      { primarySubjectId: targetSubject._id, ownerType: "user", ownerId: owner._id, createdBy: owner._id },
    ]);
    async function edition(item, label) {
      const result = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: owner._id });
      const revision = await ItemRevisionV2.create({
        itemEditionId: result._id,
        version: 1,
        authoredAgainstNamespaceRevisionId: namespaceRevision._id,
        label,
        authorCredits: [owner.username],
        metadata: { license: "CC BY 4.0" },
        presentationVariants: [{ key: "standard", label: "Standard", representations: [] }],
        createdBy: owner._id,
        updatedBy: owner._id,
      });
      result.workingRevisionId = revision._id;
      await result.save();
      return result;
    }
    const sourceEdition = await edition(sourceItem, "La grande opera");
    await edition(targetItem, "Biografia dell’autore");

    const initial = await connections.getItemConnectionAuthoring({ itemId: sourceItem._id, editionId: sourceEdition._id, actorUserId: owner._id });
    assert.equal(initial.connections.length, 0);
    assert.equal(initial.scopes.length, 1);
    assert.equal(initial.scopes[0].key, "new");
    assert.equal(initial.relationTypes[0].label, "Creata da");

    const search = await connections.searchItemConnectionTargets({
      itemId: sourceItem._id,
      editionId: sourceEdition._id,
      query: "biografia",
      actorUserId: owner._id,
    });
    assert.equal(search.results.length, 1);
    assert.equal(String(search.results[0].id), String(targetItem._id));

    const created = await connections.createItemConnection({
      itemId: sourceItem._id,
      editionId: sourceEdition._id,
      actorUserId: owner._id,
      payload: {
        scopeKey: "new",
        relationTypeDefinitionId: "relation-created-by",
        targetItemId: targetItem._id,
        weight: 8,
        provenanceOrigin: "human",
        note: "Attribuzione verificata dal curatore.",
      },
    });
    assert.equal(created.connections.length, 1);
    assert.equal(created.connections[0].relationType.label, "Creata da");
    assert.equal(created.connections[0].targetContent.title, "Biografia dell’autore");
    assert.equal(created.connections[0].weight, 8);
    assert.equal(created.connections[0].note, "Attribuzione verificata dal curatore.");
    assert.equal(await ContentSpace.countDocuments(), 1);
    assert.equal(await EditorialContext.countDocuments(), 1);
    assert.equal(await ContentSpaceMembership.countDocuments(), 2);
    assert.equal(await SemanticGraphRevision.countDocuments(), 1);
    const firstEdge = await SemanticEdgeV2.findOne().lean();
    assert.equal(String(firstEdge.sourceSubjectId), String(sourceSubject._id));
    assert.equal(String(firstEdge.targetSubjectId), String(targetSubject._id));
    assert.equal(firstEdge.relationTypeDefinitionId, "relation-created-by");
    const bindings = await GraphSubjectBinding.find().sort({ subjectId: 1 }).lean();
    const classesBySubject = new Map(bindings.map((entry) => [String(entry.subjectId), entry.subjectClassDefinitionIds]));
    assert.deepEqual(classesBySubject.get(String(sourceSubject._id)), ["class-work"]);
    assert.deepEqual(classesBySubject.get(String(targetSubject._id)), ["class-person"]);

    const removed = await connections.removeItemConnection({
      itemId: sourceItem._id,
      editionId: sourceEdition._id,
      connectionId: created.connections[0].id,
      contextId: created.connections[0].contextId,
      actorUserId: owner._id,
    });
    assert.equal(removed.connections.length, 0);
    assert.equal(await SemanticGraphRevision.countDocuments(), 2);
    assert.equal(await SemanticEdgeV2.countDocuments(), 1, "la revisione precedente resta immutabile");
    const context = await EditorialContext.findOne().lean();
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: context.workingGraphRevisionId }), 0);

    const beforeTrash = await connections.createItemConnection({
      itemId: sourceItem._id,
      editionId: sourceEdition._id,
      actorUserId: owner._id,
      payload: {
        scopeKey: `context:${context._id}`,
        relationTypeDefinitionId: "relation-created-by",
        targetItemId: targetItem._id,
      },
    });
    assert.equal(beforeTrash.connections.length, 1);
    await removeOwnedWorkspaceResource({
      actorUserId: owner._id,
      resourceType: "editorial_context",
      resourceId: context._id,
    });
    const afterTrash = await connections.getItemConnectionAuthoring({
      itemId: sourceItem._id,
      editionId: sourceEdition._id,
      actorUserId: owner._id,
    });
    assert.equal(afterTrash.connections.length, 0);
    assert.match(afterTrash.scopes[0].key, /^space:/);

    const afterReuse = await connections.createItemConnection({
      itemId: sourceItem._id,
      editionId: sourceEdition._id,
      actorUserId: owner._id,
      payload: {
        scopeKey: afterTrash.scopes[0].key,
        relationTypeDefinitionId: "relation-created-by",
        targetItemId: targetItem._id,
      },
    });
    assert.equal(afterReuse.connections.length, 1, "il vecchio collegamento non viene ripristinato insieme a quello nuovo");
    const reusedContext = await EditorialContext.findById(context._id).lean();
    assert.equal(reusedContext.lifecycleStatus, "active");
    assert.equal(reusedContext.publishedReleaseId, null);
    assert.equal(await SemanticEdgeV2.countDocuments({ graphRevisionId: reusedContext.workingGraphRevisionId }), 1);
  });
});
