function projectExternalIdentity(identity = {}) {
  return {
    scheme: identity.scheme,
    id: identity.id,
    role: identity.role,
    canonicalId: identity.canonicalId || null,
    confirmation: {
      source: identity.confirmation?.source,
      confirmedAt: identity.confirmation?.confirmedAt || null,
    },
    verification: {
      status: identity.verification?.status,
      checkedAt: identity.verification?.checkedAt || null,
    },
  };
}

function projectSubject(subject) {
  if (!subject) return null;
  const value = typeof subject.toObject === "function" ? subject.toObject() : subject;
  return {
    id: String(value._id || value.id),
    preferredLabel: value.preferredLabel,
    description: value.description || "",
    externalIdentities: (value.externalIdentities || []).map(projectExternalIdentity),
    createdBy: value.createdBy ? String(value.createdBy) : null,
    createdAt: value.createdAt || null,
    updatedAt: value.updatedAt || null,
  };
}

module.exports = { projectExternalIdentity, projectSubject };
