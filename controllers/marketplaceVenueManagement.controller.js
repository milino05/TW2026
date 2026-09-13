const management = require("../services/marketplaceManagementV2.service");
const { getVenueInventoryCapabilities } = require("../services/venueInventoryCapabilities.service");

async function marketplaceVenueManagement(req, res, next) {
  try {
    const projection = await management.getVenueManagementProjection({
      venueId: req.params.venueId,
      actorUserId: req.user._id,
    });
    const inventoryCapabilities = await getVenueInventoryCapabilities({
      organizationId: projection.venue.organizationId,
      actorUserId: req.user._id,
    });
    res.status(200).json({
      ...projection,
      inventoryCapabilities,
      authoringPermissions: {
        ...(projection.authoringPermissions || {}),
        canProposeInventory: inventoryCapabilities.canPropose,
        canManageInventory: inventoryCapabilities.canManage,
      },
    });
  } catch (error) { next(error); }
}

module.exports = { marketplaceVenueManagement };
