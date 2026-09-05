const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { assignStarterRole } = require("./helpers/organizationRbac");

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

test("Contributor creates an Item in a visible Organization ContentSpace without space-manage permission", { skip: !mongoUri }, async () => {
  await withFreshDatabase(async () => {
    const User = require("../models/user");
    const Organization = require("../models/organization.model");
    const Subject = require("../models/subject.model");
    const ItemV2 = require("../models/itemV2.model");
    const ContentSpace = require("../models/contentSpace.model");
    const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
    const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
    const { createItem } = require("../services/itemInstantiationV2.service");

    const [admin, contributor, outsider] = await User.create([
      { username: "instantiation-admin", passwordHash: "test-hash" },
      { username: "instantiation-contributor", passwordHash: "test-hash" },
      { username: "instantiation-outsider", passwordHash: "test-hash" },
    ]);
    const organization = await Organization.create({ name: "Editorial organization", createdBy: admin._id });
    await assignStarterRole({ organization, user: admin, starterKey: "administrator" });
    await assignStarterRole({ organization, user: contributor, starterKey: "contributor" });

    const subject = await Subject.create({ preferredLabel: "Subject contributor", createdBy: admin._id });
    const organizationSpace = await ContentSpace.create({
      name: "Organization editorial space",
      ownerType: "organization",
      ownerId: organization._id,
      createdBy: admin._id,
    });
    const outsiderSpace = await ContentSpace.create({
      name: "Outsider personal space",
      ownerType: "user",
      ownerId: outsider._id,
      createdBy: outsider._id,
    });

    const item = await createItem({
      payload: {
        primarySubjectId: subject._id,
        ownerType: "organization",
        ownerId: organization._id,
        contentSpaceId: organizationSpace._id,
      },
      actorUserId: contributor._id,
    });

    assert.equal(String(item.ownerId), String(organization._id));
    assert.equal(
      await ContentSpaceItemMembership.countDocuments({ contentSpaceId: organizationSpace._id, itemId: item._id }),
      1,
    );
    assert.equal(
      await ContentSpaceSubjectMembership.countDocuments({ contentSpaceId: organizationSpace._id, subjectId: subject._id }),
      1,
    );

    await assert.rejects(
      () => createItem({
        payload: {
          primarySubjectId: subject._id,
          ownerType: "organization",
          ownerId: organization._id,
          contentSpaceId: outsiderSpace._id,
        },
        actorUserId: contributor._id,
      }),
      (error) => error?.status === 409 && error?.details?.some((detail) => detail.code === "CONTENT_SPACE_OWNER_MISMATCH"),
    );
    assert.equal(await ItemV2.countDocuments({ ownerType: "organization", ownerId: organization._id }), 1);
  });
});
