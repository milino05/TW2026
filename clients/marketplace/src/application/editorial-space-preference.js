const STORAGE_PREFIX = "artaround.marketplace.editorial-space.v1";
export const EDITORIAL_SPACE_CHANGED = "artaround:editorial-space-changed";

function text(value) { return String(value || "").trim(); }

function principalParts(principal) {
  const type = text(principal?.principalType || principal?.type);
  const id = text(principal?.principalId || principal?.id);
  if (!["user", "organization"].includes(type) || !id) return null;
  return { type, id };
}

function storageKey(principal) {
  const parts = principalParts(principal);
  return parts ? `${STORAGE_PREFIX}:${encodeURIComponent(parts.type)}:${encodeURIComponent(parts.id)}` : null;
}

export function readEditorialSpacePreference(principal) {
  const key = storageKey(principal);
  if (!key) return null;
  try { return text(window.localStorage.getItem(key)) || null; }
  catch { return null; }
}

export function setEditorialSpacePreference(principal, contentSpaceId, { silent = false } = {}) {
  const key = storageKey(principal);
  const id = text(contentSpaceId);
  if (!key || !id) throw new Error("Spazio editoriale non valido");
  window.localStorage.setItem(key, id);
  if (!silent) window.dispatchEvent(new CustomEvent(EDITORIAL_SPACE_CHANGED, { detail: { contentSpaceId: id } }));
  return id;
}

export function clearEditorialSpacePreference(principal, { silent = false } = {}) {
  const key = storageKey(principal);
  if (!key) return;
  try { window.localStorage.removeItem(key); } catch {}
  if (!silent) window.dispatchEvent(new CustomEvent(EDITORIAL_SPACE_CHANGED, { detail: { contentSpaceId: null } }));
}

export function resolveEditorialSpacePreference(principal, spaces = []) {
  const activeSpaces = Array.isArray(spaces) ? spaces.filter((space) => text(space?.id || space?._id)) : [];
  if (!activeSpaces.length) {
    clearEditorialSpacePreference(principal, { silent: true });
    return null;
  }
  const preferredId = readEditorialSpacePreference(principal);
  const preferred = activeSpaces.find((space) => text(space.id || space._id) === preferredId) || null;
  if (preferred) return preferred;
  const fallback = activeSpaces[0];
  setEditorialSpacePreference(principal, fallback.id || fallback._id, { silent: true });
  return fallback;
}
