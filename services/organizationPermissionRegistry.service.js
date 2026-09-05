const AppError = require("../utils/AppError");

const GROUPS = Object.freeze([
  {
    code: "governance",
    label: "Governance",
    permissions: [
      ["organization.profile.manage", "Modificare il profilo dell'organizzazione"],
      ["organization.members.view", "Visualizzare i membri"],
      ["organization.members.manage", "Aggiungere e rimuovere membri", true],
      ["organization.roles.view", "Visualizzare ruoli e permessi"],
      ["organization.roles.assign", "Assegnare ruoli", true],
      ["organization.roles.manage", "Creare e modificare ruoli", true],
      ["organization.audit.view", "Visualizzare il registro autorizzativo"],
    ],
  },
  {
    code: "editorial_space",
    label: "Spazio editoriale",
    permissions: [
      ["editorial_space.view", "Visualizzare lo spazio editoriale"],
      ["editorial_space.manage", "Gestire lo spazio editoriale", true],
    ],
  },
  {
    code: "item",
    label: "Contenuti",
    permissions: [
      ["item.view", "Visualizzare i contenuti"],
      ["item.create", "Creare contenuti"],
      ["item.edit", "Modificare contenuti"],
      ["item.review", "Revisionare contenuti", true],
      ["item.publish", "Pubblicare contenuti", true],
      ["item.lifecycle.manage", "Gestire il ciclo di vita dei contenuti", true],
    ],
  },
  {
    code: "namespace",
    label: "Namespace e vocabolari",
    permissions: [
      ["namespace.view", "Visualizzare Namespace"],
      ["namespace.create", "Creare Namespace"],
      ["namespace.edit", "Modificare Namespace"],
      ["namespace.review", "Revisionare Namespace", true],
      ["namespace.publish", "Pubblicare Namespace", true],
      ["namespace.lifecycle.manage", "Gestire il ciclo di vita dei Namespace", true],
    ],
  },
  {
    code: "physical_vocabulary",
    label: "Vocabolari fisici",
    permissions: [
      ["physical_vocabulary.view", "Visualizzare vocabolari fisici"],
      ["physical_vocabulary.create", "Creare vocabolari fisici"],
      ["physical_vocabulary.edit", "Modificare vocabolari fisici"],
      ["physical_vocabulary.review", "Revisionare vocabolari fisici", true],
      ["physical_vocabulary.publish", "Pubblicare vocabolari fisici", true],
      ["physical_vocabulary.lifecycle.manage", "Gestire il ciclo di vita dei vocabolari fisici", true],
    ],
  },
  {
    code: "editorial",
    label: "Contesti editoriali e grafo semantico",
    permissions: [
      ["editorial_context.view", "Visualizzare contesti editoriali"],
      ["editorial_context.create", "Creare contesti editoriali"],
      ["editorial_context.edit", "Modificare contesti editoriali"],
      ["editorial_context.review", "Revisionare contesti editoriali", true],
      ["semantic_graph.edit", "Modificare il grafo semantico"],
      ["editorial_release.publish", "Pubblicare release editoriali", true],
      ["editorial_context.lifecycle.manage", "Gestire il ciclo di vita dei contesti", true],
    ],
  },
  {
    code: "visit",
    label: "Visite",
    permissions: [
      ["visit.view", "Visualizzare visite"],
      ["visit.create", "Creare visite"],
      ["visit.edit", "Modificare visite"],
      ["visit.review", "Revisionare visite", true],
      ["visit.publish", "Pubblicare visite", true],
      ["visit.lifecycle.manage", "Gestire il ciclo di vita delle visite", true],
    ],
  },
  {
    code: "venue",
    label: "Sedi",
    permissions: [
      ["venue.view", "Visualizzare sedi"],
      ["venue.create", "Creare sedi"],
      ["venue.profile.manage", "Modificare il profilo delle sedi"],
      ["venue.primary_context.manage", "Gestire il contesto primario"],
      ["venue.inventory.manage", "Gestire l'inventario della sede", true],
      ["venue.physical.edit", "Modificare la configurazione fisica"],
      ["venue.physical.review", "Revisionare la configurazione fisica", true],
      ["venue.physical.publish", "Pubblicare la configurazione fisica", true],
      ["venue.lifecycle.manage", "Gestire il ciclo di vita delle sedi", true],
    ],
  },
  {
    code: "marketplace",
    label: "Marketplace",
    permissions: [
      ["marketplace.acquisitions.view", "Visualizzare le acquisizioni"],
      ["marketplace.acquire", "Acquisire risorse", true],
      ["marketplace.distribution.view", "Visualizzare la distribuzione"],
      ["marketplace.distribution.manage", "Gestire offerte e distribuzione", true],
      ["marketplace.finance.view", "Visualizzare dati finanziari", true],
    ],
  },
]);

const DEPENDENCIES = Object.freeze({
  "organization.members.manage": ["organization.members.view"],
  "organization.roles.assign": ["organization.roles.view", "organization.members.view"],
  "organization.roles.manage": ["organization.roles.view"],
  "editorial_space.manage": ["editorial_space.view"],
  "item.create": ["item.view"],
  "item.edit": ["item.view"],
  "item.review": ["item.view"],
  "item.publish": ["item.view"],
  "item.lifecycle.manage": ["item.view"],
  "namespace.create": ["namespace.view"],
  "namespace.edit": ["namespace.view"],
  "namespace.review": ["namespace.view"],
  "namespace.publish": ["namespace.view"],
  "namespace.lifecycle.manage": ["namespace.view"],
  "physical_vocabulary.create": ["physical_vocabulary.view"],
  "physical_vocabulary.edit": ["physical_vocabulary.view"],
  "physical_vocabulary.review": ["physical_vocabulary.view"],
  "physical_vocabulary.publish": ["physical_vocabulary.view"],
  "physical_vocabulary.lifecycle.manage": ["physical_vocabulary.view"],
  "editorial_context.create": ["editorial_context.view"],
  "editorial_context.edit": ["editorial_context.view"],
  "editorial_context.review": ["editorial_context.view"],
  "semantic_graph.edit": ["editorial_context.view"],
  "editorial_release.publish": ["editorial_context.view"],
  "editorial_context.lifecycle.manage": ["editorial_context.view"],
  "visit.create": ["visit.view"],
  "visit.edit": ["visit.view"],
  "visit.review": ["visit.view"],
  "visit.publish": ["visit.view"],
  "visit.lifecycle.manage": ["visit.view"],
  "venue.create": ["venue.view"],
  "venue.profile.manage": ["venue.view"],
  "venue.primary_context.manage": ["venue.view"],
  "venue.inventory.manage": ["venue.view"],
  "venue.physical.edit": ["venue.view"],
  "venue.physical.review": ["venue.view"],
  "venue.physical.publish": ["venue.view"],
  "venue.lifecycle.manage": ["venue.view"],
  "marketplace.acquire": ["marketplace.acquisitions.view"],
  "marketplace.distribution.manage": ["marketplace.distribution.view"],
});

const PERMISSIONS = Object.freeze(GROUPS.flatMap((group) => group.permissions.map(([code, label, highImpact = false]) => Object.freeze({
  code,
  label,
  groupCode: group.code,
  groupLabel: group.label,
  highImpact,
  dependencies: Object.freeze([...(DEPENDENCIES[code] || [])]),
}))));
const PERMISSION_CODES = Object.freeze(PERMISSIONS.map((permission) => permission.code));
const PERMISSION_CODE_SET = new Set(PERMISSION_CODES);

function permissionClosure(codes) {
  const closure = new Set();
  const visit = (code) => {
    if (closure.has(code)) return;
    if (!PERMISSION_CODE_SET.has(code)) {
      throw new AppError("Permesso non riconosciuto", 400, [{ field: "permissionCodes", code: "UNKNOWN_PERMISSION", value: code }]);
    }
    closure.add(code);
    for (const dependency of DEPENDENCIES[code] || []) visit(dependency);
  };
  for (const code of codes || []) visit(String(code));
  return [...closure].sort();
}

function permissionsAreSubset(candidate, ceiling) {
  const available = new Set(ceiling || []);
  return (candidate || []).every((code) => available.has(code));
}

const byPrefix = (prefixes) => PERMISSION_CODES.filter((code) => prefixes.some((prefix) => code.startsWith(prefix)));
const ALL_PERMISSIONS = [...PERMISSION_CODES];
const STARTER_ROLES = Object.freeze([
  {
    key: "administrator",
    name: "Administrator",
    description: "Amministrazione completa dell'organizzazione.",
    permissionCodes: ALL_PERMISSIONS,
  },
  {
    key: "curator",
    name: "Curator",
    description: "Cura, revisione e pubblicazione del patrimonio editoriale.",
    permissionCodes: [
      ...byPrefix(["editorial_space.", "item.", "namespace.", "physical_vocabulary.", "editorial_context.", "semantic_graph.", "editorial_release.", "visit."]),
      "venue.view",
      "venue.primary_context.manage",
      "venue.inventory.manage",
    ],
  },
  {
    key: "contributor",
    name: "Contributor",
    description: "Creazione e modifica di contenuti e visite senza pubblicazione.",
    permissionCodes: [
      "editorial_space.view", "item.view", "item.create", "item.edit", "namespace.view", "physical_vocabulary.view",
      "editorial_context.view", "visit.view", "visit.create", "visit.edit",
    ],
  },
  {
    key: "venue_manager",
    name: "Venue Manager",
    description: "Gestione completa delle sedi e della loro configurazione fisica.",
    permissionCodes: byPrefix(["venue.", "physical_vocabulary."]),
  },
  {
    key: "marketplace_manager",
    name: "Marketplace Manager",
    description: "Acquisizione e distribuzione delle risorse nel Marketplace.",
    permissionCodes: [
      "item.view", "namespace.view", "physical_vocabulary.view", "editorial_context.view", "visit.view",
      ...byPrefix(["marketplace."]),
    ],
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Consultazione in sola lettura.",
    permissionCodes: [
      "editorial_space.view", "item.view", "namespace.view", "physical_vocabulary.view", "editorial_context.view",
      "visit.view", "venue.view",
    ],
  },
].map((role) => Object.freeze({ ...role, permissionCodes: Object.freeze(permissionClosure(role.permissionCodes)) })));

function projectPermissionCatalog() {
  return GROUPS.map((group) => ({
    code: group.code,
    label: group.label,
    permissions: PERMISSIONS.filter((permission) => permission.groupCode === group.code),
  }));
}

module.exports = {
  PERMISSIONS,
  PERMISSION_CODES,
  STARTER_ROLES,
  permissionClosure,
  permissionsAreSubset,
  projectPermissionCatalog,
};
