const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const LayoutRevision = require("../models/layoutRevision.model");
const layoutCommands = require("../services/venueLayoutCommand.service");
const {
  deriveMetersPerPixel,
  distanceMetersForGeometry,
} = require("../services/layoutGeometry.service");

function oid() { return new mongoose.Types.ObjectId(); }

test("LayoutRevision pins a PhysicalVocabularyRevision and contains no embedded vocabulary", async () => {
  const floorId = oid();
  const layout = new LayoutRevision({
    venueId: oid(),
    version: 1,
    authoredAgainstPhysicalVocabularyRevisionId: oid(),
    floors: [{ _id: floorId, label: "Piano terra" }],
    places: [{ floorId, placeTypeDefinitionId: "room-definition", position: { x: 0.25, y: 0.5 } }],
    placeTypes: [{ key: "legacy" }],
    routingAttributes: [{ key: "legacy" }],
    routingPresets: [{ key: "legacy" }],
    createdBy: oid(),
    updatedBy: oid(),
  });
  await layout.validate();
  assert.ok(layout.authoredAgainstPhysicalVocabularyRevisionId);
  assert.equal(layout.placeTypes, undefined);
  assert.equal(layout.routingAttributes, undefined);
  assert.equal(layout.routingPresets, undefined);
});

test("Venue physical authoring exposes granular commands and no aggregate rewrite route", () => {
  const routes = fs.readFileSync(path.resolve(__dirname, "../routes/venues.routes.js"), "utf8");
  const layoutSource = fs.readFileSync(path.resolve(__dirname, "../services/venueLayoutCommand.service.js"), "utf8");
  const bindingSource = fs.readFileSync(path.resolve(__dirname, "../services/venueTargetBindingCommand.service.js"), "utf8");
  const detachSource = fs.readFileSync(path.resolve(__dirname, "../services/venueTargetConfigurationCommand.service.js"), "utf8");
  const targetSource = fs.readFileSync(path.resolve(__dirname, "../services/venueTarget.service.js"), "utf8");
  assert.doesNotMatch(routes, /router\.patch\(\s*["']\/venues\/:venueId\/working-release["']/);
  for (const route of [
    "working-layout/floors",
    "working-layout/places",
    "working-layout/connections",
    "working-layout/targets/:venueTargetId/placement",
  ]) assert.match(routes, new RegExp(route.replaceAll("/", "\\/")));
  for (const command of [
    "addFloor", "calibrateFloor", "createPlace", "movePlace", "createConnection",
    "setConnectionAttribute", "setVenueTargetPlacement", "setPreVisitInformation",
  ]) assert.equal(typeof layoutCommands[command], "function", `${command} command missing`);
  assert.match(layoutSource, /workingReleaseId: ensured\.release\._id/);
  assert.match(bindingSource, /workingReleaseId: ensured\.release\._id/);
  assert.match(detachSource, /Venue\.findOne\(\{ _id: venueId, lifecycleStatus: "active" \}\)/);
  assert.match(targetSource, /select\("_id workingReleaseId publishedReleaseId"\)/);
  for (const source of [layoutSource, bindingSource]) assert.match(source, /WORKING_RELEASE_CHANGED/);
});

test("Floor calibration converts normalized polyline geometry into meters", () => {
  const floor = {
    mapAsset: { width: 1000, height: 500 },
    calibration: { metersPerPixel: 0.1 },
  };
  assert.equal(deriveMetersPerPixel({
    distanceMeters: 100,
    points: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    mapAsset: floor.mapAsset,
  }), 0.1);
  assert.equal(distanceMetersForGeometry({
    points: [{ x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }],
    floor,
  }), 40);
});
