const User = require("../models/user");
const Organization = require("../models/organization.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const OrganizationRole = require("../models/organizationRole.model");
const Venue = require("../models/venue.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const { getActiveUserOrFail } = require("./userAuthorization.service");
const { resolveOrganizationAuthority, effectivePermissionsForMembership } = require("./organizationAuthorization.service");
const { projectPermissionCatalog } = require("./organizationPermissionRegistry.service");
const AppError = require("../utils/AppError");

function id(value) { return String(value?._id || value || ""); }
function operation(code, label, extra = {}) { return { code, label, ...extra }; }
function has(authority, permissionCode) { return authority.effectivePermissions.includes(permissionCode); }
function isOwner(organization, userId) { return (organization.owners || []).some((owner) => id(owner.userId) === id(userId)); }

function organizationOperations(authority) {
  const operations = [];
  if (has(authority, "organization.profile.manage")) operations.push(operation("organization.update", "Modifica organizzazione"));
  if (has(authority, "organization.members.manage") && has(authority, "organization.roles.assign")) operations.push(operation("organization.member.add", "Aggiungi membro"));
  if (has(authority, "organization.roles.manage")) operations.push(operation("organization.role.create", "Crea ruolo"));
  if (has(authority, "venue.create")) operations.push(operation("venue.create", "Crea sede"));
  if (has(authority, "namespace.create")) operations.push(operation("namespace.create", "Crea Namespace"));
  if (has(authority, "physical_vocabulary.create")) operations.push(operation("physical_vocabulary.create", "Crea vocabolario fisico"));
  if (authority.isOwner) operations.push(operation("organization.owner.manage", "Gestisci Owner", { rootAuthority: true }));
  return operations;
}

function organizationSections(authority) {
  return [
    { code: "overview", label: "Panoramica" },
    ...(has(authority, "organization.members.view") ? [{ code: "people", label: "Persone" }] : []),
    ...(has(authority, "organization.roles.view") ? [{ code: "roles", label: "Ruoli" }] : []),
    ...(has(authority, "venue.view") ? [{ code: "venues", label: "Sedi" }] : []),
    ...(has(authority, "namespace.view") ? [{ code: "rules", label: "Regole editoriali" }] : []),
    ...(has(authority, "physical_vocabulary.view") ? [{ code: "physical", label: "Vocabolari fisici" }] : []),
    ...(has(authority, "organization.profile.manage") || has(authority, "organization.audit.view") || authority.isOwner
      ? [{ code: "settings", label: "Impostazioni" }]
      : []),
  ];
}

function roleSummaries(membership) {
  return (membership?.roleAssignments || []).map((assignment) => ({
    id: assignment.roleId?._id || assignment.roleId,
    name: assignment.roleId?.name || "Ruolo non disponibile",
  }));
}

function memberOperations({ authority, organization, member }) {
  const operations = [];
  const permissionSet = new Set(authority.effectivePermissions);
  const withinCeiling = authority.isOwner || (member.permissionCodes || []).every((code) => permissionSet.has(code));
  if (withinCeiling && has(authority, "organization.members.manage") && has(authority, "organization.roles.assign")) {
    operations.push(operation("organization.member.roles.update", "Modifica ruoli"));
  }
  if (withinCeiling && has(authority, "organization.members.manage") && !member.isOwner) {
    operations.push(operation("organization.member.remove", "Rimuovi"));
  }
  if (authority.isOwner && !member.isOwner) operations.push(operation("organization.owner.grant", "Nomina Owner", { rootAuthority: true }));
  if (authority.isOwner && member.isOwner && (organization.owners || []).length > 1) {
    operations.push(operation("organization.owner.revoke", "Revoca Owner", { rootAuthority: true }));
  }
  return operations;
}

function roleOperations({ authority, role }) {
  if (!has(authority, "organization.roles.manage")) return [];
  const permissionSet = new Set(authority.effectivePermissions);
  const withinCeiling = authority.isOwner || role.permissionCodes.every((code) => permissionSet.has(code));
  if (!withinCeiling) return [];
  return [
    operation("organization.role.update", "Modifica ruolo"),
    ...(role.assignmentCount === 0 ? [operation("organization.role.remove", "Elimina ruolo")] : []),
  ];
}

function roleIsAssignable({ authority, role }) {
  if (!has(authority, "organization.members.manage") || !has(authority, "organization.roles.assign")) return false;
  const permissionSet = new Set(authority.effectivePermissions);
  return authority.isOwner || role.permissionCodes.every((code) => permissionSet.has(code));
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

function pageValue(value, fallback = 1) { return Math.max(1, Number.parseInt(value, 10) || fallback); }
function limitValue(value, fallback = 12) { return Math.max(1, Math.min(50, Number.parseInt(value, 10) || fallback)); }
function paged(results, page, pageSize, total) { return { results, page, pageSize, total }; }

async function revisionMapFor(namespaces) {
  const revisionIds = namespaces.flatMap((namespace) => [namespace.workingRevisionId, namespace.publishedRevisionId]).filter(Boolean);
  const revisions = revisionIds.length
    ? await NamespaceRevision.find({ _id: { $in: revisionIds } }).select("version status").lean()
    : [];
  return new Map(revisions.map((revision) => [id(revision._id), revision]));
}

async function physicalVocabularyRevisionMapFor(physicalVocabularies) {
  const revisionIds = physicalVocabularies.flatMap((physicalVocabulary) => [physicalVocabulary.workingRevisionId, physicalVocabulary.publishedRevisionId]).filter(Boolean);
  const revisions = revisionIds.length
    ? await PhysicalVocabularyRevision.find({ _id: { $in: revisionIds } }).select("version status").lean()
    : [];
  return new Map(revisions.map((revision) => [id(revision._id), revision]));
}

function projectNamespace(namespace, revisionById, authority = null) {
  const canEdit = !authority || has(authority, "namespace.edit");
  return {
    id: namespace._id,
    name: namespace.name,
    description: namespace.description || "",
    state: namespaceState(namespace, revisionById),
    availableOperations: canEdit
      ? [operation("namespace.update", "Modifica dettagli"), operation("namespace.edit", "Apri editor")]
      : [operation("namespace.view", "Visualizza")],
  };
}

function projectPhysicalVocabulary(physicalVocabulary, revisionById, authority = null) {
  const canEdit = !authority || has(authority, "physical_vocabulary.edit");
  return {
    id: physicalVocabulary._id,
    name: physicalVocabulary.name,
    description: physicalVocabulary.description || "",
    state: namespaceState(physicalVocabulary, revisionById),
    availableOperations: canEdit
      ? [operation("physical_vocabulary.update", "Modifica dettagli"), operation("physical_vocabulary.edit", "Apri editor")]
      : [operation("physical_vocabulary.view", "Visualizza")],
  };
}

async function getMarketplaceAccountWorkspace({ actorUserId }) {
  const actor = await getActiveUserOrFail(actorUserId);
  const memberships = await OrganizationMembership.find({ userId: actor._id }).populate("roleAssignments.roleId").lean();
  const organizationIds = memberships.map((entry) => entry.organizationId);
  const [organizations, personalNamespaces, personalPhysicalVocabularies] = await Promise.all([
    organizationIds.length ? Organization.find({ _id: { $in: organizationIds }, lifecycleStatus: "active" }).sort({ name: 1 }).lean() : [],
    Namespace.find({ ownerType: "user", ownerId: actor._id, lifecycleStatus: "active" }).sort({ name: 1 }).lean(),
    PhysicalVocabulary.find({ ownerType: "user", ownerId: actor._id, lifecycleStatus: "active" }).sort({ name: 1 }).lean(),
  ]);
  const membershipByOrganization = new Map(memberships.map((entry) => [id(entry.organizationId), entry]));
  const revisionById = await revisionMapFor(personalNamespaces);
  const physicalVocabularyRevisionById = await physicalVocabularyRevisionMapFor(personalPhysicalVocabularies);

  const projectedOrganizations = await Promise.all(organizations.map(async (organization) => {
    const membership = membershipByOrganization.get(id(organization._id));
    const authority = {
      membership,
      effectivePermissions: effectivePermissionsForMembership(membership),
      isOwner: isOwner(organization, actor._id),
    };
    const sections = organizationSections(authority);
    const counts = {};
    await Promise.all([
      has(authority, "organization.members.view")
        ? OrganizationMembership.countDocuments({ organizationId: organization._id }).then((value) => { counts.members = value; })
        : null,
      has(authority, "venue.view")
        ? Venue.countDocuments({ ownerOrganizationId: organization._id, lifecycleStatus: "active" }).then((value) => { counts.venues = value; })
        : null,
      has(authority, "namespace.view")
        ? Namespace.countDocuments({ ownerType: "organization", ownerId: organization._id, lifecycleStatus: "active" }).then((value) => { counts.namespaces = value; })
        : null,
      has(authority, "physical_vocabulary.view")
        ? PhysicalVocabulary.countDocuments({ ownerType: "organization", ownerId: organization._id, lifecycleStatus: "active" }).then((value) => { counts.physicalVocabularies = value; })
        : null,
    ]);
    return {
      id: organization._id,
      name: organization.name,
      description: organization.description || "",
      roles: roleSummaries(membership),
      isOwner: authority.isOwner,
      availableSections: sections,
      availableOperations: organizationOperations(authority),
      counts,
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
    personalPhysicalVocabularies: personalPhysicalVocabularies.map((physicalVocabulary) => projectPhysicalVocabulary(physicalVocabulary, physicalVocabularyRevisionById)),
    organizations: projectedOrganizations,
  };
}

async function roleProjection({ organizationId, authority }) {
  if (!has(authority, "organization.roles.view")) return [];
  const [roles, counts] = await Promise.all([
    OrganizationRole.find({ organizationId }).sort({ name: 1 }).lean(),
    OrganizationMembership.aggregate([
      { $match: { organizationId: authority.organization._id } },
      { $unwind: "$roleAssignments" },
      { $group: { _id: "$roleAssignments.roleId", count: { $sum: 1 } } },
    ]),
  ]);
  const countById = new Map(counts.map((entry) => [id(entry._id), entry.count]));
  return roles.map((role) => {
    const projected = { ...role, id: role._id, assignmentCount: countById.get(id(role._id)) || 0 };
    return {
      ...projected,
      assignable: roleIsAssignable({ authority, role: projected }),
      availableOperations: roleOperations({ authority, role: projected }),
    };
  });
}

async function getMarketplaceOrganizationDetail({
  actorUserId,
  organizationId,
  memberPage: rawMemberPage,
  venuePage: rawVenuePage,
  namespacePage: rawNamespacePage,
  physicalVocabularyPage: rawPhysicalVocabularyPage,
  limit: rawLimit,
}) {
  const authority = await resolveOrganizationAuthority({ userId: actorUserId, organizationId });
  if (!authority.membership || authority.roles.length === 0) throw new AppError("Organization non disponibile per questo account", 403);
  const organization = authority.organization;
  const memberPage = pageValue(rawMemberPage);
  const venuePage = pageValue(rawVenuePage);
  const namespacePage = pageValue(rawNamespacePage);
  const physicalVocabularyPage = pageValue(rawPhysicalVocabularyPage);
  const pageSize = limitValue(rawLimit);

  const canViewMembers = has(authority, "organization.members.view");
  const canViewVenues = has(authority, "venue.view");
  const canViewNamespaces = has(authority, "namespace.view");
  const canViewPhysicalVocabularies = has(authority, "physical_vocabulary.view");
  const memberQuery = { organizationId: organization._id };
  const venueQuery = { ownerOrganizationId: organization._id, lifecycleStatus: "active" };
  const namespaceQuery = { ownerType: "organization", ownerId: organization._id, lifecycleStatus: "active" };
  const physicalVocabularyQuery = { ownerType: "organization", ownerId: organization._id, lifecycleStatus: "active" };

  const [memberships, memberTotal, venues, venueTotal, namespaces, namespaceTotal, physicalVocabularies, physicalVocabularyTotal, roles] = await Promise.all([
    canViewMembers
      ? OrganizationMembership.find(memberQuery).populate("userId", "username status").populate("roleAssignments.roleId", "name permissionCodes").sort({ createdAt: 1 }).skip((memberPage - 1) * pageSize).limit(pageSize).lean()
      : [],
    canViewMembers ? OrganizationMembership.countDocuments(memberQuery) : 0,
    canViewVenues ? Venue.find(venueQuery).sort({ name: 1 }).skip((venuePage - 1) * pageSize).limit(pageSize).lean() : [],
    canViewVenues ? Venue.countDocuments(venueQuery) : 0,
    canViewNamespaces ? Namespace.find(namespaceQuery).sort({ name: 1 }).skip((namespacePage - 1) * pageSize).limit(pageSize).lean() : [],
    canViewNamespaces ? Namespace.countDocuments(namespaceQuery) : 0,
    canViewPhysicalVocabularies ? PhysicalVocabulary.find(physicalVocabularyQuery).sort({ name: 1 }).skip((physicalVocabularyPage - 1) * pageSize).limit(pageSize).lean() : [],
    canViewPhysicalVocabularies ? PhysicalVocabulary.countDocuments(physicalVocabularyQuery) : 0,
    roleProjection({ organizationId, authority }),
  ]);
  const revisionById = await revisionMapFor(namespaces);
  const physicalVocabularyRevisionById = await physicalVocabularyRevisionMapFor(physicalVocabularies);
  const projectedMembers = memberships.filter((membership) => membership.userId?.status === "active").map((membership) => {
    const member = {
      id: membership.userId._id,
      username: membership.userId.username,
      roles: roleSummaries(membership),
      permissionCodes: effectivePermissionsForMembership(membership),
      isOwner: isOwner(organization, membership.userId._id),
    };
    const availableOperations = memberOperations({ authority, organization, member });
    const { permissionCodes, ...projected } = member;
    return { ...projected, availableOperations };
  });

  return {
    organization: {
      id: organization._id,
      name: organization.name,
      description: organization.description || "",
      roles: roleSummaries(authority.membership),
      isOwner: authority.isOwner,
      availableSections: organizationSections(authority),
      availableOperations: organizationOperations(authority),
    },
    members: paged(projectedMembers, memberPage, pageSize, memberTotal),
    roles,
    permissionCatalog: has(authority, "organization.roles.view") ? { groups: projectPermissionCatalog() } : null,
    venues: paged(venues.map((venue) => ({
      id: venue._id,
      name: venue.name,
      description: venue.description || "",
      physicalState: venue.workingReleaseId ? "working" : (venue.publishedReleaseId ? "published" : "not_configured"),
      availableOperations: [
        ...(has(authority, "venue.profile.manage") ? [operation("venue.update", "Modifica dettagli")] : []),
        ...(has(authority, "venue.physical.edit") ? [operation("venue.edit", "Configura sede")] : []),
      ],
    })), venuePage, pageSize, venueTotal),
    namespaces: paged(namespaces.map((namespace) => projectNamespace(namespace, revisionById, authority)), namespacePage, pageSize, namespaceTotal),
    physicalVocabularies: paged(
      physicalVocabularies.map((physicalVocabulary) => projectPhysicalVocabulary(physicalVocabulary, physicalVocabularyRevisionById, authority)),
      physicalVocabularyPage,
      pageSize,
      physicalVocabularyTotal,
    ),
    settings: {
      canManageProfile: has(authority, "organization.profile.manage"),
      canViewAudit: has(authority, "organization.audit.view"),
      canManageOwners: authority.isOwner,
    },
  };
}

module.exports = {
  organizationOperations,
  organizationSections,
  memberOperations,
  getMarketplaceAccountWorkspace,
  getMarketplaceOrganizationDetail,
};
