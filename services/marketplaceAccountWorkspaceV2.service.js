const User = require("../models/user");
const Organization = require("../models/organization.model");
const Venue = require("../models/venue.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }

function operation(code, label) { return { code, label }; }

function organizationOperations(role) {
  const shared = [
    operation("venue.create", "Crea sede"),
    operation("namespace.create", "Crea Namespace"),
  ];
  if (role !== "manager") return shared;
  return [
    operation("organization.update", "Modifica organizzazione"),
    operation("organization.member.add", "Aggiungi membro"),
    ...shared,
  ];
}

function memberOperations({ actorUserId, actorRole, organizationCreatedBy, member }) {
  if (actorRole !== "manager" || id(member.id || member._id) === id(organizationCreatedBy)) return [];
  if (member.role === "operator") {
    return [
      operation("organization.member.promote", "Promuovi a manager"),
      operation("organization.member.remove", "Rimuovi"),
    ];
  }
  if (member.role === "manager" && id(actorUserId) === id(organizationCreatedBy)) {
    return [operation("organization.member.demote", "Retrocedi a operator")];
  }
  return [];
}

function namespaceState(namespace, revisionById) {
  const revisionId = namespace.workingRevisionId || namespace.publishedRevisionId;
  const revision = revisionById.get(id(revisionId));
  return {
    mode: namespace.workingRevisionId ? "working" : (namespace.publishedRevisionId ? "published" : "empty"),
    revisionStatus: revision?.status || null,
    version: revision?.version || null,
  };
}

function pageValue(value, fallback = 1) {
  return Math.max(1, Number.parseInt(value, 10) || fallback);
}

function limitValue(value, fallback = 12) {
  return Math.max(1, Math.min(50, Number.parseInt(value, 10) || fallback));
}

function paged(results, page, pageSize, total) {
  return { results, page, pageSize, total };
}

async function revisionMapFor(namespaces) {
  const revisionIds = namespaces
    .flatMap((namespace) => [namespace.workingRevisionId, namespace.publishedRevisionId])
    .filter(Boolean);
  const revisions = revisionIds.length
    ? await NamespaceRevision.find({ _id: { $in: revisionIds } }).select("version status").lean()
    : [];
  return new Map(revisions.map((revision) => [id(revision._id), revision]));
}

function projectNamespace(namespace, revisionById) {
  return {
    id: namespace._id,
    name: namespace.name,
    description: namespace.description || "",
    state: namespaceState(namespace, revisionById),
    availableOperations: [
      operation("namespace.update", "Modifica dettagli"),
      operation("namespace.edit", "Apri editor"),
    ],
  };
}

async function getMarketplaceAccountWorkspace({ actorUserId }) {
  const actor = await getActiveUserOrFail(actorUserId);
  const memberships = (actor.organizationMemberships || []).filter((entry) => ["operator", "manager"].includes(entry.role));
  const organizationIds = memberships.map((entry) => entry.organizationId);
  const roleByOrganizationId = new Map(memberships.map((entry) => [id(entry.organizationId), entry.role]));

  const [organizations, personalNamespaces] = await Promise.all([
    organizationIds.length
      ? Organization.find({ _id: { $in: organizationIds }, lifecycleStatus: "active" }).sort({ name: 1 }).lean()
      : [],
    Namespace.find({ ownerType: "user", ownerId: actor._id, lifecycleStatus: "active" }).sort({ name: 1 }).lean(),
  ]);
  const revisionById = await revisionMapFor(personalNamespaces);

  const projectedOrganizations = await Promise.all(organizations.map(async (organization) => {
    const organizationId = id(organization._id);
    const actorRole = roleByOrganizationId.get(organizationId);
    const [memberCount, venueCount, namespaceCount] = await Promise.all([
      User.countDocuments({ status: "active", "organizationMemberships.organizationId": organization._id }),
      Venue.countDocuments({ ownerOrganizationId: organization._id, lifecycleStatus: "active" }),
      Namespace.countDocuments({ ownerType: "organization", ownerId: organization._id, lifecycleStatus: "active" }),
    ]);

    return {
      id: organization._id,
      name: organization.name,
      description: organization.description || "",
      role: actorRole,
      isCreator: id(actor._id) === id(organization.createdBy),
      availableOperations: organizationOperations(actorRole),
      counts: { members: memberCount, venues: venueCount, namespaces: namespaceCount },
    };
  }));

  return {
    account: {
      id: actor._id,
      username: actor.username,
      status: actor.status,
      createdAt: actor.createdAt,
      defaultPresentationPreference: actor.defaultPresentationPreference || null,
      defaultNavigationPreference: actor.defaultNavigationPreference || { movementPacePreference: 0.5, requirements: [] },
      learningPreferences: actor.learningPreferences || null,
      availableOperations: [operation("organization.create", "Crea organizzazione")],
    },
    personalNamespaces: personalNamespaces.map((namespace) => projectNamespace(namespace, revisionById)),
    organizations: projectedOrganizations,
  };
}

async function getMarketplaceOrganizationDetail({
  actorUserId,
  organizationId,
  memberPage: rawMemberPage,
  venuePage: rawVenuePage,
  namespacePage: rawNamespacePage,
  limit: rawLimit,
}) {
  const actor = await getActiveUserOrFail(actorUserId);
  const membership = (actor.organizationMemberships || []).find((entry) => id(entry.organizationId) === id(organizationId));
  if (!membership || !["operator", "manager"].includes(membership.role)) {
    throw new AppError("Organization non disponibile per questo account", 403);
  }
  const organization = await Organization.findOne({ _id: organizationId, lifecycleStatus: "active" }).lean();
  if (!organization) throw new AppError("Organization non trovata", 404);

  const memberPage = pageValue(rawMemberPage);
  const venuePage = pageValue(rawVenuePage);
  const namespacePage = pageValue(rawNamespacePage);
  const pageSize = limitValue(rawLimit);
  const memberQuery = { status: "active", "organizationMemberships.organizationId": organization._id };
  const venueQuery = { ownerOrganizationId: organization._id, lifecycleStatus: "active" };
  const namespaceQuery = { ownerType: "organization", ownerId: organization._id, lifecycleStatus: "active" };

  const [members, memberTotal, venues, venueTotal, namespaces, namespaceTotal] = await Promise.all([
    User.find(memberQuery).select("username organizationMemberships").sort({ username: 1 }).skip((memberPage - 1) * pageSize).limit(pageSize).lean(),
    User.countDocuments(memberQuery),
    Venue.find(venueQuery).sort({ name: 1 }).skip((venuePage - 1) * pageSize).limit(pageSize).lean(),
    Venue.countDocuments(venueQuery),
    Namespace.find(namespaceQuery).sort({ name: 1 }).skip((namespacePage - 1) * pageSize).limit(pageSize).lean(),
    Namespace.countDocuments(namespaceQuery),
  ]);
  const revisionById = await revisionMapFor(namespaces);
  const projectedMembers = members.map((member) => {
    const memberMembership = (member.organizationMemberships || []).find((entry) => id(entry.organizationId) === id(organization._id));
    const projected = {
      id: member._id,
      username: member.username,
      role: memberMembership.role,
      isCreator: id(member._id) === id(organization.createdBy),
    };
    return {
      ...projected,
      availableOperations: memberOperations({
        actorUserId: actor._id,
        actorRole: membership.role,
        organizationCreatedBy: organization.createdBy,
        member: projected,
      }),
    };
  });

  return {
    organization: {
      id: organization._id,
      name: organization.name,
      description: organization.description || "",
      role: membership.role,
      isCreator: id(actor._id) === id(organization.createdBy),
      availableOperations: organizationOperations(membership.role),
    },
    members: paged(projectedMembers, memberPage, pageSize, memberTotal),
    venues: paged(venues.map((venue) => ({
      id: venue._id,
      name: venue.name,
      description: venue.description || "",
      physicalState: venue.workingReleaseId ? "working" : (venue.publishedReleaseId ? "published" : "not_configured"),
      availableOperations: [operation("venue.update", "Modifica dettagli"), operation("venue.edit", "Configura sede")],
    })), venuePage, pageSize, venueTotal),
    namespaces: paged(namespaces.map((namespace) => projectNamespace(namespace, revisionById)), namespacePage, pageSize, namespaceTotal),
  };
}

module.exports = {
  organizationOperations,
  memberOperations,
  getMarketplaceAccountWorkspace,
  getMarketplaceOrganizationDetail,
};
