const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const VenueRelease = require("../models/venueRelease.model");
const LayoutRevision = require("../models/layoutRevision.model");
const { routeBetweenVenueTargets } = require("../services/venueRouting.service");

function id() { return new mongoose.Types.ObjectId(); }

test("Venue is organization-owned but editorially independent", () => {
  const venue = new Venue({ name: "Pinacoteca", ownerOrganizationId: id(), primaryEditorialContextId: id(), createdBy: id() });
  assert.ok(venue.ownerOrganizationId);
  assert.ok(venue.primaryEditorialContextId);
  assert.equal(venue.museumId, undefined);
  assert.equal(venue.contentSpaceId, undefined);
  assert.equal(venue.namespaceId, undefined);
});

test("VenueTarget is a stable Subject occurrence and same Subject can occur twice", () => {
  const venueId = id(); const subjectId = id();
  const first = new VenueTarget({ venueId, subjectId, label: "Occurrence A", createdBy: id() });
  const second = new VenueTarget({ venueId, subjectId, label: "Occurrence B", createdBy: id() });
  assert.equal(String(first.subjectId), String(second.subjectId));
  assert.notEqual(String(first._id), String(second._id));
  const pairIndex = VenueTarget.schema.indexes().find(([keys]) => keys.venueId === 1 && keys.subjectId === 1);
  assert.ok(pairIndex);
  assert.notEqual(pairIndex[1]?.unique, true);
  assert.equal(first.itemId, undefined);
});

test("LayoutRevision places VenueTarget rather than Item", () => {
  const placeId = id();
  const layout = new LayoutRevision({
    venueId: id(), version: 1, authoredAgainstPhysicalVocabularyRevisionId: id(), createdBy: id(), updatedBy: id(),
    venueTargetPlacements: [{ venueTargetId: id(), primaryPlaceId: placeId, placeIds: [placeId] }],
  });
  assert.equal(layout.venueTargetPlacements.length, 1);
  assert.equal(layout.itemPlacements, undefined);
});

test("VenueRelease versions physical recognition media independently from Item", () => {
  const release = new VenueRelease({
    venueId: id(), version: 1, layoutRevisionId: id(), createdBy: id(), updatedBy: id(),
    targetBindings: [{ venueTargetId: id(), recognitionMedia: [{ url: "https://example.test/recognition.jpg", altText: "Opera" }] }],
  });
  assert.equal(release.targetBindings[0].recognitionMedia[0].url, "https://example.test/recognition.jpg");
  assert.equal(release.itemRevisionId, undefined);
});

test("Venue routing reuses graphRouting on VenueTarget placements", () => {
  const fromTargetId = id(); const toTargetId = id(); const fromPlaceId = id(); const toPlaceId = id();
  const layout = {
    venueTargetPlacements: [
      { venueTargetId: fromTargetId, primaryPlaceId: fromPlaceId, placeIds: [fromPlaceId] },
      { venueTargetId: toTargetId, primaryPlaceId: toPlaceId, placeIds: [toPlaceId] },
    ],
    connections: [{ _id: id(), fromPlaceId, toPlaceId, directionality: "bidirectional", distanceMeters: 10, additionalDelaySeconds: 0, attributeValues: [], instructions: {} }],
  };
  const route = routeBetweenVenueTargets({ layoutRevision: layout, fromVenueTargetId: fromTargetId, toVenueTargetId: toTargetId });
  assert.equal(route.reachable, true);
  assert.equal(route.distanceMeters, 10);
});
