const organizationService = require("../services/organization.service");

function handler(statusCode, callback) {
  return async (req, res, next) => {
    try { res.status(statusCode).json(await callback(req)); }
    catch (error) { next(error); }
  };
}

const createOrganization = handler(201, (req) => organizationService.createOrganization({ payload: req.body || {}, actorUserId: req.user._id }));
const updateOrganization = handler(200, (req) => organizationService.updateOrganization({ organizationId: req.params.organizationId, payload: req.body || {}, actorUserId: req.user._id }));
const listOrganizations = handler(200, () => organizationService.listOrganizations());
const getOrganization = handler(200, (req) => organizationService.getOrganizationById({ organizationId: req.params.organizationId }));

const listRoles = handler(200, (req) => organizationService.listOrganizationRoles({ organizationId: req.params.organizationId, actorUserId: req.user._id }));
const createRole = handler(201, (req) => organizationService.createOrganizationRole({ organizationId: req.params.organizationId, payload: req.body || {}, actorUserId: req.user._id }));
const updateRole = handler(200, (req) => organizationService.updateOrganizationRole({ organizationId: req.params.organizationId, roleId: req.params.roleId, payload: req.body || {}, actorUserId: req.user._id }));
const deleteRole = handler(200, (req) => organizationService.deleteOrganizationRole({ organizationId: req.params.organizationId, roleId: req.params.roleId, actorUserId: req.user._id }));

const addMember = handler(201, (req) => organizationService.addOrganizationMemberByUsername({ organizationId: req.params.organizationId, username: req.body?.username, roleIds: req.body?.roleIds, actorUserId: req.user._id }));
const setMemberRoles = handler(200, (req) => organizationService.setMemberRoles({ organizationId: req.params.organizationId, targetUserId: req.params.userId, roleIds: req.body?.roleIds, actorUserId: req.user._id }));
const removeMember = handler(200, (req) => organizationService.removeOrganizationMember({ organizationId: req.params.organizationId, targetUserId: req.params.userId, actorUserId: req.user._id }));

const grantOwner = handler(200, (req) => organizationService.grantOrganizationOwner({ organizationId: req.params.organizationId, targetUserId: req.params.userId, actorUserId: req.user._id }));
const revokeOwner = handler(200, (req) => organizationService.revokeOrganizationOwner({ organizationId: req.params.organizationId, targetUserId: req.params.userId, actorUserId: req.user._id }));
const permissionCatalog = handler(200, (req) => organizationService.getPermissionCatalog({ organizationId: req.params.organizationId, actorUserId: req.user._id }));
const authorizationEvents = handler(200, (req) => organizationService.listAuthorizationEvents({ organizationId: req.params.organizationId, actorUserId: req.user._id, page: req.query?.page, limit: req.query?.limit }));

module.exports = {
  createOrganization,
  updateOrganization,
  listOrganizations,
  getOrganization,
  listRoles,
  createRole,
  updateRole,
  deleteRole,
  addMember,
  setMemberRoles,
  removeMember,
  grantOwner,
  revokeOwner,
  permissionCatalog,
  authorizationEvents,
};
