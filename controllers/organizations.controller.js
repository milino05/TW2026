const organizationService = require("../services/organization.service");

async function createOrganization(req, res, next) {
  try {
    res.status(201).json(await organizationService.createOrganization({
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function updateOrganization(req, res, next) {
  try {
    res.status(200).json(await organizationService.updateOrganization({
      organizationId: req.params.organizationId,
      payload: req.body || {},
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function assignOrganizationRole(req, res, next) {
  try {
    res.status(200).json(await organizationService.assignOrganizationRole({
      organizationId: req.params.organizationId,
      targetUserId: req.params.userId,
      role: req.body?.role,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function assignOrganizationRoleByUsername(req, res, next) {
  try {
    res.status(200).json(await organizationService.assignOrganizationRoleByUsername({
      organizationId: req.params.organizationId,
      username: req.body?.username,
      role: req.body?.role,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function removeOrganizationMember(req, res, next) {
  try {
    res.status(200).json(await organizationService.removeOrganizationMember({
      organizationId: req.params.organizationId,
      targetUserId: req.params.userId,
      actorUserId: req.user._id,
    }));
  } catch (error) { next(error); }
}

async function listOrganizations(req, res, next) {
  try { res.status(200).json(await organizationService.listOrganizations()); }
  catch (error) { next(error); }
}

async function getOrganization(req, res, next) {
  try {
    res.status(200).json(await organizationService.getOrganizationById({
      organizationId: req.params.organizationId,
    }));
  } catch (error) { next(error); }
}

module.exports = {
  createOrganization,
  updateOrganization,
  assignOrganizationRole,
  assignOrganizationRoleByUsername,
  removeOrganizationMember,
  listOrganizations,
  getOrganization,
};
