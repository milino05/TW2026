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

test("item creation is reuse-first and distinct lineage requires explicit intent", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const ContentSpace = require("../models/contentSpace.model");
    const { createItem } = require("../services/itemCreationV2.service");

    const user = await User.create({ username: "reuse-first-user", passwordHash: "test-hash" });
    const space = await ContentSpace.create({
      name: "Spazio editoriale",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const bedoli = await Subject.create({ preferredLabel: "Girolamo Bedoli", createdBy: user._id });

    const first = await createItem({
      payload: {
        primarySubjectId: bedoli._id,
        ownerType: "user",
        ownerId: user._id,
        contentSpaceId: space._id,
      },
      actorUserId: user._id,
    });
    assert.ok(first._id);

    await assert.rejects(
      () => createItem({
        payload: {
          primarySubjectId: bedoli._id,
          ownerType: "user",
          ownerId: user._id,
          contentSpaceId: space._id,
        },
        actorUserId: user._id,
      }),
      (error) => error?.status === 409
        && error?.details?.some((detail) => detail.code === "ITEM_REUSE_AVAILABLE"
          && detail.context?.candidates?.some((candidate) => candidate.matchReason === "exact_subject")),
    );
    assert.equal(await ItemV2.countDocuments({ ownerType: "user", ownerId: user._id }), 1);

    const distinct = await createItem({
      payload: {
        primarySubjectId: bedoli._id,
        ownerType: "user",
        ownerId: user._id,
        contentSpaceId: space._id,
        creationMode: "distinct_lineage",
      },
      actorUserId: user._id,
    });
    assert.notEqual(String(distinct._id), String(first._id));
    assert.equal(await ItemV2.countDocuments({ ownerType: "user", ownerId: user._id }), 2);
  });
});

test("same-label Subject is treated as a potential reuse instead of creating silently", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const ContentSpace = require("../models/contentSpace.model");
    const { createItem } = require("../services/itemCreationV2.service");
    const { getItemAddContext } = require("../services/contentSpaceItemAddContext.service");

    const user = await User.create({ username: "reuse-label-user", passwordHash: "test-hash" });
    const space = await ContentSpace.create({
      name: "Spazio editoriale",
      ownerType: "user",
      ownerId: user._id,
      createdBy: user._id,
    });
    const [canonical, duplicateLabel] = await Subject.create([
      { preferredLabel: "Girolamo Bedoli", description: "Pittore", createdBy: user._id },
      { preferredLabel: "girolamo bedoli", description: "Possibile duplicato locale", createdBy: user._id },
    ]);

    const existing = await createItem({
      payload: {
        primarySubjectId: canonical._id,
        ownerType: "user",
        ownerId: user._id,
        contentSpaceId: space._id,
      },
      actorUserId: user._id,
    });

    const context = await getItemAddContext({
      contentSpaceId: space._id,
      subjectId: duplicateLabel._id,
      actorUserId: user._id,
    });
    assert.equal(context.ownedItems.length, 1);
    assert.equal(String(context.ownedItems[0].id), String(existing._id));
    assert.equal(context.ownedItems[0].matchReason, "same_label");
    assert.equal(context.marketplaceOptions.length, 0);

    await assert.rejects(
      () => createItem({
        payload: {
          primarySubjectId: duplicateLabel._id,
          ownerType: "user",
          ownerId: user._id,
          contentSpaceId: space._id,
        },
        actorUserId: user._id,
      }),
      (error) => error?.status === 409
        && error?.details?.some((detail) => detail.code === "ITEM_REUSE_AVAILABLE"
          && detail.context?.candidates?.some((candidate) => candidate.matchReason === "same_label")),
    );
    assert.equal(await ItemV2.countDocuments({ ownerType: "user", ownerId: user._id }), 1);
  });
});
