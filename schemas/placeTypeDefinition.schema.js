const mongoose = require("mongoose");
const physicalDefinitionBase = require("./physicalDefinitionBase");
const { Schema } = mongoose;

const PlaceTypeDefinitionSchema = new Schema(physicalDefinitionBase(), { _id: false });

module.exports = PlaceTypeDefinitionSchema;
