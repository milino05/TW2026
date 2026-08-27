const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const { ensureStarterRoles, replaceMembershipWithStarterRole } = require("../services/organizationBootstrap.service");

async function migrateOrganizationRbac() {
  const rawUsers = mongoose.connection.collection("users");
  const legacyUsers = await rawUsers.find({ "organizationMemberships.0": { $exists: true } }).toArray();
  const legacyByOrganization = new Map();
  for (const user of legacyUsers) {
    for (const membership of user.organizationMemberships || []) {
      const key = String(membership.organizationId);
      const entries = legacyByOrganization.get(key) || [];
      entries.push({ userId: user._id, legacyRole: membership.role, assignedAt: membership.assignedAt });
      legacyByOrganization.set(key, entries);
    }
  }

  const organizations = await Organization.find({}).select("_id createdBy createdAt owners");
  for (const organization of organizations) {
    await mongoose.connection.transaction(async (session) => {
      const actorUserId = organization.createdBy;
      if (!organization.owners?.length) {
        await Organization.updateOne(
          { _id: organization._id },
          { $set: { owners: [{ userId: actorUserId, grantedBy: actorUserId, grantedAt: organization.createdAt || new Date() }] } },
          { session, runValidators: true },
        );
      }
      await ensureStarterRoles({ organizationId: organization._id, actorUserId, session });
      const entries = legacyByOrganization.get(String(organization._id)) || [];
      if (!entries.some((entry) => String(entry.userId) === String(actorUserId))) {
        entries.push({ userId: actorUserId, legacyRole: "manager", assignedAt: organization.createdAt });
      }
      for (const entry of entries) {
        await replaceMembershipWithStarterRole({
          organizationId: organization._id,
          userId: entry.userId,
          starterKey: String(entry.userId) === String(actorUserId) || entry.legacyRole === "manager"
            ? "administrator"
            : "contributor",
          actorUserId,
          assignedAt: entry.assignedAt || new Date(),
          session,
        });
      }
    });
  }
  await rawUsers.updateMany({}, { $unset: { organizationMemberships: "" } });
  return {
    organizations: organizations.length,
    memberships: await OrganizationMembership.countDocuments(),
    legacyUsersCleaned: legacyUsers.length,
  };
}

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  try { console.log(JSON.stringify(await migrateOrganizationRbac(), null, 2)); }
  finally { await mongoose.disconnect(); }
}

if (require.main === module) {
  main().catch(async (error) => {
    console.error(error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { migrateOrganizationRbac };
