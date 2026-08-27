const express = require("express");
const { validateObjectIdParam } = require("../middlewares/validateObjectIdParam");
const { requireAuth } = require("../middlewares/auth");
const controller = require("../controllers/organizations.controller");

const router = express.Router();
const validateOrganizationId = validateObjectIdParam("organizationId");
const validateUserId = validateObjectIdParam("userId");
const validateRoleId = validateObjectIdParam("roleId");

router.route("/organizations")
  .get(controller.listOrganizations)
  .post(requireAuth, controller.createOrganization);

router.route("/organizations/:organizationId")
  .all(validateOrganizationId)
  .get(controller.getOrganization)
  .put(requireAuth, controller.updateOrganization)
  .patch(requireAuth, controller.updateOrganization);

router.route("/organizations/:organizationId/roles")
  .all(requireAuth, validateOrganizationId)
  .get(controller.listRoles)
  .post(controller.createRole);

router.route("/organizations/:organizationId/roles/:roleId")
  .all(requireAuth, validateOrganizationId, validateRoleId)
  .patch(controller.updateRole)
  .delete(controller.deleteRole);

router.post("/organizations/:organizationId/members", requireAuth, validateOrganizationId, controller.addMember);
router.put("/organizations/:organizationId/members/:userId/roles", requireAuth, validateOrganizationId, validateUserId, controller.setMemberRoles);
router.delete("/organizations/:organizationId/members/:userId", requireAuth, validateOrganizationId, validateUserId, controller.removeMember);
router.post("/organizations/:organizationId/owners/:userId", requireAuth, validateOrganizationId, validateUserId, controller.grantOwner);
router.delete("/organizations/:organizationId/owners/:userId", requireAuth, validateOrganizationId, validateUserId, controller.revokeOwner);
router.get("/organizations/:organizationId/permission-catalog", requireAuth, validateOrganizationId, controller.permissionCatalog);
router.get("/organizations/:organizationId/authorization-events", requireAuth, validateOrganizationId, controller.authorizationEvents);

module.exports = router;
