const RESOURCE_TYPES = Object.freeze([
  "item_edition",
  "item_revision",
  "editorial_context",
  "editorial_release",
  "namespace",
  "namespace_revision",
  "visit",
  "visit_revision",
]);

const CAPABILITY_DEFINITIONS = Object.freeze({
  "content.consume": ["item_edition", "item_revision"],
  "content.use_in_editorial_release": ["item_edition", "item_revision"],
  "content.fork": ["item_edition", "item_revision"],
  "context.generate": ["editorial_context", "editorial_release"],
  "context.compose_visit": ["editorial_context", "editorial_release"],
  "context.use_as_venue_primary": ["editorial_context", "editorial_release"],
  "context.import_snapshot": ["editorial_context", "editorial_release"],
  "namespace.author": ["namespace", "namespace_revision"],
  "namespace.fork": ["namespace", "namespace_revision"],
  "visit.execute": ["visit", "visit_revision"],
  "visit.copy_detached": ["visit", "visit_revision"],
});

const CAPABILITIES = Object.freeze(Object.keys(CAPABILITY_DEFINITIONS));
const OFFER_VERSION_POLICIES = Object.freeze(["follow_current", "pin_at_acquisition", "pinned"]);
const ENTITLEMENT_VERSION_POLICIES = Object.freeze(["follow_current", "pinned"]);

function capabilitySupportsResource(capability, resourceType) {
  return (CAPABILITY_DEFINITIONS[capability] || []).includes(resourceType);
}

module.exports = {
  RESOURCE_TYPES,
  CAPABILITY_DEFINITIONS,
  CAPABILITIES,
  OFFER_VERSION_POLICIES,
  ENTITLEMENT_VERSION_POLICIES,
  capabilitySupportsResource,
};
