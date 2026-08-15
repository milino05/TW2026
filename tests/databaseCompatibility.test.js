const fs = require("fs");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI;

function loadAllModels() {
  const modelsDir = path.join(__dirname, "..", "models");
  for (const file of fs.readdirSync(modelsDir)) {
    if (file.endsWith(".js")) require(path.join(modelsDir, file));
  }
}

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

test("MongoDB 7 accepts every current Mongoose schema and index", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const ping = await mongoose.connection.db.admin().command({ ping: 1 });
    assert.equal(ping.ok, 1);

    loadAllModels();
    const modelNames = mongoose.modelNames();
    assert.ok(modelNames.length > 0, "Nessun modello Mongoose caricato");

    for (const modelName of modelNames) {
      await mongoose.model(modelName).init();
    }
  });
});

test("museum deletion refuses canonical dependent resources", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    loadAllModels();
    const User = require("../models/user");
    const Museum = require("../models/museum.model");
    const MuseumLayout = require("../models/museumLayout.model");
    const { deleteMuseum } = require("../services/museum.service");

    const user = await User.create({ username: "museum-delete-test", passwordHash: "test-hash" });
    const museum = await Museum.create({ name: "Delete Guard Museum", createdBy: user._id });
    user.memberships.push({ museumId: museum._id, role: "manager", assignedBy: user._id });
    await user.save();
    await MuseumLayout.create({ museumId: museum._id, createdBy: user._id });

    await assert.rejects(
      () => deleteMuseum({ museumId: museum._id, actorUserId: user._id }),
      (error) => error?.status === 409 && error?.details?.[0]?.code === "MUSEUM_HAS_DEPENDENCIES",
    );

    assert.ok(await Museum.exists({ _id: museum._id }), "Il museo non deve essere eliminato se ha dipendenze");
  });
});
