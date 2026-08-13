const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const Museum = require("../models/museum.model");
const ItemRevision = require("../models/itemRevision.model");
const { createInitialVocabularyForMuseum } = require("../services/museumVocabularyRevision.service");

async function migrate() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI mancante");
  await mongoose.connect(process.env.MONGO_URI);
  const museums = await Museum.find();
  for (const museum of museums) {
    await createInitialVocabularyForMuseum({ museumId: museum._id, actorUserId: museum.createdBy, config: museum.config || {}, publish: true });
  }
  const revisions = await ItemRevision.find({ $or: [{ presentationVariants: { $exists: false } }, { presentationVariants: { $size: 0 } }], "representations.0": { $exists: true } });
  let migratedRevisions = 0;
  for (const revision of revisions) {
    const legacy = (revision.representations || []).map((entry) => ({ durationKey: entry.durationKey, languageLevelKey: entry.languageLevelKey, text: entry.text }));
    const preferred = (revision.representations || []).find((entry) => entry.isDefault) || revision.representations?.[0];
    revision.presentationVariants = [{ key: "standard", label: "Standard", description: "Variante migrata dal modello representation legacy", semanticFocus: [], presentationAspects: [], representations: legacy }];
    if (preferred) revision.defaultPresentation = { variantKey: "standard", durationKey: preferred.durationKey, languageLevelKey: preferred.languageLevelKey };
    await revision.save(); migratedRevisions += 1;
  }
  console.log(`Vocabolari inizializzati: ${museums.length}; ItemRevision migrate: ${migratedRevisions}`);
}

migrate().then(() => mongoose.disconnect()).catch(async (error) => { console.error(error); await mongoose.disconnect().catch(() => {}); process.exit(1); });
