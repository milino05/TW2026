const semanticResolver = require("../services/semanticResolver/semanticResolver.service");

async function providers(req, res, next) {
  try {
    res.status(200).json(semanticResolver.providersProjection());
  } catch (error) { next(error); }
}

async function search(req, res, next) {
  try {
    res.status(200).json(await semanticResolver.search({
      scheme: req.query?.scheme || "wikidata",
      query: req.query?.query || "",
      locale: req.query?.locale || "it",
      entityKind: req.query?.entityKind || "item",
      limit: req.query?.limit || 10,
    }));
  } catch (error) { next(error); }
}

async function resolve(req, res, next) {
  try {
    res.status(200).json(await semanticResolver.resolve({
      scheme: req.query?.scheme || "wikidata",
      id: req.query?.id || "",
      locale: req.query?.locale || "it",
      includeMedia: ["1", "true"].includes(String(req.query?.includeMedia || "").toLowerCase()),
    }));
  } catch (error) { next(error); }
}

module.exports = { providers, search, resolve };
