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

async function jsonFetch(url, { cookie = null, ...init } = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(url, { ...init, headers });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function createEditorialFixture({ seller }) {
  const Subject = require("../models/subject.model");
  const Namespace = require("../models/namespace.model");
  const NamespaceRevision = require("../models/namespaceRevision.model");
  const ContentSpace = require("../models/contentSpace.model");
  const EditorialContext = require("../models/editorialContext.model");
  const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
  const EditorialRelease = require("../models/editorialRelease.model");
  const ItemV2 = require("../models/itemV2.model");
  const ItemEdition = require("../models/itemEdition.model");
  const ItemRevisionV2 = require("../models/itemRevisionV2.model");

  const namespace = await Namespace.create({
    name: "Slice 1 namespace",
    ownerType: "user",
    ownerId: seller._id,
    createdBy: seller._id,
  });
  const namespaceRevision = await NamespaceRevision.create({
    namespaceId: namespace._id,
    version: 1,
    durationTypes: [{ definitionId: "dur-short", key: "short", label: "Breve", targetSeconds: 15 }],
    languageLevels: [{ definitionId: "lang-simple", key: "simple", label: "Semplice" }],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
    publication: { publishedAt: new Date(), publishedBy: seller._id },
    createdBy: seller._id,
    updatedBy: seller._id,
  });
  namespace.publishedRevisionId = namespaceRevision._id;
  await namespace.save();

  const contentSpace = await ContentSpace.create({
    name: "Slice 1 content space",
    ownerType: "user",
    ownerId: seller._id,
    createdBy: seller._id,
  });
  const context = await EditorialContext.create({
    contentSpaceId: contentSpace._id,
    namespaceId: namespace._id,
    displayName: "Slice 1 context",
    createdBy: seller._id,
  });
  const graphRevision = await SemanticGraphRevision.create({
    editorialContextId: context._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    createdBy: seller._id,
  });

  const bindings = [];
  const entries = [];
  for (const [index, label] of ["Primo contenuto", "Secondo contenuto"].entries()) {
    const subject = await Subject.create({ preferredLabel: `Subject ${index + 1}`, createdBy: seller._id });
    const item = await ItemV2.create({ primarySubjectId: subject._id, ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const edition = await ItemEdition.create({ itemId: item._id, namespaceId: namespace._id, createdBy: seller._id });
    const itemRevision = new ItemRevisionV2({
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label,
      authorCredits: ["Autore Slice 1"],
      metadata: { license: "CC BY" },
      presentationVariants: [{
        key: "standard",
        label: "Standard",
        semanticFocus: [{ subjectId: subject._id, weight: 1 }],
        representations: [{
          durationTypeDefinitionId: "dur-short",
          languageLevelDefinitionId: "lang-simple",
          locale: "it-IT",
          text: `${label}: testo mostrato dal Navigator`,
        }],
      }],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    itemRevision.defaultPresentation = {
      variantId: itemRevision.presentationVariants[0]._id,
      representationId: itemRevision.presentationVariants[0].representations[0]._id,
    };
    await itemRevision.save();
    edition.publishedRevisionId = itemRevision._id;
    await edition.save();
    bindings.push({ itemEditionId: edition._id, itemRevisionId: itemRevision._id, curationSignals: [] });
    entries.push({ itemId: item._id, itemEditionId: edition._id, itemRevisionId: itemRevision._id });
  }

  const release = await EditorialRelease.create({
    editorialContextId: context._id,
    version: 1,
    namespaceRevisionId: namespaceRevision._id,
    graphRevisionId: graphRevision._id,
    itemBindings: bindings,
    integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
    releasedAt: new Date(),
    releasedBy: seller._id,
  });
  context.publishedReleaseId = release._id;
  await context.save();
  return { release, entries };
}

test("Slice 1/2/3 API: acquisition, preparation e runtime Action versionato", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const app = require("../app");
    const User = require("../models/user");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const VisitSessionV2 = require("../models/visitSessionV2.model");
    const { hashPassword } = require("../services/auth.service");
    const { createVisitListing, createVisitExecuteOffer } = require("../services/marketplaceVisitV2.service");

    const seller = await User.create({ username: "slice1-seller", passwordHash: await hashPassword("12345678") });
    const buyer = await User.create({ username: "slice1-buyer", passwordHash: await hashPassword("12345678") });
    const editorial = await createEditorialFixture({ seller });
    const sourceId = new mongoose.Types.ObjectId();
    const visit = await VisitV2.create({ ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Catalog API Visit",
      description: "Visit per il test del primo vertical slice",
      editorialSources: [{ _id: sourceId, editorialReleaseId: editorial.release._id }],
      contentEntries: editorial.entries.map((entry) => ({
        editorialSourceId: sourceId,
        ...entry,
        deliveryAnchorId: null,
        role: "core",
      })),
      visitAnchors: [],
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
      publication: { publishedAt: new Date(), publishedBy: seller._id },
      createdBy: seller._id,
      updatedBy: seller._id,
    });
    visit.publishedRevisionId = revision._id;
    await visit.save();
    const listing = await createVisitListing({
      visitId: visit._id,
      sellerType: "user",
      sellerId: seller._id,
      actorUserId: seller._id,
    });
    const offer = await createVisitExecuteOffer({ listingId: listing._id, actorUserId: seller._id, payload: {} });

    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const login = await jsonFetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ username: buyer.username, password: "12345678" }),
      });
      assert.equal(login.response.status, 200);
      const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
      assert.ok(cookie, "Cookie di sessione mancante");

      const before = await jsonFetch(`${baseUrl}/api/v2/marketplace/catalog`, { cookie });
      assert.equal(before.response.status, 200);
      assert.equal(before.body.results.length, 1);
      assert.equal(before.body.results[0].viewerState.alreadyUsable, false);
      assert.equal(String(before.body.results[0].offers[0].id), String(offer._id));

      const acquisition = await jsonFetch(`${baseUrl}/api/v2/marketplace/offers/${offer._id}/acquire`, {
        cookie,
        method: "POST",
        body: JSON.stringify({ beneficiaryType: "user" }),
      });
      assert.equal(acquisition.response.status, 201);
      assert.equal(acquisition.body.grantedUses[0].capability, "visit.execute");

      const library = await jsonFetch(`${baseUrl}/api/v2/navigator/library`, { cookie });
      assert.equal(library.response.status, 200);
      assert.deepEqual(library.body.visits.map((entry) => entry.title), ["Catalog API Visit"]);
      assert.equal(String(library.body.visits[0].resolvedRevisionId), String(revision._id));

      const detail = await jsonFetch(`${baseUrl}/api/v2/navigator/visits/${visit._id}`, { cookie });
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.visit.title, "Catalog API Visit");
      assert.equal(String(detail.body.visit.resolvedRevisionId), String(revision._id));

      const preparation = await jsonFetch(`${baseUrl}/api/v2/execution-preparations`, {
        cookie,
        method: "POST",
        body: JSON.stringify({ visitId: visit._id }),
      });
      assert.equal(preparation.response.status, 201);
      assert.equal(String(preparation.body.preparation.source.visitRevisionId), String(revision._id));
      assert.equal(preparation.body.preparation.readiness.status, "ready");

      const updatedPreparation = await jsonFetch(`${baseUrl}/api/v2/execution-preparations/${preparation.body.preparation.id}`, {
        cookie,
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: preparation.body.preparation.version,
          movementPacePreference: 0.7,
          presentationPreference: { depthPreference: 0.8, languageComplexityPreference: 0.2 },
        }),
      });
      assert.equal(updatedPreparation.response.status, 200);
      assert.equal(updatedPreparation.body.preparation.version, 2);

      const revision2 = await VisitRevisionV2.create({
        visitId: visit._id,
        version: 2,
        basedOnRevisionId: revision._id,
        title: "Catalog API Visit aggiornata",
        editorialSources: revision.editorialSources,
        contentEntries: revision.contentEntries,
        visitAnchors: [],
        status: "published",
        integrity: { status: "valid", issues: [], checkedAt: new Date(), checkedBy: seller._id },
        publication: { publishedAt: new Date(), publishedBy: seller._id },
        createdBy: seller._id,
        updatedBy: seller._id,
      });
      await VisitRevisionV2.updateOne({ _id: revision._id }, { $set: { status: "superseded" } });
      visit.publishedRevisionId = revision2._id;
      await visit.save();

      const activePreparation = updatedPreparation.body.preparation;
      const start = await jsonFetch(`${baseUrl}/api/v2/execution-preparations/${activePreparation.id}/start`, {
        cookie,
        method: "POST",
        body: JSON.stringify({ expectedVersion: activePreparation.version }),
      });
      assert.equal(start.response.status, 201);
      assert.equal(String(start.body.session.visitRevisionId), String(revision._id), "preparation must keep its exact VisitRevision");
      assert.equal(start.body.current.current.label, "Primo contenuto");
      assert.equal(start.body.current.session.runtimeVersion, 1);
      assert.ok(start.body.current.availableActions.some((entry) => entry.actionId === "progress.next"));
      const sessionId = start.body.session._id;

      const removedAdvance = await jsonFetch(`${baseUrl}/api/v2/visit-sessions/${sessionId}/advance`, {
        cookie,
        method: "POST",
        body: JSON.stringify({ direction: "next" }),
      });
      assert.equal(removedAdvance.response.status, 404, "legacy advance endpoint must be unavailable");

      const unavailable = await jsonFetch(`${baseUrl}/api/v2/visit-sessions/${sessionId}/actions`, {
        cookie,
        method: "POST",
        body: JSON.stringify({
          actionId: "progress.previous",
          expectedRuntimeVersion: 1,
          interactionChannel: "button",
        }),
      });
      assert.equal(unavailable.response.status, 409);
      assert.equal(unavailable.body.errors[0].code, "ACTION_NOT_AVAILABLE");

      const next = await jsonFetch(`${baseUrl}/api/v2/visit-sessions/${sessionId}/actions`, {
        cookie,
        method: "POST",
        body: JSON.stringify({
          actionId: "progress.next",
          expectedRuntimeVersion: 1,
          interactionChannel: "controlled_voice",
        }),
      });
      assert.equal(next.response.status, 200);
      assert.equal(next.body.runtime.current.label, "Secondo contenuto");
      assert.equal(next.body.runtime.session.runtimeVersion, 2);
      assert.ok(next.body.runtime.availableActions.some((entry) => entry.actionId === "progress.previous"));

      const stale = await jsonFetch(`${baseUrl}/api/v2/visit-sessions/${sessionId}/actions`, {
        cookie,
        method: "POST",
        body: JSON.stringify({
          actionId: "progress.previous",
          expectedRuntimeVersion: 1,
          interactionChannel: "button",
        }),
      });
      assert.equal(stale.response.status, 409);
      assert.equal(stale.body.errors[0].code, "RUNTIME_VERSION_CONFLICT");

      const previous = await jsonFetch(`${baseUrl}/api/v2/visit-sessions/${sessionId}/actions`, {
        cookie,
        method: "POST",
        body: JSON.stringify({
          actionId: "progress.previous",
          expectedRuntimeVersion: 2,
          interactionChannel: "button",
        }),
      });
      assert.equal(previous.response.status, 200);
      assert.equal(previous.body.runtime.current.label, "Primo contenuto");
      assert.equal(previous.body.runtime.session.runtimeVersion, 3);

      const persistedSession = await VisitSessionV2.findById(sessionId).lean();
      const actionEvents = persistedSession.interactionEvents.filter((entry) => entry.category === "action");
      assert.equal(actionEvents.length, 3, "unavailable + two applied actions should be audited; stale version is not an action execution");
      assert.equal(actionEvents[0].result.status, "rejected");
      assert.equal(actionEvents[0].result.code, "ACTION_NOT_AVAILABLE");
      assert.equal(actionEvents[1].actionId, "progress.next");
      assert.equal(actionEvents[1].interactionChannel, "controlled_voice");
      assert.equal(actionEvents[1].result.status, "applied");
      assert.equal(actionEvents[2].actionId, "progress.previous");

      const discovery = await jsonFetch(`${baseUrl}/api/v2/navigator/sessions`, { cookie });
      assert.equal(discovery.response.status, 200);
      assert.equal(String(discovery.body.sessions[0].id), String(sessionId));
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
