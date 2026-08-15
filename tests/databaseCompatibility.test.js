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

test("MongoDB 7 accepts every current Mongoose schema and index", { skip: !mongoUri }, async () => {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    const ping = await mongoose.connection.db.admin().command({ ping: 1 });
    assert.equal(ping.ok, 1);

    loadAllModels();
    const modelNames = mongoose.modelNames();
    assert.ok(modelNames.length > 0, "Nessun modello Mongoose caricato");

    for (const modelName of modelNames) {
      await mongoose.model(modelName).init();
    }
  } finally {
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
