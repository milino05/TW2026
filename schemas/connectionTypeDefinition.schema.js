const mongoose = require("mongoose");
const physicalDefinitionBase = require("./physicalDefinitionBase");
const { Schema } = mongoose;

const ConnectionTypeDefinitionSchema = new Schema(physicalDefinitionBase(), { _id: false });

module.exports = ConnectionTypeDefinitionSchema;
