const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const User = require("../models/user");
const Organization = require("../models/organization.model");
const Subject = require("../models/subject.model");
const Namespace = require("../models/namespace.model");
const NamespaceRevision = require("../models/namespaceRevision.model");
const ContentSpace = require("../models/contentSpace.model");
const ContentSpaceMembership = require("../models/contentSpaceMembership.model");
const EditorialContext = require("../models/editorialContext.model");
const SemanticGraphRevision = require("../models/semanticGraphRevision.model");
const GraphSubjectBinding = require("../models/graphSubjectBinding.model");
const SemanticEdgeV2 = require("../models/semanticEdgeV2.model");
const EditorialRelease = require("../models/editorialRelease.model");
const ItemV2 = require("../models/itemV2.model");
const ItemEdition = require("../models/itemEdition.model");
const ItemRevisionV2 = require("../models/itemRevisionV2.model");
const Venue = require("../models/venue.model");
const VenueTarget = require("../models/venueTarget.model");
const LayoutRevision = require("../models/layoutRevision.model");
const VenueRelease = require("../models/venueRelease.model");
const VisitV2 = require("../models/visitV2.model");
const VisitRevisionV2 = require("../models/visitRevisionV2.model");
const MarketplaceListing = require("../models/marketplaceListing.model");
const MarketplaceOffer = require("../models/marketplaceOffer.model");
const { hashPassword, verifyPassword } = require("../services/auth.service");
const { validateNamespaceRevisionSnapshot } = require("../services/validation/namespace.validation");
const { validatePresentationAgainstNamespace } = require("../services/itemV2Presentation.service");
const { validateEditorialReleaseCoherence } = require("../services/editorialReleaseIntegrity.service");
const { computeVenueReleaseIssues } = require("../services/venueReleaseIntegrity.service");
const { computeVisitV2Integrity } = require("../services/visitV2Integrity.service");
const { assertSelfContainedOffer } = require("../services/marketplaceOfferIntegrity.service");

const REQUIRED_USERNAMES = Object.freeze(["autore1", "autore2", "visitatore1", "visitatore2"]);
const REQUIRED_PASSWORD = "12345678";
const DEMO_VENUE_ID = "496f78e51b8861a9800749a7";
const DEMO_MAP_URL = "/maps/pinacoteca-bologna-demo.svg";
const FIXED_NOW = new Date("2026-08-22T20:00:00.000Z");

function demoId(name) {
  return new mongoose.Types.ObjectId(
    crypto.createHash("sha1").update(`artaround-exam:${name}`).digest("hex").slice(0, 24),
  );
}

const IDS = Object.freeze({
  organization: demoId("organization"),
  venue: new mongoose.Types.ObjectId(DEMO_VENUE_ID),
  namespace: demoId("namespace"),
  namespaceRevision: demoId("namespace_revision"),
  contentSpace: demoId("content_space"),
  editorialContext: demoId("editorial_context"),
  graphRevision: demoId("graph_revision"),
  editorialRelease: demoId("editorial_release"),
  layoutRevision: demoId("layout_revision"),
  venueRelease: demoId("venue_release"),
});

const DEF = Object.freeze({
  subjectWork: "11111111-1111-4111-8111-111111111111",
  subjectPeriod: "22222222-2222-4222-8222-222222222222",
  relationPeriod: "33333333-3333-4333-8333-333333333333",
  relationRelatedWork: "44444444-4444-4444-8444-444444444444",
  durationShort: "55555555-5555-4555-8555-555555555551",
  durationMedium: "55555555-5555-4555-8555-555555555552",
  durationLong: "55555555-5555-4555-8555-555555555553",
  languageSimple: "66666666-6666-4666-8666-666666666661",
  languageStandard: "66666666-6666-4666-8666-666666666662",
  languageAdvanced: "66666666-6666-4666-8666-666666666663",
  aspectObservation: "77777777-7777-4777-8777-777777777771",
  aspectContext: "77777777-7777-4777-8777-777777777772",
  aspectAnalysis: "77777777-7777-4777-8777-777777777773",
  signalMasterpiece: "88888888-8888-4888-8888-888888888881",
  signalRenaissance: "88888888-8888-4888-8888-888888888882",
  signalSeicento: "88888888-8888-4888-8888-888888888883",
});

const PERIODS = Object.freeze([
  { key: "rinascimento", label: "Rinascimento", description: "Contesto artistico del Rinascimento italiano." },
  { key: "seicento", label: "Seicento", description: "Contesto artistico bolognese ed emiliano del Seicento." },
]);

const WORKS = Object.freeze([
  { key: "raffaello-santa-cecilia", title: "Estasi di santa Cecilia", artist: "Raffaello", period: "rinascimento", externalIdentityIds: [{ scheme: "wikidata", id: "Q1103801" }], focus: "il rapporto tra la figura di Cecilia, i santi e il tema della musica" },
  { key: "parmigianino-santa-margherita", title: "Pala di Santa Margherita", artist: "Parmigianino", period: "rinascimento", focus: "l'eleganza delle figure e la costruzione della scena sacra" },
  { key: "cossa-pala-mercanti", title: "Pala dei Mercanti", artist: "Francesco del Cossa", period: "rinascimento", focus: "la solidità delle figure e la cultura figurativa ferrarese" },
  { key: "reni-strage-innocenti", title: "Strage degli innocenti", artist: "Guido Reni", period: "seicento", externalIdentityIds: [{ scheme: "wikidata", id: "Q2448678" }], focus: "la tensione narrativa, i gesti e il controllo della composizione" },
  { key: "reni-sansone", title: "Sansone vittorioso", artist: "Guido Reni", period: "seicento", focus: "la monumentalità della figura e il rapporto tra azione e posa" },
  { key: "reni-san-sebastiano", title: "San Sebastiano", artist: "Guido Reni", period: "seicento", focus: "l'idealizzazione del corpo e l'intensità devozionale" },
  { key: "domenichino-sant-agnese", title: "Martirio di sant'Agnese", artist: "Domenichino", period: "seicento", focus: "la regia narrativa e la distribuzione dei personaggi" },
  { key: "domenichino-madonna-rosario", title: "Madonna del Rosario", artist: "Domenichino", period: "seicento", focus: "la struttura devozionale e la gerarchia delle figure" },
  { key: "domenichino-san-pietro", title: "San Pietro martire", artist: "Domenichino", period: "seicento", focus: "la costruzione del racconto sacro attraverso gesto e sguardo" },
  { key: "albani-battesimo", title: "Battesimo di Cristo", artist: "Francesco Albani", period: "seicento", focus: "il paesaggio e l'equilibrio tra episodio sacro e ambiente" },
  { key: "tiarini-compianto", title: "Compianto su Cristo", artist: "Alessandro Tiarini", period: "seicento", focus: "l'espressione degli affetti e il raccoglimento delle figure" },
  { key: "guercino-san-guglielmo", title: "Vestizione di san Guglielmo", artist: "Guercino", period: "seicento", focus: "la luce, la profondità e il ritmo della scena" },
]);

const VISIT_DEFINITIONS = Object.freeze([
  { key: "essenziali", title: "Capolavori essenziali", description: "Dieci opere per un primo incontro con la Pinacoteca di Bologna.", workIndexes: [0,1,2,3,4,5,6,7,8,9], depth: 0.25, complexity: 0.25, paid: false },
  { key: "rinascimento-seicento", title: "Dal Rinascimento al Seicento", description: "Un percorso di confronto tra linguaggi rinascimentali e pittura del Seicento.", workIndexes: [1,2,3,4,5,6,7,8,9,10,11], depth: 0.55, complexity: 0.5, paid: false },
  { key: "lettura-avanzata", title: "Tecnica, stile e committenza", description: "Dieci tappe per una lettura più analitica di composizione, stile e contesto.", workIndexes: [0,1,3,4,6,7,8,9,10,11], depth: 0.85, complexity: 0.85, paid: true },
]);

function idMap(prefix, values) {
  return new Map(values.map((entry) => [entry.key, demoId(`${prefix}:${entry.key}`)]));
}
const workSubjectIds = idMap("subject:work", WORKS);
const periodSubjectIds = idMap("subject:period", PERIODS);

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

async function ensureRequiredUsers() {
  const passwordHash = await hashPassword(REQUIRED_PASSWORD);
  const users = {};
  for (const username of REQUIRED_USERNAMES) {
    let user = await User.findOne({ username }).select("+passwordHash");
    if (!user) user = await User.create({ username, passwordHash, status: "active" });
    else {
      user.passwordHash = passwordHash;
      user.status = "active";
      await user.save();
    }
    users[username] = user;
  }
  return users;
}

function workText(work, level) {
  const base = `${work.title} è un'opera di ${work.artist} conservata alla Pinacoteca Nazionale di Bologna.`;
  if (level === "essential") return `${base} Durante la tappa osserva soprattutto ${work.focus}.`;
  if (level === "context") return `${base} Nel percorso ArtAround viene letta in relazione al ${work.period === "rinascimento" ? "Rinascimento" : "Seicento"}. Confronta ${work.focus} con le opere vicine e nota come cambia il modo di guidare lo sguardo dello spettatore.`;
  return `${base} Per una lettura avanzata considera ${work.focus}, distinguendo organizzazione compositiva, funzione delle figure, gestione della luce e rapporto con il contesto storico-editoriale del percorso. Il confronto con le altre tappe serve a formulare ipotesi motivate, non a ridurre l'opera a una sola etichetta stilistica.`;
}

async function cleanupDemo() {
  const itemIds = WORKS.map((work) => demoId(`item:${work.key}`));
  const editionIds = WORKS.map((work) => demoId(`edition:${work.key}`));
  const revisionIds = WORKS.map((work) => demoId(`item-revision:${work.key}`));
  const targetIds = WORKS.map((work) => demoId(`venue-target:${work.key}`));
  const subjectIds = [...workSubjectIds.values(), ...periodSubjectIds.values()];
  const visitIds = VISIT_DEFINITIONS.map((visit) => demoId(`visit:${visit.key}`));
  const visitRevisionIds = VISIT_DEFINITIONS.map((visit) => demoId(`visit-revision:${visit.key}`));
  const listingIds = VISIT_DEFINITIONS.map((visit) => demoId(`listing:${visit.key}`));
  const offerIds = VISIT_DEFINITIONS.map((visit) => demoId(`offer:${visit.key}`));

  await MarketplaceOffer.deleteMany({ _id: { $in: offerIds } });
  await MarketplaceListing.deleteMany({ _id: { $in: listingIds } });
  await VisitRevisionV2.deleteMany({ _id: { $in: visitRevisionIds } });
  await VisitV2.deleteMany({ _id: { $in: visitIds } });
  await VenueRelease.deleteMany({ _id: IDS.venueRelease });
  await LayoutRevision.deleteMany({ _id: IDS.layoutRevision });
  await VenueTarget.deleteMany({ _id: { $in: targetIds } });
  await Venue.deleteMany({ _id: IDS.venue });
  await EditorialRelease.deleteMany({ _id: IDS.editorialRelease });
  await SemanticEdgeV2.deleteMany({ graphRevisionId: IDS.graphRevision });
  await GraphSubjectBinding.deleteMany({ graphRevisionId: IDS.graphRevision });
  await SemanticGraphRevision.deleteMany({ _id: IDS.graphRevision });
  await EditorialContext.deleteMany({ _id: IDS.editorialContext });
  await ContentSpaceMembership.deleteMany({ itemId: { $in: itemIds } });
  await ContentSpace.deleteMany({ _id: IDS.contentSpace });
  await ItemRevisionV2.deleteMany({ _id: { $in: revisionIds } });
  await ItemEdition.deleteMany({ _id: { $in: editionIds } });
  await ItemV2.deleteMany({ _id: { $in: itemIds } });
  await NamespaceRevision.deleteMany({ _id: IDS.namespaceRevision });
  await Namespace.deleteMany({ _id: IDS.namespace });
  await Subject.deleteMany({ _id: { $in: subjectIds } });
  await Organization.deleteMany({ _id: IDS.organization });
}

async function seedExamDataset() {
  const users = await ensureRequiredUsers();
  await cleanupDemo();
  const manager = users.autore1;
  const operator = users.autore2;

  const organization = await Organization.create({
    _id: IDS.organization,
    name: "Pinacoteca Nazionale di Bologna — Demo ArtAround",
    description: "Organization dimostrativa associata alla sede reale scelta per il progetto d'esame.",
    createdBy: manager._id,
  });

  for (const [username, role] of [["autore1", "manager"], ["autore2", "operator"]]) {
    const user = users[username];
    user.organizationMemberships = (user.organizationMemberships || [])
      .filter((entry) => String(entry.organizationId) !== String(organization._id));
    user.organizationMemberships.push({
      organizationId: organization._id,
      role,
      assignedBy: manager._id,
      assignedAt: FIXED_NOW,
    });
    await user.save();
  }
  for (const username of ["visitatore1", "visitatore2"]) {
    const user = users[username];
    user.organizationMemberships = (user.organizationMemberships || [])
      .filter((entry) => String(entry.organizationId) !== String(organization._id));
    await user.save();
  }

  for (const period of PERIODS) {
    await Subject.create({
      _id: periodSubjectIds.get(period.key),
      preferredLabel: period.label,
      description: period.description,
      externalIdentities: [],
      createdBy: manager._id,
    });
  }
  for (const work of WORKS) {
    await Subject.create({
      _id: workSubjectIds.get(work.key),
      preferredLabel: work.title,
      description: `${work.title}, ${work.artist}. Opera del percorso dimostrativo della Pinacoteca Nazionale di Bologna.`,
      externalIdentities: (work.externalIdentityIds || []).map((identity) => ({
        ...identity,
        role: "canonical",
        confirmation: { source: "seed", confirmedAt: FIXED_NOW, confirmedBy: manager._id },
        verification: { status: "verified", checkedAt: FIXED_NOW },
      })),
      createdBy: manager._id,
    });
  }

  const namespace = await Namespace.create({
    _id: IDS.namespace,
    name: "Pinacoteca Bologna — Italiano",
    description: "Vocabolario editoriale dimostrativo per contenuti in italiano, indipendente dalla geometria della sede.",
    ownerType: "organization",
    ownerId: organization._id,
    createdBy: manager._id,
  });
  const namespaceSnapshot = {
    subjectClasses: [
      { definitionId: DEF.subjectWork, key: "work", label: "Opera", description: "Opera o soggetto principale di una tappa." },
      { definitionId: DEF.subjectPeriod, key: "period", label: "Periodo", description: "Contesto storico-artistico trasversale." },
    ],
    relationTypes: [
      {
        definitionId: DEF.relationPeriod,
        key: "belongs-to-period",
        label: "Appartiene al periodo",
        description: "Collega un'opera a un contesto storico-artistico.",
        domainDefinitionIds: [DEF.subjectWork],
        rangeDefinitionIds: [DEF.subjectPeriod],
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
      { definitionId: DEF.languageStandard, key: "standard", label: "Standard", description: "Lessico storico-artistico introdotto nel contesto." },
      { definitionId: DEF.languageAdvanced, key: "advanced", label: "Avanzato", description: "Lessico analitico per utenti con maggiori conoscenze." },
    ],
    presentationAspects: [
      { definitionId: DEF.aspectObservation, key: "observation", label: "Osservazione", description: "Guida lo sguardo verso elementi visivi riconoscibili." },
      { definitionId: DEF.aspectContext, key: "context", label: "Contesto", description: "Collega l'opera al percorso storico-editoriale." },
      { definitionId: DEF.aspectAnalysis, key: "analysis", label: "Analisi", description: "Propone una lettura comparativa e argomentata." },
    ],
    selectionSignals: [
      { definitionId: DEF.signalMasterpiece, key: "masterpiece", label: "Capolavoro", description: "Opera ad alta rilevanza nel percorso demo." },
      { definitionId: DEF.signalRenaissance, key: "renaissance", label: "Rinascimento", description: "Utile per percorsi rinascimentali." },
      { definitionId: DEF.signalSeicento, key: "seicento", label: "Seicento", description: "Utile per percorsi sul Seicento." },
    ],
  };
  assertNoIssues("Namespace demo non coerente", validateNamespaceRevisionSnapshot(namespaceSnapshot, { requireCoreScales: true }));
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
      _id: demoId(`item:${work.key}`),
      primarySubjectId: workSubjectIds.get(work.key),
      ownerType: "organization",
      ownerId: organization._id,
      provenance: { origin: "human", metadata: { dataset: "TW2026 exam demo" } },
      createdBy: manager._id,
    });
    const edition = await ItemEdition.create({
      _id: demoId(`edition:${work.key}`),
      itemId: item._id,
      namespaceId: namespace._id,
      createdBy: manager._id,
    });
    const variants = {
      essential: demoId(`variant:${work.key}:essential`),
      context: demoId(`variant:${work.key}:context`),
      advanced: demoId(`variant:${work.key}:advanced`),
    };
    const reps = {
      essential: demoId(`representation:${work.key}:essential`),
      context: demoId(`representation:${work.key}:context`),
      advanced: demoId(`representation:${work.key}:advanced`),
    };
    const periodId = periodSubjectIds.get(work.period);
    const revision = await ItemRevisionV2.create({
      _id: demoId(`item-revision:${work.key}`),
      itemEditionId: edition._id,
      version: 1,
      authoredAgainstNamespaceRevisionId: namespaceRevision._id,
      label: `${work.title} — ${work.artist}`,
      relatedSubjectIds: [periodId],
      tags: [work.artist, work.period],
      authorCredits: ["Dataset dimostrativo ArtAround"],
      metadata: { license: "CC BY 4.0 — testo dimostrativo ArtAround" },
      selectionSignals: [
        { definitionId: DEF.signalMasterpiece, weight: 0.8 },
        { definitionId: work.period === "rinascimento" ? DEF.signalRenaissance : DEF.signalSeicento, weight: 1 },
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
          representations: [{ _id: reps.essential, durationTypeDefinitionId: DEF.durationShort, languageLevelDefinitionId: DEF.languageSimple, locale: "it-IT", text: workText(work, "essential") }],
        },
        {
          _id: variants.context,
          key: "context",
          label: "Contesto",
          description: "Lettura intermedia e comparativa.",
          semanticFocus: [{ subjectId: item.primarySubjectId, weight: 0.8 }, { subjectId: periodId, weight: 0.7 }],
          presentationAspects: [{ definitionId: DEF.aspectContext, weight: 1 }],
          audienceSuitability: { minAgeYears: 14, minMaturity: 0.3, maxMaturity: 1 },
          knowledgeRequirements: [{ subjectId: periodId, minLevel: 0.1, maxLevel: 1, weight: 0.6 }],
          representations: [{ _id: reps.context, durationTypeDefinitionId: DEF.durationMedium, languageLevelDefinitionId: DEF.languageStandard, locale: "it-IT", text: workText(work, "context") }],
        },
        {
          _id: variants.advanced,
          key: "advanced",
          label: "Approfondimento",
          description: "Lettura analitica per utenti esperti.",
          semanticFocus: [{ subjectId: item.primarySubjectId, weight: 0.8 }, { subjectId: periodId, weight: 1 }],
          presentationAspects: [{ definitionId: DEF.aspectAnalysis, weight: 1 }],
          audienceSuitability: { minAgeYears: 16, minMaturity: 0.5, maxMaturity: 1 },
          knowledgeRequirements: [{ subjectId: periodId, minLevel: 0.45, maxLevel: 1, weight: 1 }],
          representations: [{ _id: reps.advanced, durationTypeDefinitionId: DEF.durationLong, languageLevelDefinitionId: DEF.languageAdvanced, locale: "it-IT", text: workText(work, "advanced") }],
        },
      ],
      defaultPresentation: { variantId: variants.essential, representationId: reps.essential },
      provenance: { origin: "human", metadata: { dataset: "TW2026 exam demo" } },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: manager._id },
      review: reviewApproved(operator._id, manager._id),
      publication: { publishedAt: FIXED_NOW, publishedBy: manager._id },
      createdBy: manager._id,
      updatedBy: manager._id,
    });
    assertNoIssues(`ItemRevision demo non coerente: ${work.key}`, validatePresentationAgainstNamespace(revision, namespaceRevision));
    edition.publishedRevisionId = revision._id;
    await edition.save();
    itemRecords.push({ work, item, edition, revision });
  }

  const contentSpace = await ContentSpace.create({
    _id: IDS.contentSpace,
    name: "Pinacoteca Bologna — Collezione demo",
    description: "Corpus editoriale usato dalle visite e dal generatore ArtAround.",
    ownerType: "organization",
    ownerId: organization._id,
    createdBy: manager._id,
  });
  await ContentSpaceMembership.create(
    itemRecords.map(({ item }) => ({ contentSpaceId: contentSpace._id, itemId: item._id, addedBy: manager._id })),
  );
  const editorialContext = await EditorialContext.create({
    _id: IDS.editorialContext,
    contentSpaceId: contentSpace._id,
    namespaceId: namespace._id,
    displayName: "Pinacoteca Bologna — Percorso ufficiale demo",
    shortDescription: "Contesto editoriale dimostrativo per il Navigator TW2026.",
    description: "Contesto che raccoglie le opere selezionate e un semplice grafo semantico Rinascimento/Seicento.",
    createdBy: manager._id,
  });
  const graphRevision = await SemanticGraphRevision.create({
    _id: IDS.graphRevision,
    editorialContextId: editorialContext._id,
    version: 1,
    authoredAgainstNamespaceRevisionId: namespaceRevision._id,
    createdBy: manager._id,
  });
  await GraphSubjectBinding.create([
    ...WORKS.map((work) => ({ graphRevisionId: graphRevision._id, subjectId: workSubjectIds.get(work.key), subjectClassDefinitionIds: [DEF.subjectWork] })),
    ...PERIODS.map((period) => ({ graphRevisionId: graphRevision._id, subjectId: periodSubjectIds.get(period.key), subjectClassDefinitionIds: [DEF.subjectPeriod] })),
  ]);
  const semanticEdges = WORKS.map((work) => ({
    graphRevisionId: graphRevision._id,
    sourceSubjectId: workSubjectIds.get(work.key),
    targetSubjectId: periodSubjectIds.get(work.period),
    relationTypeDefinitionId: DEF.relationPeriod,
    weight: 1,
    provenance: { origin: "human" },
  }));
  for (const [a, b] of [[3,4],[4,5],[6,7],[7,8],[9,10],[10,11],[0,1],[1,2]]) {
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
  const itemBindings = itemRecords.map(({ edition, revision, work }) => ({
    _id: demoId(`editorial-binding:${work.key}`),
    itemEditionId: edition._id,
    itemRevisionId: revision._id,
    curationSignals: [{ definitionId: DEF.signalMasterpiece, weight: 0.8 }],
  }));
  const editorialRelease = await EditorialRelease.create({
    _id: IDS.editorialRelease,
    editorialContextId: editorialContext._id,
    version: 1,
    namespaceRevisionId: namespaceRevision._id,
    graphRevisionId: graphRevision._id,
    itemBindings,
    integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: manager._id },
    releasedAt: FIXED_NOW,
    releasedBy: manager._id,
  });
  const editorialIssues = await validateEditorialReleaseCoherence({
    editorialContextId: editorialContext._id,
    namespaceRevisionId: namespaceRevision._id,
    graphRevisionId: graphRevision._id,
    itemBindings,
  });
  assertNoIssues("EditorialRelease demo non coerente", editorialIssues);
  editorialContext.workingGraphRevisionId = graphRevision._id;
  editorialContext.publishedReleaseId = editorialRelease._id;
  await editorialContext.save();

  const venue = await Venue.create({
    _id: IDS.venue,
    name: "Pinacoteca Nazionale di Bologna",
    description: "Sede reale scelta per la demo. La mappa ArtAround inclusa nel seed è intenzionalmente schematica e non rappresenta la planimetria ufficiale corrente.",
    ownerOrganizationId: organization._id,
    primaryEditorialContextId: editorialContext._id,
    createdBy: manager._id,
  });
  const targets = [];
  for (const work of WORKS) {
    targets.push(await VenueTarget.create({
      _id: demoId(`venue-target:${work.key}`),
      venueId: venue._id,
      subjectId: workSubjectIds.get(work.key),
      label: work.title,
      description: `${work.title} — ${work.artist}`,
      createdBy: manager._id,
    }));
  }

  const placeIds = {
    entrance: demoId("place:entrance"),
    info: demoId("place:info"),
    toilet: demoId("place:toilet"),
    elevator: demoId("place:elevator"),
    stairs: demoId("place:stairs"),
    bar: demoId("place:bar"),
    shop: demoId("place:shop"),
    exit: demoId("place:exit"),
  };
  const workPlaceIds = WORKS.map((work) => demoId(`place:work:${work.key}`));
  const workPositions = [[0.16,0.25],[0.30,0.20],[0.44,0.25],[0.58,0.20],[0.72,0.25],[0.84,0.34],[0.78,0.50],[0.64,0.55],[0.50,0.50],[0.36,0.55],[0.22,0.50],[0.12,0.42]];
  const places = [
    { _id: placeIds.entrance, typeKey: "entrance", label: "Ingresso principale", floorKey: "piano-1", position: { x: 0.05, y: 0.75 }, attributes: { low_sensory_load: true, quiet_area: false } },
    { _id: placeIds.info, typeKey: "info", label: "Informazioni", floorKey: "piano-1", position: { x: 0.13, y: 0.78 }, attributes: { low_sensory_load: true, quiet_area: false } },
    ...WORKS.map((work, index) => ({ _id: workPlaceIds[index], typeKey: "gallery", label: work.title, floorKey: "piano-1", position: { x: workPositions[index][0], y: workPositions[index][1] }, attributes: { low_sensory_load: true, quiet_area: true } })),
    { _id: placeIds.toilet, typeKey: "toilet", label: "Servizi igienici accessibili", floorKey: "piano-1", position: { x: 0.30, y: 0.82 }, attributes: { low_sensory_load: true, quiet_area: false } },
    { _id: placeIds.elevator, typeKey: "elevator", label: "Ascensore", floorKey: "piano-1", position: { x: 0.39, y: 0.82 }, attributes: { low_sensory_load: true, quiet_area: false } },
    { _id: placeIds.stairs, typeKey: "stairs", label: "Scale", floorKey: "piano-1", position: { x: 0.46, y: 0.82 }, attributes: { low_sensory_load: true, quiet_area: false } },
    { _id: placeIds.bar, typeKey: "bar", label: "Punto ristoro demo", floorKey: "piano-1", position: { x: 0.56, y: 0.82 }, attributes: { low_sensory_load: false, quiet_area: false } },
    { _id: placeIds.shop, typeKey: "shop", label: "Bookshop", floorKey: "piano-1", position: { x: 0.70, y: 0.82 }, attributes: { low_sensory_load: false, quiet_area: false } },
    { _id: placeIds.exit, typeKey: "exit", label: "Uscita", floorKey: "piano-1", position: { x: 0.90, y: 0.75 }, attributes: { low_sensory_load: true, quiet_area: false } },
  ];
  const connectionAttributes = {
    step_free: true,
    minimum_width_cm: 120,
    low_sensory_load: true,
    stairs: false,
    elevator: false,
    narrow_passage: false,
  };
  const routeNodes = [placeIds.entrance, ...workPlaceIds, placeIds.exit];
  const connections = [];
  for (let index = 0; index < routeNodes.length - 1; index += 1) {
    connections.push({
      _id: demoId(`connection:main:${index}`),
      fromPlaceId: routeNodes[index],
      toPlaceId: routeNodes[index + 1],
      directionality: "bidirectional",
      distanceMeters: 18 + (index % 3) * 4,
      attributes: connectionAttributes,
      instructions: { forward: "Prosegui verso la tappa successiva del percorso demo.", backward: "Torna verso la tappa precedente del percorso demo." },
    });
  }
  for (const [key, target, distance] of [
    ["info", placeIds.info, 8],
    ["toilet", placeIds.toilet, 12],
    ["elevator", placeIds.elevator, 14],
    ["stairs", placeIds.stairs, 14],
    ["bar", placeIds.bar, 20],
    ["shop", placeIds.shop, 24],
  ]) {
    connections.push({
      _id: demoId(`connection:facility:${key}`),
      fromPlaceId: placeIds.entrance,
      toPlaceId: target,
      directionality: "bidirectional",
      distanceMeters: distance,
      attributes: key === "stairs"
        ? { ...connectionAttributes, step_free: false, stairs: true }
        : key === "elevator"
          ? { ...connectionAttributes, elevator: true }
          : connectionAttributes,
      instructions: { forward: `Raggiungi ${key} dal nodo di ingresso demo.`, backward: "Rientra verso l'ingresso demo." },
    });
  }

  const layoutRevision = await LayoutRevision.create({
    _id: IDS.layoutRevision,
    venueId: venue._id,
    version: 1,
    placeTypes: [
      { key: "gallery", label: "Sala espositiva", description: "Nodo espositivo del percorso." },
      { key: "entrance", label: "Ingresso", userIntents: ["FIND_ENTRANCE"] },
      { key: "exit", label: "Uscita", userIntents: ["FIND_EXIT"] },
      { key: "toilet", label: "Servizi", userIntents: ["FIND_TOILET"] },
      { key: "elevator", label: "Ascensore", userIntents: ["FIND_ELEVATOR"] },
      { key: "stairs", label: "Scale", userIntents: ["FIND_STAIRS"] },
      { key: "bar", label: "Bar", userIntents: ["FIND_BAR"] },
      { key: "shop", label: "Bookshop", userIntents: ["FIND_SHOP"] },
      { key: "info", label: "Informazioni", userIntents: ["FIND_INFO"] },
    ],
    routingAttributes: [
      { key: "step_free", label: "Senza gradini", dataType: "boolean", canonicalKey: "step_free", appliesTo: "connection" },
      { key: "minimum_width_cm", label: "Larghezza minima", dataType: "number", unit: "cm", canonicalKey: "minimum_width_cm", appliesTo: "connection" },
      { key: "low_sensory_load", label: "Basso carico sensoriale", dataType: "boolean", canonicalKey: "low_sensory_load", appliesTo: "both" },
      { key: "stairs", label: "Presenza di scale", dataType: "boolean", canonicalKey: "stairs", appliesTo: "connection" },
      { key: "elevator", label: "Uso ascensore", dataType: "boolean", canonicalKey: "elevator", appliesTo: "connection" },
      { key: "narrow_passage", label: "Passaggio stretto", dataType: "boolean", canonicalKey: "narrow_passage", appliesTo: "connection" },
      { key: "quiet_area", label: "Area tranquilla", dataType: "boolean", canonicalKey: "quiet_area", appliesTo: "place" },
    ],
    routingPresets: [{
      key: "accessible",
      label: "Percorso accessibile",
      description: "Evita gradini e richiede larghezza minima di 90 cm.",
      requirements: [
        { attributeKey: "step_free", operator: "eq", value: true, priority: "required", weight: 1 },
        { attributeKey: "minimum_width_cm", operator: "gte", value: 90, priority: "required", weight: 1 },
      ],
    }],
    floors: [{ key: "piano-1", label: "Percorso demo", map: { imageUrl: DEMO_MAP_URL, width: 1200, height: 700 } }],
    places,
    venueTargetPlacements: targets.map((target, index) => ({ venueTargetId: target._id, primaryPlaceId: workPlaceIds[index], placeIds: [workPlaceIds[index]] })),
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
    targetBindings: targets.map((target) => ({ venueTargetId: target._id, availability: "active", recognitionMedia: [] })),
    preVisitInformation: [
      "La pianta mostrata da ArtAround è una schematizzazione didattica per la demo TW2026.",
      "L'ingresso ordinario presenta gradini; il museo documenta anche un percorso senza barriere e un ascensore. Verifica in sede eventuali variazioni temporanee.",
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
  assertNoIssues("VenueRelease demo non coerente", await computeVenueReleaseIssues({ venue, release: venueRelease, layout: layoutRevision }));

  const visitRecords = [];
  for (const definition of VISIT_DEFINITIONS) {
    const visit = await VisitV2.create({
      _id: demoId(`visit:${definition.key}`),
      ownerType: "organization",
      ownerId: organization._id,
      createdBy: manager._id,
    });
    const editorialSourceId = demoId(`visit-source:${definition.key}`);
    const visitAnchors = definition.workIndexes.map((workIndex, index) => ({
      _id: demoId(`visit-anchor:${definition.key}:${index}`),
      venueTargetId: targets[workIndex]._id,
    }));
    const contentEntries = definition.workIndexes.map((workIndex, index) => ({
      _id: demoId(`visit-entry:${definition.key}:${index}`),
      editorialSourceId,
      itemId: itemRecords[workIndex].item._id,
      itemEditionId: itemRecords[workIndex].edition._id,
      itemRevisionId: itemRecords[workIndex].revision._id,
      deliveryAnchorId: visitAnchors[index]._id,
      role: "core",
    }));
    const revision = await VisitRevisionV2.create({
      _id: demoId(`visit-revision:${definition.key}`),
      visitId: visit._id,
      version: 1,
      title: definition.title,
      description: definition.description,
      editorialSources: [{ _id: editorialSourceId, editorialReleaseId: editorialRelease._id }],
      contentEntries,
      visitAnchors,
      presentationBaseline: { depthPreference: definition.depth, languageComplexityPreference: definition.complexity, locale: "it-IT" },
      logistics: { preVisitNotes: ["Percorso interamente nella Venue demo della Pinacoteca Nazionale di Bologna."], routeHints: [] },
      status: "published",
      integrity: { status: "valid", issues: [], checkedAt: FIXED_NOW, checkedBy: manager._id },
      review: reviewApproved(operator._id, manager._id),
      publication: { publishedAt: FIXED_NOW, publishedBy: manager._id },
      createdBy: manager._id,
      updatedBy: manager._id,
    });
    const visitIntegrity = await computeVisitV2Integrity(revision.toObject());
    assertNoIssues(`Visit demo non coerente: ${definition.key}`, visitIntegrity.issues);
    visit.publishedRevisionId = revision._id;
    await visit.save();

    const listing = await MarketplaceListing.create({
      _id: demoId(`listing:${definition.key}`),
      sellerType: "organization",
      sellerId: organization._id,
      resourceType: "visit",
      resourceId: visit._id,
      title: definition.title,
      summary: definition.description,
      catalogMetadata: { demoVenueId: venue._id, examDataset: true },
      status: "published",
      createdBy: manager._id,
      publishedAt: FIXED_NOW,
    });
    const grants = [{ resourceType: "visit", resourceId: visit._id, capability: "visit.execute", versionPolicy: "follow_current" }];
    const dependencyIntegrity = await assertSelfContainedOffer({
      grants,
      sellerType: "organization",
      sellerId: organization._id,
    });
    const offer = await MarketplaceOffer.create({
      _id: demoId(`offer:${definition.key}`),
      listingId: listing._id,
      label: definition.paid ? "Accesso demo — vendita simulata" : "Accesso demo gratuito",
      pricing: definition.paid ? { type: "paid", amountMinor: 490, currency: "EUR" } : { type: "free" },
      grants,
      dependencyIntegrity,
      status: "active",
      createdBy: manager._id,
    });
    visitRecords.push({ definition, visit, revision, listing, offer });
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
  };
}

async function verifyExamDataset() {
  const failures = [];
  const add = (code, message, context = {}) => failures.push({ code, message, context });
  const users = {};

  for (const username of REQUIRED_USERNAMES) {
    const user = await User.findOne({ username, status: "active" }).select("+passwordHash");
    if (!user) {
      add("REQUIRED_USER_MISSING", `Account obbligatorio mancante: ${username}`);
      continue;
    }
    if (!await verifyPassword(REQUIRED_PASSWORD, user.passwordHash)) {
      add("REQUIRED_PASSWORD_MISMATCH", `Password demo non valida per ${username}`);
    }
    users[username] = user;
  }

  const namespaceRevision = await NamespaceRevision.findById(IDS.namespaceRevision).lean();
  if (!namespaceRevision) add("NAMESPACE_REVISION_MISSING", "NamespaceRevision demo mancante");
  else {
    const snapshot = Object.fromEntries(
      ["subjectClasses", "relationTypes", "durationTypes", "languageLevels", "presentationAspects", "selectionSignals"]
        .map((field) => [field, namespaceRevision[field] || []]),
    );
    const issues = validateNamespaceRevisionSnapshot(snapshot, { requireCoreScales: true });
    if (issues.length) add("NAMESPACE_REVISION_INVALID", "NamespaceRevision demo non valida", { issues });
  }

  const venue = await Venue.findById(IDS.venue).lean();
  if (!venue) add("DEMO_VENUE_MISSING", "Venue demo non trovata");
  const layout = await LayoutRevision.findById(IDS.layoutRevision).lean();
  const venueRelease = await VenueRelease.findById(IDS.venueRelease).lean();
  if (!layout || layout.status !== "published") add("DEMO_LAYOUT_MISSING", "LayoutRevision demo pubblicata non disponibile");
  if (!venueRelease || venueRelease.status !== "published") add("DEMO_VENUE_RELEASE_MISSING", "VenueRelease demo pubblicata non disponibile");
  const targetIds = venueRelease?.targetBindings?.filter((entry) => entry.availability === "active").map((entry) => String(entry.venueTargetId)) || [];
  if (targetIds.length < 10) add("NOT_ENOUGH_TARGETS", "La Venue demo deve contenere almeno 10 target attivi", { count: targetIds.length });
  const placementIds = new Set((layout?.venueTargetPlacements || []).map((entry) => String(entry.venueTargetId)));
  for (const targetId of targetIds) {
    if (!placementIds.has(targetId)) add("TARGET_NOT_PLACED", "Target demo attivo privo di placement", { targetId });
  }
  if (!(layout?.floors || []).some((floor) => floor.map?.imageUrl)) add("MAP_ASSET_MISSING", "La LayoutRevision demo non contiene una mappa visualizzabile");
  const facilityIntents = new Set((layout?.placeTypes || []).flatMap((entry) => entry.userIntents || []));
  for (const intent of ["FIND_ENTRANCE", "FIND_EXIT", "FIND_TOILET", "FIND_ELEVATOR", "FIND_STAIRS", "FIND_BAR", "FIND_SHOP", "FIND_INFO"]) {
    if (!facilityIntents.has(intent)) add("FACILITY_INTENT_MISSING", `Intent facility mancante: ${intent}`);
  }
  if (venue && venueRelease && layout) {
    const issues = await computeVenueReleaseIssues({ venue, release: venueRelease, layout });
    if (issues.some((entry) => entry.severity !== "warning")) add("VENUE_RELEASE_INVALID", "VenueRelease demo non coerente", { issues });
  }

  const release = await EditorialRelease.findById(IDS.editorialRelease).lean();
  if (!release || (release.itemBindings || []).length < 10) {
    add("EDITORIAL_RELEASE_TOO_SMALL", "La release editoriale demo deve contenere almeno 10 contenuti", { count: release?.itemBindings?.length || 0 });
  }
  const revisionIds = (release?.itemBindings || []).map((entry) => entry.itemRevisionId);
  const itemRevisions = revisionIds.length
    ? await ItemRevisionV2.find({ _id: { $in: revisionIds }, status: "published" }).lean()
    : [];
  if (itemRevisions.length < 10) add("NOT_ENOUGH_PUBLISHED_ITEMS", "Servono almeno 10 ItemRevision pubblicate nel corpus demo", { count: itemRevisions.length });
  for (const revision of itemRevisions) {
    const representationCount = (revision.presentationVariants || []).reduce((sum, variant) => sum + (variant.representations || []).length, 0);
    if (representationCount < 2) add("ITEM_REPRESENTATIONS_TOO_FEW", "Ogni contenuto demo deve avere più Representation", { revisionId: revision._id, representationCount });
    if (namespaceRevision) {
      const issues = validatePresentationAgainstNamespace(revision, namespaceRevision);
      if (issues.length) add("ITEM_PRESENTATION_INVALID", "ItemRevision demo incompatibile con il Namespace", { revisionId: revision._id, issues });
    }
  }
  if (release) {
    const issues = await validateEditorialReleaseCoherence({
      editorialContextId: release.editorialContextId,
      namespaceRevisionId: release.namespaceRevisionId,
      graphRevisionId: release.graphRevisionId,
      itemBindings: release.itemBindings || [],
    });
    if (issues.length) add("EDITORIAL_RELEASE_INVALID", "EditorialRelease demo non coerente", { issues });
  }

  const configPath = path.join(__dirname, "..", "clients", "navigator", "public", "navigator.config.json");
  if (!fs.existsSync(configPath)) add("NAVIGATOR_CONFIG_MISSING", "navigator.config.json non disponibile");
  else {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (String(config.venueId) !== String(IDS.venue)) {
      add("NAVIGATOR_CONFIG_VENUE_MISMATCH", "Il Navigator non è configurato sulla Venue demo", { configured: config.venueId, expected: String(IDS.venue) });
    }
  }

  const visitIds = VISIT_DEFINITIONS.map((entry) => demoId(`visit:${entry.key}`));
  const visits = await VisitV2.find({ _id: { $in: visitIds }, lifecycleStatus: "active" }).lean();
  if (visits.length < 3) add("NOT_ENOUGH_VISITS", "Devono esistere almeno tre Visit demo pubblicate", { count: visits.length });
  const venueTargetSet = new Set(targetIds);
  for (const visit of visits) {
    if (!visit.publishedRevisionId) {
      add("VISIT_NOT_PUBLISHED", "Visit demo senza publishedRevisionId", { visitId: visit._id });
      continue;
    }
    const revision = await VisitRevisionV2.findById(visit.publishedRevisionId).lean();
    if (!revision || revision.status !== "published") {
      add("VISIT_REVISION_NOT_PUBLISHED", "VisitRevision demo non pubblicata", { visitId: visit._id });
      continue;
    }
    const uniqueItems = new Set((revision.contentEntries || []).map((entry) => String(entry.itemId)));
    if (uniqueItems.size < 10) add("VISIT_TOO_SHORT", "Ogni Visit demo deve contenere almeno 10 opere distinte", { visitId: visit._id, count: uniqueItems.size });
    for (const anchor of revision.visitAnchors || []) {
      if (!venueTargetSet.has(String(anchor.venueTargetId))) {
        add("VISIT_OUTSIDE_DEMO_VENUE", "Una Visit requisito minimo esce dalla Venue demo", { visitId: visit._id, venueTargetId: anchor.venueTargetId });
      }
    }
    const integrity = await computeVisitV2Integrity(revision);
    if (integrity.issues.some((entry) => entry.severity !== "warning")) {
      add("VISIT_REVISION_INVALID", "VisitRevision demo non coerente", { visitId: visit._id, issues: integrity.issues });
    }
  }

  const listings = await MarketplaceListing.find({ resourceType: "visit", resourceId: { $in: visits.map((entry) => entry._id) }, status: "published" }).lean();
  const offers = listings.length
    ? await MarketplaceOffer.find({ listingId: { $in: listings.map((entry) => entry._id) }, status: "active" }).lean()
    : [];
  if (listings.length < 3 || offers.length < 3) {
    add("MARKETPLACE_DEMO_INCOMPLETE", "Le tre Visit demo devono essere pubblicate nel Marketplace con offerte attive", { listings: listings.length, offers: offers.length });
  }
  if (!offers.some((entry) => entry.pricing?.type === "free")) add("FREE_OFFER_MISSING", "Serve almeno un'offerta gratuita per la demo");
  if (!offers.some((entry) => entry.pricing?.type === "paid")) add("PAID_OFFER_MISSING", "Serve almeno un'offerta a pagamento simulato per la demo");
  for (const offer of offers) {
    const listing = listings.find((entry) => String(entry._id) === String(offer.listingId));
    if (!listing) continue;
    try {
      await assertSelfContainedOffer({ grants: offer.grants || [], sellerType: listing.sellerType, sellerId: listing.sellerId });
    } catch (error) {
      add("MARKETPLACE_OFFER_INVALID", "Offer demo non self-contained", { offerId: offer._id, message: error.message, details: error.details || null });
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    summary: {
      requiredUsers: Object.keys(users).length,
      demoVenueId: String(IDS.venue),
      activeVenueTargets: targetIds.length,
      publishedItemRevisions: itemRevisions.length,
      publishedVisits: visits.length,
      marketplaceListings: listings.length,
      activeOffers: offers.length,
    },
  };
}

module.exports = {
  REQUIRED_USERNAMES,
  REQUIRED_PASSWORD,
  DEMO_VENUE_ID,
  DEMO_MAP_URL,
  IDS,
  DEF,
  WORKS,
  VISIT_DEFINITIONS,
  ensureRequiredUsers,
  seedExamDataset,
  verifyExamDataset,
};
