const service = require("../services/navigatorVenueConfig.service");

function sanitizeConfigPayload(payload = {}) {
  const cloned = structuredClone(payload || {});
  const config = cloned.config && typeof cloned.config === "object" ? cloned.config : cloned;
  const branding = config.branding && typeof config.branding === "object" ? config.branding : config;
  for (const key of ["logo", "heroImage"]) {
    const value = branding?.[key];
    if (value && typeof value === "object" && value.src && !value.assetId) delete branding[key];
  }
  return cloned;
}

async function getVenueConfig(req, res, next) {
  try {
    const projection = await service.getVenueNavigatorConfig({ venueId: req.params.venueId, actorUserId: req.user._id });
    res.status(200).json(projection);
  } catch (error) { next(error); }
}

async function updateVenueConfig(req, res, next) {
  try {
    const config = await service.updateVenueNavigatorConfig({
      venueId: req.params.venueId,
      actorUserId: req.user._id,
      payload: sanitizeConfigPayload(req.body || {}),
    });
    res.status(200).json({ config });
  } catch (error) { next(error); }
}

async function uploadVenueAsset(req, res, next) {
  try {
    const asset = await service.uploadVenueNavigatorAsset({ venueId: req.params.venueId, actorUserId: req.user._id, payload: req.body || {} });
    res.status(201).json({ asset });
  } catch (error) { next(error); }
}

async function copyVenueConfig(req, res, next) {
  try {
    const config = await service.copyVenueNavigatorConfig({
      venueId: req.params.venueId,
      sourceVenueId: req.body?.sourceVenueId,
      actorUserId: req.user._id,
    });
    res.status(200).json({ config });
  } catch (error) { next(error); }
}

async function navigatorAsset(req, res, next) {
  try {
    const asset = await service.getNavigatorAsset(req.params.assetId);
    res.set("Content-Type", asset.mimeType);
    res.set("Content-Length", String(asset.byteLength));
    res.set("Cache-Control", "public, max-age=2592000, immutable");
    res.set("X-Content-Type-Options", "nosniff");
    res.status(200).send(asset.data);
  } catch (error) { next(error); }
}

module.exports = { getVenueConfig, updateVenueConfig, uploadVenueAsset, copyVenueConfig, navigatorAsset };
