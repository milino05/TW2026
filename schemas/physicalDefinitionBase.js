const mongoose = require("mongoose");
const SemanticRefSchema = require("./semanticRef.schema");
const PhysicalDefinitionLocalizationSchema = require("./physicalDefinitionLocalization.schema");
const { Schema } = mongoose;

function physicalDefinitionBase(extra = {}) {
  return {
    definitionId: { type: String, required: true, trim: true },
    key: { type: String, trim: true, lowercase: true, default: null },
    label: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: null },
    localizations: { type: [PhysicalDefinitionLocalizationSchema], default: [] },
    semanticRefs: { type: [SemanticRefSchema], default: [] },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ...extra,
  };
}

module.exports = physicalDefinitionBase;
