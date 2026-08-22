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

test("Slice 1 API: login, catalog, free acquisition, Library e Detail", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const app = require("../app");
    const User = require("../models/user");
    const VisitV2 = require("../models/visitV2.model");
    const VisitRevisionV2 = require("../models/visitRevisionV2.model");
    const { hashPassword } = require("../services/auth.service");
    const { createVisitListing, createVisitExecuteOffer } = require("../services/marketplaceVisitV2.service");

    const seller = await User.create({ username: "slice1-seller", passwordHash: await hashPassword("12345678") });
    const buyer = await User.create({ username: "slice1-buyer", passwordHash: await hashPassword("12345678") });
    const visit = await VisitV2.create({ ownerType: "user", ownerId: seller._id, createdBy: seller._id });
    const revision = await VisitRevisionV2.create({
      visitId: visit._id,
      version: 1,
      title: "Catalog API Visit",
      description: "Visit per il test del primo vertical slice",
      editorialSources: [],
      contentEntries: [],
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
      assert.equal(acquisition.body.entitlements[0].capability, "visit.execute");

      const after = await jsonFetch(`${baseUrl}/api/v2/marketplace/catalog`, { cookie });
      assert.equal(after.response.status, 200);
      assert.equal(after.body.results[0].viewerState.alreadyUsable, true);

      const library = await jsonFetch(`${baseUrl}/api/v2/navigator/library`, { cookie });
      assert.equal(library.response.status, 200);
      assert.deepEqual(library.body.visits.map((entry) => entry.title), ["Catalog API Visit"]);

      const detail = await jsonFetch(`${baseUrl}/api/v2/navigator/visits/${visit._id}`, { cookie });
      assert.equal(detail.response.status, 200);
      assert.equal(detail.body.visit.title, "Catalog API Visit");
      assert.equal(detail.body.preparation.available, true);
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
