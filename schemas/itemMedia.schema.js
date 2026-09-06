const mongoose = require("mongoose");
const { Schema } = mongoose;

const MediaSourceSchema = new Schema({
  provider: { type: String, trim: true, default: null },
  wikidataEntityId: { type: String, trim: true, default: null },
  fileTitle: { type: String, trim: true, default: null },
  pageUrl: { type: String, trim: true, default: null },
  retrievedAt: { type: Date, default: null },
}, { _id: false });

const MediaRightsSchema = new Schema({
  creator: { type: String, trim: true, default: null },
  attribution: { type: String, trim: true, default: null },
  licenseName: { type: String, trim: true, default: null },
  licenseUrl: { type: String, trim: true, default: null },
}, { _id: false });

const ItemMediaSchema = new Schema({
  url: { type: String, required: true, trim: true },
  originalUrl: { type: String, trim: true, default: null },
  altText: { type: String, trim: true, default: null },
  mimeType: { type: String, trim: true, default: null },
  width: { type: Number, min: 1, default: null },
  height: { type: Number, min: 1, default: null },
  source: { type: MediaSourceSchema, default: null },
  rights: { type: MediaRightsSchema, default: null },
}, { _id: true });

module.exports = ItemMediaSchema;
