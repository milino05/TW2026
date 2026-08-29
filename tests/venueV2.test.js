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

test("VenueTarget is the unique active Venue inventory entity for a Subject", () => {
  const venueId = id(); const subjectId = id();
  const first = new VenueTarget({ venueId, subjectId, displayLabelOverride: "Nome locale", createdBy: id() });
  const second = new VenueTarget({ venueId, subjectId, createdBy: id() });
  assert.equal(String(first.subjectId), String(second.subjectId));
  assert.notEqual(String(first._id), String(second._id));
  const pairIndex = VenueTarget.schema.indexes().find(([keys]) => keys.venueId === 1 && keys.subjectId === 1);
  assert.ok(pairIndex);
  assert.equal(pairIndex[1]?.unique, true);
  assert.deepEqual(pairIndex[1]?.partialFilterExpression, { lifecycleStatus: "active" });
  assert.equal(first.itemId, undefined);
});

test("LayoutRevision places stable ExhibitSlots rather than VenueTargets or Items", () => {
  const placeId = id();
  const exhibitSlotId = id();
  const layout = new LayoutRevision({
    venueId: id(), version: 1, authoredAgainstPhysicalVocabularyRevisionId: id(), createdBy: id(), updatedBy: id(),
    exhibitSlots: [{ exhibitSlotId, placeId, label: "Parete nord" }],
  });
  assert.equal(layout.exhibitSlots.length, 1);
  assert.equal(layout.venueTargetPlacements, undefined);
  assert.equal(layout.itemPlacements, undefined);
});

test("VenueRelease versions physical recognition media independently from Item", () => {
  const exhibitSlotId = id();
  const release = new VenueRelease({
    venueId: id(), version: 1, layoutRevisionId: id(), createdBy: id(), updatedBy: id(),
    targetBindings: [{ venueTargetId: id(), exhibitSlotId, recognitionMedia: [{ url: "https://example.test/recognition.jpg", altText: "Opera" }] }],
  });
  assert.equal(release.targetBindings[0].recognitionMedia[0].url, "https://example.test/recognition.jpg");
  assert.equal(release.itemRevisionId, undefined);
});

test("Venue routing resolves VenueTargets through release bindings and ExhibitSlots", () => {
  const fromTargetId = id(); const toTargetId = id(); const fromPlaceId = id(); const toPlaceId = id();
  const fromSlotId = id(); const toSlotId = id();
  const layout = {
    exhibitSlots: [
      { exhibitSlotId: fromSlotId, placeId: fromPlaceId, label: "Slot A" },
      { exhibitSlotId: toSlotId, placeId: toPlaceId, label: "Slot B" },
    ],
    connections: [{ _id: id(), fromPlaceId, toPlaceId, directionality: "bidirectional", distanceMeters: 10, additionalDelaySeconds: 0, attributeValues: [], instructions: {} }],
  };
  const venueRelease = { targetBindings: [{ venueTargetId: fromTargetId, exhibitSlotId: fromSlotId }, { venueTargetId: toTargetId, exhibitSlotId: toSlotId }] };
  const route = routeBetweenVenueTargets({ layoutRevision: layout, venueRelease, fromVenueTargetId: fromTargetId, toVenueTargetId: toTargetId });
  assert.equal(route.reachable, true);
  assert.equal(route.distanceMeters, 10);
});
