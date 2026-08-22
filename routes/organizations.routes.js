const express = require("express");
const router = express.Router();
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireAuth } = require("../middlewares/auth");
const controller = require("../controllers/organizations.controller");

const validateOrganizationId = validateObjectIdParam("organizationId");
const validateUserId = validateObjectIdParam("userId");

router.route("/organizations")
  .get(controller.listOrganizations)
  .post(requireAuth, controller.createOrganization);

router.post(
  "/organizations/:organizationId/members",
  requireAuth,
  validateOrganizationId,
  controller.assignOrganizationRoleByUsername,
);

router.put(
  "/organizations/:organizationId/members/:userId/role",
  requireAuth,
  validateOrganizationId,
  validateUserId,
  controller.assignOrganizationRole,
);

router.delete(
  "/organizations/:organizationId/members/:userId",
  requireAuth,
  validateOrganizationId,
  validateUserId,
  controller.removeOrganizationMember,
);

router.route("/organizations/:organizationId")
  .all(validateOrganizationId)
  .get(controller.getOrganization)
  .put(requireAuth, controller.updateOrganization)
  .patch(requireAuth, controller.updateOrganization);

module.exports = router;
