const mongoose = require("mongoose");
const { Schema } = mongoose;

const RelationSchema = require("../schemas/relation.schema");
const RepresentationSchema = require("../schemas/representation.schema");
const IntegrityIssueSchema = require("../schemas/integrityIssue.schema.js");

const ItemSchema = new Schema(
  {
    externalId: {
      type: String,
      trim: true,
      index: true,
      sparse: true,
    },

    museumId: {
      type: Schema.Types.ObjectId,
      ref: "Museum",
      required: true,
      index: true,
    },

    itemType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    label: {
      type: String,
      required: true,
      trim: true,
    },

    recognitionImage: {
      url: { type: String, trim: true },
      altText: { type: String, trim: true },
    },

    tags: [{ type: String, trim: true }],

    metadata: {
      license: { type: String, trim: true },
    },

    relations: [RelationSchema],
    representations: [RepresentationSchema],

    jsonld: {
      type: Schema.Types.Mixed,
    },

    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "draft",
      index: true,
    },

    integrity: {
      status: {
        type: String,
        enum: ["valid", "needs_review"],
        default: "valid",
        index: true,
      },
      issues: [IntegrityIssueSchema],
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

ItemSchema.index({ label: "text", tags: "text" });
ItemSchema.index({ "relations.relationTypeKey": 1, "relations.target": 1 });
ItemSchema.index({ "representations.languageLevelKey": 1 });
ItemSchema.index({ "representations.durationKey": 1 });
ItemSchema.index({ museumId: 1, itemType: 1, status: 1 });
ItemSchema.index({ museumId: 1, externalId: 1 });
ItemSchema.index({ museumId: 1, "relations.target": 1 });
ItemSchema.index({ museumId: 1, status: 1, "integrity.status": 1 });

module.exports = mongoose.model("Item", ItemSchema);
