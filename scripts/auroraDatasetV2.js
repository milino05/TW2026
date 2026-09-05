const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const Organization = require("../models/organization.model");
const OrganizationRole = require("../models/organizationRole.model");
const OrganizationMembership = require("../models/organizationMembership.model");
const OrganizationAuthorizationEvent = require("../models/organizationAuthorizationEvent.model");
const Subject = require("../models/subject.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceItemMembership = require("../models/contentSpaceItemMembership.model");
const ContentSpaceSubjectMembership = require("../models/contentSpaceSubjectMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const CollectionItemMembership = require("../models/collectionItemMembership.model");
const CollectionSubjectMembership = require("../models/collectionSubjectMembership.model");
const SemanticGraph = require("../models/semanticGraph.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const ExhibitSlot = require("../models/exhibitSlot.model");
const PhysicalVocabulary = require("../models/physicalVocabulary.model");
const PhysicalVocabularyRevision = require("../models/physicalVocabularyRevision.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueRelease = require("../models/venueRelease.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const VisitSessionV2 = require("../models/visitSessionV2.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const MarketplaceAcquisition = require("../models/marketplaceAcquisition.model");
const Entitlement = require("../models/entitlement.model");
const { validateNamespaceRevisionSnapshot } = require("../services/validation/namespace.validation");
const { validatePresentationAgainstNamespace } = require("../services/itemV2Presentation.service");
const { validateEditorialReleaseCoherence } = require("../services/editorialReleaseIntegrity.service");
const { computeVenueReleaseIssues } = require("../services/venueReleaseIntegrity.service");
const { computeVisitV2Integrity } = require("../services/visitV2Integrity.service");
const { assertSelfContainedOffer } = require("../services/marketplaceOfferIntegrity.service");
const { acquireOffer } = require("../services/marketplaceV2.service");
const { listNavigatorLibrary, listNavigatorMuseums } = require("../services/navigatorVisitV2.service");
const { ensureRequiredUsers } = require("./examDatasetV2");
const { ensureStarterRoles, replaceMembershipWithStarterRole } = require("../services/organizationBootstrap.service");
const { createDemoPhysicalVocabulary, physicalAttributeValues } = require("./demoPhysicalVocabulary");

const AURORA_VENUE_ID = "64a12f680000000000000002";
const AURORA_MAP_URL = "/maps/museo-aurora-demo.svg";
const FIXED_NOW = new Date("2026-08-24T10:00:00.000Z");

function auroraId(name) {
  return new mongoose.Types.ObjectId(
    crypto.createHash("sha1").update(`artaround-aurora:${name}`).digest("hex").slice(0, 24),
  );
}

const IDS = Object.freeze({
  organization: auroraId("organization"),
  venue: new mongoose.Types.ObjectId(AURORA_VENUE_ID),
  namespace: auroraId("namespace"),
  namespaceRevision: auroraId("namespace_revision"),
  contentSpace: auroraId("content_space"),
  editorialContext: auroraId("editorial_context"),
  semanticGraph: auroraId("semantic_graph"),
  graphRevision: auroraId("graph_revision"),
  editorialRelease: auroraId("editorial_release"),
  physicalVocabulary: auroraId("physical_vocabulary"),
  physicalVocabularyRevision: auroraId("physical_vocabulary_revision"),
  layoutRevision: auroraId("layout_revision"),
  venueRelease: auroraId("venue_release"),
});

const DEF = Object.freeze({
  subjectWork: "a1111111-1111-4111-8111-111111111111",
  subjectTheme: "a2222222-2222-4222-8222-222222222222",
  relationTheme: "a3333333-3333-4333-8333-333333333333",
  relationRelatedWork: "a4444444-4444-4444-8444-444444444444",
  durationShort: "a5555555-5555-4555-8555-555555555551",
  durationMedium: "a5555555-5555-4555-8555-555555555552",
  durationLong: "a5555555-5555-4555-8555-555555555553",
  languageSimple: "a6666666-6666-4666-8666-666666666661",
  languageStandard: "a6666666-6666-4666-8666-666666666662",
  languageAdvanced: "a6666666-6666-4666-8666-666666666663",
  aspectObservation: "a7777777-7777-4777-8777-777777777771",
  aspectContext: "a7777777-7777-4777-8777-777777777772",
  aspectAnalysis: "a7777777-7777-4777-8777-777777777773",
  signalCollection: "a8888888-8888-4888-8888-888888888881",
  signalLight: "a8888888-8888-4888-8888-888888888882",
  signalCommunity: "a8888888-8888-4888-8888-888888888883",
});

const THEMES = Object.freeze([
  { key: "luce", label: "Luce e trasformazione", description: "La luce come strumento per osservare il cambiamento urbano." },
  { key: "spazi", label: "Spazi e memoria", description: "Architetture, luoghi e tracce della memoria cittadina." },
  { key: "comunita", label: "Città e comunità", description: "Il lavoro, gli incontri e la vita condivisa nello spazio urbano." },
]);

const WORKS = Object.freeze([
  { key: "alba-portico", title: "Alba sul portico", artist: "Elena Valli", theme: "luce", focus: "la luce radente che scandisce colonne e passaggi" },
  { key: "riflessi-canale", title: "Riflessi sul canale", artist: "Bruno Fabbri", theme: "luce", focus: "il rapporto tra superficie dell'acqua, facciate e cielo" },
  { key: "ritratto-ada", title: "Ritratto di Ada", artist: "Lucia Serra", theme: "comunita", focus: "lo sguardo della protagonista e gli indizi del suo ambiente" },
  { key: "mercato-inverno", title: "Mercato d'inverno", artist: "Paolo Neri", theme: "comunita", focus: "i gesti quotidiani e il ritmo delle figure nello spazio" },
  { key: "geometrie-portico", title: "Geometrie del portico", artist: "Anna Costa", theme: "spazi", focus: "la ripetizione degli archi e la profondità prospettica" },
  { key: "notturno-stazione", title: "Notturno alla stazione", artist: "Carlo Bassi", theme: "luce", focus: "le sorgenti artificiali e le attese dei viaggiatori" },
  { key: "giardino-mura", title: "Giardino delle mura", artist: "Sofia Lodi", theme: "spazi", focus: "la convivenza tra vegetazione e stratificazioni architettoniche" },
  { key: "voci-piazza", title: "Voci in piazza", artist: "Davide Conti", theme: "comunita", focus: "la disposizione dei gruppi e la costruzione di uno spazio comune" },
  { key: "officina-aurora", title: "Officina Aurora", artist: "Irene Morelli", theme: "comunita", focus: "gli strumenti, le mani e la dimensione collettiva del lavoro" },
  { key: "orizzonte-urbano", title: "Orizzonte urbano", artist: "Matteo Greco", theme: "spazi", focus: "il confine tra profilo degli edifici e spazio aperto" },
]);

const VISIT_DEFINITIONS = Object.freeze([
  {
    key: "capolavori",
    title: "Capolavori di Aurora",
    description: "Dieci opere per scoprire la collezione del Museo Civico Aurora.",
    workIndexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    depth: 0.4,
    complexity: 0.35,
  },
  {
    key: "luci-memoria",
    title: "Luci, spazi e memoria",
    description: "Sette tappe dedicate alla luce e alle trasformazioni dei luoghi urbani.",
    workIndexes: [0, 1, 4, 5, 6, 9, 2],
    depth: 0.6,
    complexity: 0.5,
  },
  {
    key: "citta-comunita",
    title: "Città, lavoro e comunità",
    description: "Sette opere raccontano persone, incontri e lavoro nella città di Aurora.",
    workIndexes: [2, 3, 7, 8, 4, 9, 1],
    depth: 0.75,
    complexity: 0.65,
  },
]);

function idMap(prefix, values) {
  return new Map(values.map((entry) => [entry.key, auroraId(`${prefix}:${entry.key}`)]));
}

const workSubjectIds = idMap("subject:work", WORKS);
const themeSubjectIds = idMap("subject:theme", THEMES);

function reviewApproved(requestedBy, approvedBy) {
  return {
    requestedAt: FIXED_NOW,
    requestedBy,
    reviewedAt: FIXED_NOW,
    reviewedBy: approvedBy,
    decision: "approved",
    message: null,
    events: [
      { action: "review_requested", actorUserId: requestedBy, at: FIXED_NOW, message: null },
      { action: "published", actorUserId: approvedBy, at: FIXED_NOW, message: null },
    ],
  };
}

function assertNoIssues(label, issues) {
  const blocking = (issues || []).filter((issue) => issue.severity !== "warning");
  if (blocking.length) throw new Error(`${label}: ${JSON.stringify(blocking)}`);
}

function workText(work, level) {
  const base = `${work.title} è un'opera dimostrativa di ${work.artist}, creata per il dataset del Museo Civico Aurora.`;
  if (level === "essential") return `${base} Osserva soprattutto ${work.focus}.`;
  if (level === "context") {
    return `${base} Nel percorso viene collegata al tema “${THEMES.find((theme) => theme.key === work.theme).label}”. Confronta ${work.focus} con le opere vicine e nota come cambia il racconto della città.`;
  }
  return `${base} Per una lettura approfondita considera ${work.focus}, distinguendo composizione, punto di vista, ritmo visivo e relazione con il contesto urbano. Formula quindi un confronto motivato con le altre tappe del percorso.`;
}

function datasetIds() {
  return {
    itemIds: WORKS.map((work) => auroraId(`item:${work.key}`)),
    editionIds: WORKS.map((work) => auroraId(`edition:${work.key}`)),
    revisionIds: WORKS.map((work) => auroraId(`item-revision:${work.key}`)),
    targetIds: WORKS.map((work) => auroraId(`venue-target:${work.key}`)),
    subjectIds: [...workSubjectIds.values(), ...themeSubjectIds.values()],
    visitIds: VISIT_DEFINITIONS.map((visit) => auroraId(`visit:${visit.key}`)),
    visitRevisionIds: VISIT_DEFINITIONS.map((visit) => auroraId(`visit-revision:${visit.key}`)),
    listingIds: VISIT_DEFINITIONS.map((visit) => auroraId(`listing:${visit.key}`)),
    offerIds: VISIT_DEFINITIONS.map((visit) => auroraId(`offer:${visit.key}`)),
  };
}

async function cleanupAuroraDataset() {
  const ids = datasetIds();
  const acquisitions = await MarketplaceAcquisition.find({ offerId: { $in: ids.offerIds } }).select("_id").lean();
  const acquisitionIds = acquisitions.map((entry) => entry._id);
  await Entitlement.deleteMany({
    $or: [
      ...(acquisitionIds.length ? [{ sourceAcquisitionId: { $in: acquisitionIds } }] : []),
      { resourceType: "visit", resourceId: { $in: ids.visitIds } },
    ],
  });
  if (acquisitionIds.length) await MarketplaceAcquisition.deleteMany({ _id: { $in: acquisitionIds } });
  await MarketplaceOffer.deleteMany({ _id: { $in: ids.offerIds } });
  await MarketplaceListing.deleteMany({ _id: { $in: ids.listingIds } });
  await VisitSessionV2.deleteMany({ visitId: { $in: ids.visitIds } });
  await VisitRevisionV2.deleteMany({ _id: { $in: ids.visitRevisionIds } });
  await VisitV2.deleteMany({ _id: { $in: ids.visitIds } });
  await VenueRelease.deleteMany({ _id: IDS.venueRelease });
  await LayoutRevision.deleteMany({ _id: IDS.layoutRevision });
  await ExhibitSlot.deleteMany({ venueId: IDS.venue });
  await PhysicalVocabularyRevision.deleteMany({ _id: IDS.physicalVocabularyRevision });
  await PhysicalVocabulary.deleteMany({ _id: IDS.physicalVocabulary });
  await VenueTarget.deleteMany({ _id: { $in: ids.targetIds } });
  await Venue.deleteMany({ _id: IDS.venue });
  await EditorialRelease.deleteMany({ _id: IDS.editorialRelease });
  await CollectionItemMembership.deleteMany({ editorialContextId: IDS.editorialContext });
  await CollectionSubjectMembership.deleteMany({ editorialContextId: IDS.editorialContext });
  await SemanticEdgeV2.deleteMany({ graphRevisionId: IDS.graphRevision });
  await GraphSubjectBinding.deleteMany({ graphRevisionId: IDS.graphRevision });
  await SemanticGraphRevision.deleteMany({ _id: IDS.graphRevision });
  await EditorialContext.deleteMany({ _id: IDS.editorialContext });
  await SemanticGraph.deleteMany({ _id: IDS.semanticGraph });
  await ContentSpaceItemMembership.deleteMany({ contentSpaceId: IDS.contentSpace });
  await ContentSpaceSubjectMembership.deleteMany({ contentSpaceId: IDS.contentSpace });
  await ContentSpace.deleteMany({ _id: IDS.contentSpace });
  await ItemRevisionV2.deleteMany({ _id: { $in: ids.revisionIds } });
  await ItemEdition.deleteMany({ _id: { $in: ids.editionIds } });
  await ItemV2.deleteMany({ _id: { $in: ids.itemIds } });
  await NamespaceRevision.deleteMany({ _id: IDS.namespaceRevision });
  await Namespace.deleteMany({ _id: IDS.namespace });
  await Subject.deleteMany({ _id: { $in: ids.subjectIds } });
  await OrganizationAuthorizationEvent.deleteMany({ organizationId: IDS.organization });
  await OrganizationMembership.deleteMany({ organizationId: IDS.organization });
  await OrganizationRole.deleteMany({ organizationId: IDS.organization });
  await Organization.deleteMany({ _id: IDS.organization });
}

async function seedAuroraDataset({ pinacotecaVisitRecords = [] } = {}) {
  const users = await ensureRequiredUsers();
  await cleanupAuroraDataset();
  const manager = users.autore1;
  const operator = users.autore2;

  const organization = await Organization.create({
    _id: IDS.organization,
    name: "Museo Civico Aurora — Demo ArtAround",
    description: "Organizzazione e collezione interamente dimostrative per verificare il Navigator multi-museo.",
    createdBy: manager._id,
    owners: [{ userId: manager._id, grantedBy: manager._id, grantedAt: FIXED_NOW }],
  });
  await ensureStarterRoles({ organizationId: organization._id, actorUserId: manager._id });
  await replaceMembershipWithStarterRole({ organizationId: organization._id, userId: manager._id, starterKey: "administrator", actorUserId: manager._id, assignedAt: FIXED_NOW });
  await replaceMembershipWithStarterRole({ organizationId: organization._id, userId: operator._id, starterKey: "contributor", actorUserId: manager._id, assignedAt: FIXED_NOW });

  for (const theme of THEMES) {
    await Subject.create({
      _id: themeSubjectIds.get(theme.key),
      preferredLabel: theme.label,
      description: theme.description,
      externalRefs: [],
      createdBy: manager._id,
    });
  }
  for (const work of WORKS) {
    await Subject.create({
      _id: workSubjectIds.get(work.key),
      preferredLabel: work.title,
      description: `${work.title}, ${work.artist}. Opera originale del dataset dimostrativo Museo Civico Aurora.`,
      externalRefs: [],
      createdBy: manager._id,
    });
  }

  const namespace = await Namespace.create({
    _id: IDS.namespace,
    name: "Museo Aurora — Italiano",
    description: "Vocabolario editoriale dimostrativo per percorsi su arte, città e comunità.",
    ownerType: "organization",
    ownerId: organization._id,
    createdBy: manager._id,
  });
  const namespaceSnapshot = {
    subjectClasses: [
      { definitionId: DEF.subjectWork, key: "work", label: "Opera", description: "Opera principale di una tappa." },
      { definitionId: DEF.subjectTheme, key: "theme", label: "Tema", description: "Tema trasversale della collezione." },
    ],
    relationTypes: [
      {
        definitionId: DEF.relationTheme,
        key: "belongs-to-theme",
        label: "Appartiene al tema",
        description: "Collega un'opera a un tema della collezione.",
        domainDefinitionIds: [DEF.subjectWork],
        rangeDefinitionIds: [DEF.subjectTheme],
        category: "contextual",
        strength: "medium",
        userIntents: ["APPROFONDISCI_CONTESTO"],
        directionality: "directed",
        reverse: { label: "Comprende l'opera", userIntents: ["MOSTRA_OPERE"] },
        validationRules: { allowMultiple: true, targetRequired: true },
      },
      {
        definitionId: DEF.relationRelatedWork,
        key: "related-work",
        label: "Opera correlata",
        description: "Collega opere utili per un confronto editoriale.",
        domainDefinitionIds: [DEF.subjectWork],
        rangeDefinitionIds: [DEF.subjectWork],
        category: "editorial",
        strength: "weak",
        userIntents: ["CONFRONTA"],
        directionality: "symmetric",
        validationRules: { allowMultiple: true, targetRequired: true },
      },
    ],
    durationTypes: [
      { definitionId: DEF.durationShort, key: "short", label: "Breve", description: "Descrizione essenziale.", targetSeconds: 60 },
      { definitionId: DEF.durationMedium, key: "medium", label: "Media", description: "Descrizione contestuale.", targetSeconds: 120 },
      { definitionId: DEF.durationLong, key: "long", label: "Approfondita", description: "Descrizione analitica.", targetSeconds: 210 },
    ],
    languageLevels: [
      { definitionId: DEF.languageSimple, key: "simple", label: "Semplice", description: "Lessico accessibile e frasi brevi." },
      { definitionId: DEF.languageStandard, key: "standard", label: "Standard", description: "Lessico artistico introdotto nel contesto." },
      { definitionId: DEF.languageAdvanced, key: "advanced", label: "Avanzato", description: "Lessico analitico per utenti esperti." },
    ],
    presentationAspects: [
      { definitionId: DEF.aspectObservation, key: "observation", label: "Osservazione", description: "Guida lo sguardo verso elementi visivi riconoscibili." },
      { definitionId: DEF.aspectContext, key: "context", label: "Contesto", description: "Collega l'opera ai temi urbani del percorso." },
      { definitionId: DEF.aspectAnalysis, key: "analysis", label: "Analisi", description: "Propone una lettura comparativa e argomentata." },
    ],
    selectionSignals: [
      { definitionId: DEF.signalCollection, key: "aurora-collection", label: "Collezione Aurora", description: "Opera centrale del corpus dimostrativo Aurora." },
      { definitionId: DEF.signalLight, key: "light-space", label: "Luce e spazio", description: "Utile per percorsi su luce, architettura e memoria." },
      { definitionId: DEF.signalCommunity, key: "community", label: "Comunità", description: "Utile per percorsi sulla vita urbana e il lavoro." },
    ],
  };
  assertNoIssues("Namespace Aurora non coerente", validateNamespaceRevisionSnapshot(namespaceSnapshot, { requireCoreScales: true }));
  const namespaceRevision = await NamespaceRevision.create({
    _id: IDS.namespaceRevision,
    namespaceId: namespace._id,
    version: 1,
    ...namespaceSnapshot,
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: manager._id },
    review: reviewApproved(operator._id, manager._id),
    publication: { publishedAt: FIXED_NOW, publishedBy: manager._id },
    createdBy: manager._id,
    updatedBy: manager._id,
  });
  namespace.publishedRevisionId = namespaceRevision._id;
  await namespace.save();

  const itemRecords = [];
  for (const work of WORKS) {
    const item = await ItemV2.create({
      _id: auroraId(`item:${work.key}`),
      primarySubjectId: workSubjectIds.get(work.key),
      ownerType: "organization",
      ownerId: organization._id,
      provenance: { origin: "human", metadata: { dataset: "TW2026 Museo Aurora demo" } },
      createdBy: manager._id,
    });
    const edition = await ItemEdition.create({
      _id: auroraId(`edition:${work.key}`),
      itemId: item._id,
      namespaceId: namespace._id,
      createdBy: manager._id,
    });
    const variants = {
      essential: auroraId(`variant:${work.key}:essential`),
      context: auroraId(`variant:${work.key}:context`),
      advanced: auroraId(`variant:${work.key}:advanced`),
    };
    const representations = {
      essential: auroraId(`representation:${work.key}:essential`),
      context: auroraId(`representation:${work.key}:context`),
      advanced: auroraId(`representation:${work.key}:advanced`),
    };
    const themeId = themeSubjectIds.get(work.theme);
    const themeSignal = work.theme === "comunita" ? DEF.signalCommunity : DEF.signalLight;
    const revision = await ItemRevisionV2.create({
      _id: auroraId(`item-revision:${work.key}`),
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: `${work.title} — ${work.artist}`,
      relatedSubjectIds: [themeId],
      tags: [work.artist, work.theme, "museo-aurora"],
      authorCredits: ["Dataset dimostrativo ArtAround"],
      metadata: { license: "CC BY 4.0 — contenuto dimostrativo originale ArtAround" },
      selectionSignals: [
        { definitionId: DEF.signalCollection, weight: 1 },
        { definitionId: themeSignal, weight: 0.85 },
      ],
      presentationVariants: [
        {
          _id: variants.essential,
          key: "essential",
          label: "Essenziale",
          description: "Introduzione accessibile.",
          semanticFocus: [{ subjectId: item.primarySubjectId, weight: 1 }],
          presentationAspects: [{ definitionId: DEF.aspectObservation, weight: 1 }],
          audienceSuitability: { minAgeYears: 10, minMaturity: 0.1, maxMaturity: 1 },
          knowledgeRequirements: [],
          representations: [{
            _id: representations.essential,
            durationTypeDefinitionId: DEF.durationShort,
            languageLevelDefinitionId: DEF.languageSimple,
            locale: "it-IT",
            text: workText(work, "essential"),
          }],
        },
        {
          _id: variants.context,
          key: "context",
          label: "Contesto",
          description: "Lettura intermedia e tematica.",
          semanticFocus: [{ subjectId: item.primarySubjectId, weight: 0.8 }, { subjectId: themeId, weight: 0.75 }],
          presentationAspects: [{ definitionId: DEF.aspectContext, weight: 1 }],
          audienceSuitability: { minAgeYears: 14, minMaturity: 0.3, maxMaturity: 1 },
          knowledgeRequirements: [{ subjectId: themeId, minLevel: 0.1, maxLevel: 1, weight: 0.5 }],
          representations: [{
            _id: representations.context,
            durationTypeDefinitionId: DEF.durationMedium,
            languageLevelDefinitionId: DEF.languageStandard,
            locale: "it-IT",
            text: workText(work, "context"),
          }],
        },
        {
          _id: variants.advanced,
          key: "advanced",
          label: "Approfondimento",
          description: "Lettura analitica e comparativa.",
          semanticFocus: [{ subjectId: item.primarySubjectId, weight: 0.8 }, { subjectId: themeId, weight: 1 }],
          presentationAspects: [{ definitionId: DEF.aspectAnalysis, weight: 1 }],
          audienceSuitability: { minAgeYears: 16, minMaturity: 0.5, maxMaturity: 1 },
          knowledgeRequirements: [{ subjectId: themeId, minLevel: 0.4, maxLevel: 1, weight: 1 }],
          representations: [{
            _id: representations.advanced,
            durationTypeDefinitionId: DEF.durationLong,
            languageLevelDefinitionId: DEF.languageAdvanced,
            locale: "it-IT",
            text: workText(work, "advanced"),
          }],
        },
      ],
      defaultPresentation: { variantId: variants.essential, representationId: representations.essential },
      provenance: { origin: "human", metadata: { dataset: "TW2026 Museo Aurora demo" } },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: manager._id },
      review: reviewApproved(operator._id, manager._id),
      publication: { publishedAt: FIXED_NOW, publishedBy: manager._id },
      createdBy: manager._id,
      updatedBy: manager._id,
    });
    assertNoIssues(`ItemRevision Aurora non coerente: ${work.key}`, validatePresentationAgainstNamespace(revision, namespaceRevision));
    edition.publishedRevisionId = revision._id;
    await edition.save();
    itemRecords.push({ work, item, edition, revision });
  }

  const contentSpace = await ContentSpace.create({
    _id: IDS.contentSpace,
    name: "Museo Aurora — Collezione demo",
    description: "Corpus editoriale originale per le visite e il generatore del Museo Civico Aurora.",
    ownerType: "organization",
    ownerId: organization._id,
    createdBy: manager._id,
  });
  const editorialSubjectIds = [...workSubjectIds.values(), ...themeSubjectIds.values()];
  await ContentSpaceItemMembership.create(
    itemRecords.map(({ item }) => ({ contentSpaceId: contentSpace._id, itemId: item._id, addedBy: manager._id })),
  );
  await ContentSpaceSubjectMembership.create(
    editorialSubjectIds.map((subjectId) => ({ contentSpaceId: contentSpace._id, subjectId, addedBy: manager._id })),
  );
  const semanticGraph = await SemanticGraph.create({
    _id: IDS.semanticGraph,
    namespaceId: namespace._id,
    displayName: "Museo Aurora — Relazioni editoriali",
    description: "Grafo semantico riutilizzabile del dataset del Museo Civico Aurora.",
    ownerType: contentSpace.ownerType,
    ownerId: contentSpace.ownerId,
    createdBy: manager._id,
  });
  const editorialContext = await EditorialContext.create({
    _id: IDS.editorialContext,
    contentSpaceId: contentSpace._id,
    namespaceId: namespace._id,
    semanticGraphId: semanticGraph._id,
    displayName: "Museo Aurora — Percorsi tra arte e città",
    shortDescription: "Contesto editoriale dimostrativo dedicato alla città di Aurora.",
    description: "Raccoglie dieci opere originali e tre temi: luce, spazi e comunità.",
    createdBy: manager._id,
  });
  await CollectionItemMembership.create(itemRecords.map(({ item }) => ({
    editorialContextId: editorialContext._id,
    itemId: item._id,
    curationSignals: [{ definitionId: DEF.signalCollection, weight: 1 }],
    addedBy: manager._id,
    updatedBy: manager._id,
  })));
  await CollectionSubjectMembership.create(editorialSubjectIds.map((subjectId) => ({
    editorialContextId: editorialContext._id,
    subjectId,
    addedBy: manager._id,
  })));
  const graphRevision = await SemanticGraphRevision.create({
    _id: IDS.graphRevision,
    semanticGraphId: semanticGraph._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    createdBy: manager._id,
  });
  semanticGraph.workingRevisionId = graphRevision._id;
  semanticGraph.workingVersion = 1;
  await semanticGraph.save();
  await GraphSubjectBinding.create([
    ...WORKS.map((work) => ({
      graphRevisionId: graphRevision._id,
      subjectId: workSubjectIds.get(work.key),
      subjectClassDefinitionIds: [DEF.subjectWork],
    })),
    ...THEMES.map((theme) => ({
      graphRevisionId: graphRevision._id,
      subjectId: themeSubjectIds.get(theme.key),
      subjectClassDefinitionIds: [DEF.subjectTheme],
    })),
  ]);
  const semanticEdges = WORKS.map((work) => ({
    graphRevisionId: graphRevision._id,
    sourceSubjectId: workSubjectIds.get(work.key),
    targetSubjectId: themeSubjectIds.get(work.theme),
    relationTypeDefinitionId: DEF.relationTheme,
    weight: 1,
    provenance: { origin: "human" },
  }));
  for (const [a, b] of [[0, 1], [1, 5], [4, 6], [6, 9], [2, 3], [3, 7], [7, 8]]) {
    semanticEdges.push({
      graphRevisionId: graphRevision._id,
      sourceSubjectId: workSubjectIds.get(WORKS[a].key),
      targetSubjectId: workSubjectIds.get(WORKS[b].key),
      relationTypeDefinitionId: DEF.relationRelatedWork,
      weight: 0.7,
      provenance: { origin: "human" },
    });
  }
  await SemanticEdgeV2.create(semanticEdges);
  const itemBindings = itemRecords.map(({ item, edition, revision, work }) => ({
    _id: auroraId(`editorial-binding:${work.key}`),
    itemId: item._id,
    itemEditionId: edition._id,
    itemRevisionId: revision._id,
    curationSignals: [{ definitionId: DEF.signalCollection, weight: 1 }],
  }));
  const editorialRelease = await EditorialRelease.create({
    _id: IDS.editorialRelease,
    editorialContextId: editorialContext._id,
    version: 1,
    namespaceRevisionId: namespaceRevision._id,
    graphRevisionId: graphRevision._id,
    subjectIds: editorialSubjectIds,
    itemBindings,
    integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: manager._id },
    releasedAt: FIXED_NOW,
    releasedBy: manager._id,
  });
  const editorialIssues = await validateEditorialReleaseCoherence({
    editorialContextId: editorialContext._id,
    namespaceRevisionId: namespaceRevision._id,
    graphRevisionId: graphRevision._id,
    subjectIds: editorialSubjectIds,
    itemBindings,
  });
  assertNoIssues("EditorialRelease Aurora non coerente", editorialIssues);
  editorialContext.publishedReleaseId = editorialRelease._id;
  await editorialContext.save();

  const physical = await createDemoPhysicalVocabulary({
    physicalVocabularyId: IDS.physicalVocabulary,
    revisionId: IDS.physicalVocabularyRevision,
    organizationId: organization._id,
    userId: manager._id,
    name: "Museo Aurora — Vocabolario fisico",
    now: FIXED_NOW,
  });
  const floorId = auroraId("floor:piano-terra");
  const placeTypeId = (key) => physical.placeTypeByKey.get(key).definitionId;
  const connectionTypeId = (key) => physical.connectionTypeByKey.get(key).definitionId;
  const placeAttributes = (sensoryLoad, quietArea) => physicalAttributeValues(physical.physicalAttributeByKey, {
    sensory_load: sensoryLoad,
    quiet_area: quietArea,
  });
  const connectionAttributes = (overrides = {}) => physicalAttributeValues(physical.physicalAttributeByKey, {
    step_free: true,
    minimum_width_cm: 120,
    sensory_load: "low",
    has_steps: false,
    narrow_passage: false,
    ...overrides,
  });

  const venue = await Venue.create({
    _id: IDS.venue,
    name: "Museo Civico Aurora",
    description: "Museo e collezione dimostrativi. La mappa è una schematizzazione didattica creata per ArtAround.",
    ownerOrganizationId: organization._id,
    primaryEditorialContextId: editorialContext._id,
    createdBy: manager._id,
  });
  const targets = [];
  for (const work of WORKS) {
    targets.push(await VenueTarget.create({
      _id: auroraId(`venue-target:${work.key}`),
      venueId: venue._id,
      subjectId: workSubjectIds.get(work.key),
      displayLabelOverride: work.title,
      inventoryNote: `${work.title} — ${work.artist}`,
      provenance: { origin: "imported", sourceId: `aurora:${work.key}` },
      createdBy: manager._id,
    }));
  }

  const placeIds = {
    entrance: auroraId("place:entrance"),
    info: auroraId("place:info"),
    toilet: auroraId("place:toilet"),
    elevator: auroraId("place:elevator"),
    stairs: auroraId("place:stairs"),
    bar: auroraId("place:bar"),
    shop: auroraId("place:shop"),
    exit: auroraId("place:exit"),
  };
  const workPlaceIds = WORKS.map((work) => auroraId(`place:work:${work.key}`));
  const workPositions = [[0.15, 0.25], [0.31, 0.20], [0.48, 0.25], [0.66, 0.20], [0.83, 0.28], [0.82, 0.48], [0.65, 0.55], [0.48, 0.50], [0.31, 0.55], [0.14, 0.46]];
  const places = [
    { _id: placeIds.entrance, placeTypeDefinitionId: placeTypeId("entrance"), label: "Ingresso Aurora", floorId, position: { x: 0.05, y: 0.78 }, attributeValues: placeAttributes("low", false) },
    { _id: placeIds.info, placeTypeDefinitionId: placeTypeId("information_point"), label: "Informazioni", floorId, position: { x: 0.15, y: 0.80 }, attributeValues: placeAttributes("low", false) },
    ...WORKS.map((work, index) => ({
      _id: workPlaceIds[index],
      placeTypeDefinitionId: placeTypeId("room"),
      label: work.title,
      floorId,
      position: { x: workPositions[index][0], y: workPositions[index][1] },
      attributeValues: placeAttributes("low", index === 6 || index === 9),
    })),
    { _id: placeIds.toilet, placeTypeDefinitionId: placeTypeId("toilets"), label: "Servizi accessibili", floorId, position: { x: 0.30, y: 0.82 }, attributeValues: placeAttributes("low", false) },
    { _id: placeIds.elevator, placeTypeDefinitionId: placeTypeId("elevator"), label: "Ascensore", floorId, position: { x: 0.41, y: 0.82 }, attributeValues: placeAttributes("low", false) },
    { _id: placeIds.stairs, placeTypeDefinitionId: placeTypeId("stairs"), label: "Scale", floorId, position: { x: 0.50, y: 0.82 }, attributeValues: placeAttributes("low", false) },
    { _id: placeIds.bar, placeTypeDefinitionId: placeTypeId("cafe"), label: "Caffetteria Aurora", floorId, position: { x: 0.61, y: 0.82 }, attributeValues: placeAttributes("high", false) },
    { _id: placeIds.shop, placeTypeDefinitionId: placeTypeId("shop"), label: "Bookshop", floorId, position: { x: 0.74, y: 0.82 }, attributeValues: placeAttributes("high", false) },
    { _id: placeIds.exit, placeTypeDefinitionId: placeTypeId("exit"), label: "Uscita", floorId, position: { x: 0.92, y: 0.78 }, attributeValues: placeAttributes("low", false) },
  ];
  const routeNodes = [placeIds.entrance, ...workPlaceIds, placeIds.exit];
  const connections = [];
  for (let index = 0; index < routeNodes.length - 1; index += 1) {
    connections.push({
      _id: auroraId(`connection:main:${index}`),
      fromPlaceId: routeNodes[index],
      toPlaceId: routeNodes[index + 1],
      directionality: "bidirectional",
      connectionTypeDefinitionId: connectionTypeId("passage"),
      metricMode: "manual_override",
      distanceMeters: 14 + (index % 3) * 4,
      attributeValues: connectionAttributes(),
      instructions: { forward: "Prosegui verso la tappa successiva del percorso Aurora.", backward: "Torna verso la tappa precedente." },
    });
  }
  for (const [key, target, distance] of [
    ["info", placeIds.info, 7],
    ["toilet", placeIds.toilet, 12],
    ["elevator", placeIds.elevator, 14],
    ["stairs", placeIds.stairs, 14],
    ["bar", placeIds.bar, 18],
    ["shop", placeIds.shop, 22],
  ]) {
    connections.push({
      _id: auroraId(`connection:facility:${key}`),
      fromPlaceId: placeIds.entrance,
      toPlaceId: target,
      directionality: "bidirectional",
      connectionTypeDefinitionId: connectionTypeId(key === "stairs" ? "stairs" : key === "elevator" ? "elevator" : "passage"),
      metricMode: "manual_override",
      distanceMeters: distance,
      attributeValues: key === "stairs"
        ? connectionAttributes({ step_free: false, has_steps: true })
        : connectionAttributes(),
      instructions: { forward: `Raggiungi ${key} dall'ingresso Aurora.`, backward: "Rientra verso l'ingresso." },
    });
  }

  const exhibitSlots = await ExhibitSlot.create(WORKS.map((work) => ({
    _id: auroraId(`exhibit-slot:${work.key}`),
    venueId: venue._id,
    publicCode: `as_${auroraId(`slot-code:${work.key}`).toHexString()}`,
    createdBy: manager._id,
  })));
  const layoutRevision = await LayoutRevision.create({
    _id: IDS.layoutRevision,
    venueId: venue._id,
    version: 1,
    authoredAgainstPhysicalVocabularyRevisionId: physical.revision._id,
    floors: [{ _id: floorId, label: "Piano terra", mapAsset: { url: AURORA_MAP_URL, mimeType: "image/svg+xml", width: 1200, height: 700, originalName: "museo-aurora-demo.svg" } }],
    places,
    exhibitSlots: exhibitSlots.map((slot, index) => ({
      exhibitSlotId: slot._id,
      placeId: workPlaceIds[index],
      label: `${WORKS[index].title} · posizione espositiva`,
      order: index,
      approachGuidance: { defaultInstruction: `Cerca ${WORKS[index].title} nello spazio espositivo.`, overrides: [] },
    })),
    connections,
    status: "published",
    createdBy: manager._id,
    updatedBy: manager._id,
  });
  const venueRelease = await VenueRelease.create({
    _id: IDS.venueRelease,
    venueId: venue._id,
    version: 1,
    layoutRevisionId: layoutRevision._id,
    targetBindings: targets.map((target, index) => ({ venueTargetId: target._id, exhibitSlotId: exhibitSlots[index]._id, availability: "active", recognitionMedia: [] })),
    preVisitInformation: [
      "Museo Civico Aurora e la sua collezione sono contenuti dimostrativi creati per ArtAround.",
      "La pianta è schematica; il percorso accessibile evita le scale e mantiene passaggi di almeno 90 cm.",
    ],
    status: "published",
    integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: manager._id },
    review: reviewApproved(operator._id, manager._id),
    publication: { publishedAt: FIXED_NOW, publishedBy: manager._id },
    createdBy: manager._id,
    updatedBy: manager._id,
  });
  venue.publishedReleaseId = venueRelease._id;
  await venue.save();
  assertNoIssues("VenueRelease Aurora non coerente", await computeVenueReleaseIssues({ venue, release: venueRelease, layout: layoutRevision }));

  const visitRecords = [];
  for (const definition of VISIT_DEFINITIONS) {
    const visit = await VisitV2.create({
      _id: auroraId(`visit:${definition.key}`),
      ownerType: "organization",
      ownerId: organization._id,
      createdBy: manager._id,
    });
    const editorialSourceId = auroraId(`visit-source:${definition.key}`);
    const visitAnchors = definition.workIndexes.map((workIndex, index) => ({
      _id: auroraId(`visit-anchor:${definition.key}:${index}`),
      venueTargetId: targets[workIndex]._id,
    }));
    const contentEntries = definition.workIndexes.map((workIndex, index) => ({
      _id: auroraId(`visit-entry:${definition.key}:${index}`),
      editorialSourceId,
      itemId: itemRecords[workIndex].item._id,
      itemEditionId: itemRecords[workIndex].edition._id,
      itemRevisionId: itemRecords[workIndex].revision._id,
      deliveryAnchorId: visitAnchors[index]._id,
      role: "core",
    }));
    const revision = await VisitRevisionV2.create({
      _id: auroraId(`visit-revision:${definition.key}`),
      visitId: visit._id,
      version: 1,
      title: definition.title,
      description: definition.description,
      editorialSources: [{ _id: editorialSourceId, editorialReleaseId: editorialRelease._id }],
      contentEntries,
      visitAnchors,
      presentationBaseline: {
        depthPreference: definition.depth,
        languageComplexityPreference: definition.complexity,
        locale: "it-IT",
      },
      logistics: {
        preVisitNotes: ["Percorso interamente al piano terra del Museo Civico Aurora."],
        routeHints: [],
      },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: manager._id },
      review: reviewApproved(operator._id, manager._id),
      publication: { publishedAt: FIXED_NOW, publishedBy: manager._id },
      createdBy: manager._id,
      updatedBy: manager._id,
    });
    const integrity = await computeVisitV2Integrity(revision.toObject());
    assertNoIssues(`Visit Aurora non coerente: ${definition.key}`, integrity.issues);
    visit.publishedRevisionId = revision._id;
    await visit.save();

    const listing = await MarketplaceListing.create({
      _id: auroraId(`listing:${definition.key}`),
      sellerType: "organization",
      sellerId: organization._id,
      resourceType: "visit",
      resourceId: visit._id,
      title: definition.title,
      summary: definition.description,
      catalogMetadata: { demoVenueId: venue._id, auroraDataset: true },
      status: "published",
      createdBy: manager._id,
      publishedAt: FIXED_NOW,
    });
    const grants = [{
      resourceType: "visit",
      resourceId: visit._id,
      capability: "visit.execute",
      versionPolicy: "follow_current",
    }];
    const dependencyIntegrity = await assertSelfContainedOffer({
      grants,
      sellerType: "organization",
      sellerId: organization._id,
    });
    const offer = await MarketplaceOffer.create({
      _id: auroraId(`offer:${definition.key}`),
      listingId: listing._id,
      label: "Accesso demo gratuito",
      pricing: { type: "free" },
      grants,
      dependencyIntegrity,
      status: "active",
      createdBy: manager._id,
    });
    visitRecords.push({ definition, visit, revision, listing, offer });
  }

  const acquiredAurora = [];
  for (const record of visitRecords) {
    acquiredAurora.push(await acquireOffer({ offerId: record.offer._id, actorUserId: users.visitatore1._id }));
  }
  let acquiredPinacoteca = null;
  if (pinacotecaVisitRecords.length) {
    acquiredPinacoteca = await acquireOffer({
      offerId: pinacotecaVisitRecords[0].offer._id,
      actorUserId: users.visitatore1._id,
    });
  }

  return {
    users,
    organization,
    venue,
    namespace,
    namespaceRevision,
    contentSpace,
    editorialContext,
    editorialRelease,
    layoutRevision,
    venueRelease,
    itemRecords,
    targets,
    visitRecords,
    acquisitions: { aurora: acquiredAurora, pinacoteca: acquiredPinacoteca },
  };
}

async function verifyAuroraDataset() {
  const failures = [];
  const add = (code, message, context = {}) => failures.push({ code, message, context });
  const users = await ensureRequiredUsers();
  const venue = await Venue.findById(IDS.venue).lean();
  const layout = await LayoutRevision.findById(IDS.layoutRevision).lean();
  const venueRelease = await VenueRelease.findById(IDS.venueRelease).lean();
  const editorialRelease = await EditorialRelease.findById(IDS.editorialRelease).lean();
  const semanticGraph = await SemanticGraph.findById(IDS.semanticGraph).lean();

  if (!venue) add("AURORA_VENUE_MISSING", "Museo Civico Aurora non trovato");
  if (!layout || layout.status !== "published") add("AURORA_LAYOUT_MISSING", "Layout Aurora pubblicato non disponibile");
  if (!venueRelease || venueRelease.status !== "published") add("AURORA_VENUE_RELEASE_MISSING", "VenueRelease Aurora pubblicata non disponibile");
  if (!semanticGraph || String(semanticGraph.workingRevisionId || "") !== String(IDS.graphRevision)) {
    add("AURORA_SEMANTIC_GRAPH_INVALID", "Il grafo semantico Aurora deve conservare la propria revisione di lavoro", {
      semanticGraphId: semanticGraph?._id || null,
      workingRevisionId: semanticGraph?.workingRevisionId || null,
    });
  }
  if (!editorialRelease || editorialRelease.itemBindings?.length !== WORKS.length) {
    add("AURORA_EDITORIAL_RELEASE_INVALID", "La release Aurora deve contenere dieci item", {
      count: editorialRelease?.itemBindings?.length || 0,
    });
  }
  if (!editorialRelease || editorialRelease.subjectIds?.length !== WORKS.length + THEMES.length) {
    add("AURORA_EDITORIAL_SUBJECT_SCOPE_INVALID", "La release Aurora deve congelare opere e temi del perimetro semantico", {
      count: editorialRelease?.subjectIds?.length || 0,
    });
  }
  if (venue && layout && venueRelease) {
    const issues = await computeVenueReleaseIssues({ venue, release: venueRelease, layout });
    if (issues.some((entry) => entry.severity !== "warning")) add("AURORA_VENUE_RELEASE_INVALID", "VenueRelease Aurora non coerente", { issues });
  }
  if (editorialRelease) {
    const issues = await validateEditorialReleaseCoherence({
      editorialContextId: editorialRelease.editorialContextId,
      namespaceRevisionId: editorialRelease.namespaceRevisionId,
      graphRevisionId: editorialRelease.graphRevisionId,
      subjectIds: editorialRelease.subjectIds || [],
      itemBindings: editorialRelease.itemBindings || [],
    });
    if (issues.length) add("AURORA_EDITORIAL_RELEASE_INCOHERENT", "EditorialRelease Aurora non coerente", { issues });
  }

  const ids = datasetIds();
  const [visits, revisions, entitlements] = await Promise.all([
    VisitV2.find({ _id: { $in: ids.visitIds }, lifecycleStatus: "active", publishedRevisionId: { $ne: null } }).lean(),
    VisitRevisionV2.find({ _id: { $in: ids.visitRevisionIds }, status: "published" }).lean(),
    Entitlement.find({
      beneficiaryType: "user",
      beneficiaryId: users.visitatore1._id,
      resourceType: "visit",
      resourceId: { $in: ids.visitIds },
      capability: "visit.execute",
      status: "active",
    }).lean(),
  ]);
  if (visits.length !== VISIT_DEFINITIONS.length) add("AURORA_VISITS_MISSING", "Devono esistere tre visite Aurora", { count: visits.length });
  if (revisions.length !== VISIT_DEFINITIONS.length) add("AURORA_VISIT_REVISIONS_MISSING", "Devono esistere tre revisioni pubblicate Aurora", { count: revisions.length });
  if (entitlements.length !== VISIT_DEFINITIONS.length) add("AURORA_ENTITLEMENTS_MISSING", "visitatore1 deve possedere tre visite Aurora", { count: entitlements.length });
  for (const revision of revisions) {
    const integrity = await computeVisitV2Integrity(revision);
    if (integrity.issues.some((entry) => entry.severity !== "warning")) {
      add("AURORA_VISIT_INVALID", "VisitRevision Aurora non coerente", { revisionId: revision._id, issues: integrity.issues });
    }
  }

  const configPath = path.join(
    __dirname,
    "..",
    "clients",
    "navigator",
    "public",
    "navigator-configs",
    AURORA_VENUE_ID,
    "navigator.config.json",
  );
  if (!fs.existsSync(configPath)) add("AURORA_NAVIGATOR_CONFIG_MISSING", "Configurazione Navigator Aurora non disponibile");
  else {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (String(config.venueId) !== AURORA_VENUE_ID) {
      add("AURORA_NAVIGATOR_CONFIG_MISMATCH", "La configurazione Navigator Aurora usa un venueId errato", { configured: config.venueId });
    }
  }
  const mapPath = path.join(__dirname, "..", "clients", "navigator", "public", AURORA_MAP_URL);
  if (!fs.existsSync(mapPath)) add("AURORA_MAP_MISSING", "Mappa dimostrativa Aurora non disponibile");

  const [{ museums }, { visits: libraryVisits }] = await Promise.all([
    listNavigatorMuseums({ userId: users.visitatore1._id }),
    listNavigatorLibrary({ userId: users.visitatore1._id, configuredVenueId: AURORA_VENUE_ID }),
  ]);
  const auroraMuseum = museums.find((entry) => String(entry.id) === AURORA_VENUE_ID);
  const pinacotecaMuseum = museums.find((entry) => String(entry.id) === "496f78e51b8861a9800749a7");
  if (!auroraMuseum || auroraMuseum.visitCount !== VISIT_DEFINITIONS.length) {
    add("AURORA_NOT_IN_NAVIGATOR", "Aurora deve comparire nel selettore con tre visite", { museum: auroraMuseum || null });
  }
  if (!pinacotecaMuseum) add("PINACOTECA_NOT_IN_NAVIGATOR", "visitatore1 deve vedere anche la Pinacoteca");
  if (libraryVisits.length !== VISIT_DEFINITIONS.length) {
    add("AURORA_LIBRARY_INVALID", "La libreria Aurora deve mostrare tre visite", { count: libraryVisits.length });
  }

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      venueId: AURORA_VENUE_ID,
      publishedItems: editorialRelease?.itemBindings?.length || 0,
      publishedVisits: visits.length,
      visitorEntitlements: entitlements.length,
      navigatorMuseums: museums.map((museum) => ({ id: String(museum.id), name: museum.name, visitCount: museum.visitCount })),
    },
  };
}

module.exports = {
  AURORA_VENUE_ID,
  AURORA_MAP_URL,
  IDS,
  DEF,
  THEMES,
  WORKS,
  VISIT_DEFINITIONS,
  cleanupAuroraDataset,
  seedAuroraDataset,
  verifyAuroraDataset,
};