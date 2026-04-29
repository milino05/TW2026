function pushError(errors, field, code, message, extra = {}) {
  errors.push({
    field,
    code,
    message,
    ...extra,
  });
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function trimIfString(value) {
  return typeof value === "string" ? value.trim() : value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeKey(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();

    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }

  return value;
}

/**
 * Normalizzazione permissiva.
 * Utile per campi poco critici, ad esempio tags.
 * Scarta valori non stringa/non numero.
 */
function normalizeStringArray(values, options = {}) {
  const { allowNumbers = true, lowercase = false } = options;

  if (!Array.isArray(values)) {
    return values;
  }

  return values
    .filter((value) => {
      if (typeof value === "string") return true;
      if (allowNumbers && typeof value === "number") return true;
      return false;
    })
    .map((value) => {
      const normalized = String(value).trim();
      return lowercase ? normalized.toLowerCase() : normalized;
    })
    .filter(Boolean);
}

/**
 * Normalizzazione rigorosa.
 * Utile per config controllate del museo.
 *
 * Non elimina valori invalidi.
 * Esempio:
 * ["artwork", true, " artist "] -> ["artwork", true, "artist"]
 *
 * Così la validation può segnalare true come valore invalido.
 */
function normalizeStringArrayStrict(values, options = {}) {
  const { allowNumbers = false, lowercase = false } = options;

  if (!Array.isArray(values)) {
    return values;
  }

  return values.map((value) => {
    if (typeof value === "string") {
      const normalized = value.trim();
      return lowercase ? normalized.toLowerCase() : normalized;
    }

    if (allowNumbers && typeof value === "number") {
      const normalized = String(value).trim();
      return lowercase ? normalized.toLowerCase() : normalized;
    }

    return value;
  });
}

function toNumberIfPresent(value) {
  if (value === undefined || value === null || value === "") {
    return value;
  }

  return Number(value);
}

function validateUniqueStringArray(values, field, errors) {
  if (!Array.isArray(values)) {
    pushError(errors, field, "INVALID_TYPE", `${field} deve essere un array`);
    return;
  }

  const seen = new Set();

  values.forEach((value, index) => {
    const path = `${field}[${index}]`;

    if (!value || typeof value !== "string") {
      pushError(errors, path, "INVALID_VALUE", `${path} deve essere una stringa non vuota`);
      return;
    }

    if (seen.has(value)) {
      pushError(errors, path, "DUPLICATE_VALUE", `Valore duplicato: ${value}`);
      return;
    }

    seen.add(value);
  });
}

module.exports = {
  pushError,
  hasOwn,
  trimIfString,
  isPlainObject,
  normalizeKey,
  normalizeBoolean,
  normalizeStringArray,
  normalizeStringArrayStrict,
  toNumberIfPresent,
  validateUniqueStringArray,
};
