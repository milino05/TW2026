const LayoutRevision = require("../models/layoutRevision.model");
const VenueRelease = require("../models/venueRelease.model");
const { removeVenueFloorPlan } = require("./venueFloorPlanUpload.service");
const { removeVenueRecognitionMedia } = require("./venueRecognitionMediaUpload.service");

async function floorPlanUrlIsReferenced(url) {
  const normalized = String(url || "").trim();
  if (!normalized) return false;
  return Boolean(await LayoutRevision.exists({ "floors.mapAsset.url": normalized }));
}

async function recognitionMediaUrlIsReferenced(url) {
  const normalized = String(url || "").trim();
  if (!normalized) return false;
  return Boolean(await VenueRelease.exists({ "targetBindings.recognitionMedia.url": normalized }));
}

async function removeVenueFloorPlanIfUnreferenced(url) {
  const normalized = String(url || "").trim();
  if (!normalized || await floorPlanUrlIsReferenced(normalized)) return false;
  return removeVenueFloorPlan(normalized);
}

async function removeVenueRecognitionMediaIfUnreferenced(url) {
  const normalized = String(url || "").trim();
  if (!normalized || await recognitionMediaUrlIsReferenced(normalized)) return false;
  return removeVenueRecognitionMedia(normalized);
}

module.exports = {
  floorPlanUrlIsReferenced,
  recognitionMediaUrlIsReferenced,
  removeVenueFloorPlanIfUnreferenced,
  removeVenueRecognitionMediaIfUnreferenced,
};
