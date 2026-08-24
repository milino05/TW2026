const { WikidataProvider } = require("./providers/wikidata.provider");

let providers = new Map();

function ensureProviders() {
  if (!providers.size) providers.set("wikidata", new WikidataProvider());
  return providers;
}

function getProvider(scheme) {
  return ensureProviders().get(String(scheme || "").trim().toLowerCase()) || null;
}

function listProviders() {
  return [...ensureProviders().values()].map((provider) => provider.descriptor());
}

function replaceProvidersForTests(nextProviders = []) {
  providers = new Map(nextProviders.map((provider) => [provider.scheme, provider]));
}

function resetProvidersForTests() {
  providers = new Map();
}

module.exports = { getProvider, listProviders, replaceProvidersForTests, resetProvidersForTests };
