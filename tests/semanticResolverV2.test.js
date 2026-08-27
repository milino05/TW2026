const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const mongoUri = process.env.MONGO_URI;

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

async function jsonFetch(url, { cookie = null, ...init } = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(url, { ...init, headers });
  return { response, body: await response.json().catch(() => null) };
}

function identity({ id, userId }) {
  return {
    scheme: "wikidata",
    id,
    role: "canonical",
    confirmation: { source: "seed", confirmedAt: new Date(), confirmedBy: userId },
    verification: { status: "verified", checkedAt: new Date() },
  };
}

async function marketplaceSemanticSearchFlow() {
  return import(pathToFileURL(path.join(
    __dirname,
    "../clients/marketplace/src/ui/semantic-search-flow.js",
  )).href);
}

async function marketplaceApiClient() {
  return import(pathToFileURL(path.join(
    __dirname,
    "../clients/marketplace/src/infrastructure/http/api-client.js",
  )).href);
}

test("Marketplace Subject search accepts only an exact ArtAround label before stopping", async () => {
  const { searchSubjectCascade } = await marketplaceSemanticSearchFlow();
  const calls = [];
  const repository = {
    searchSubjects: async (query, options) => {
      calls.push(`local:${query}:${options.match}`);
      return [{ id: "subject-1", preferredLabel: "Gioconda" }];
    },
    searchExternal: async () => {
      calls.push("external");
      return { candidates: [] };
    },
  };

  const result = await searchSubjectCascade({ repository, query: "  Gioconda  " });

  assert.deepEqual(calls, ["local:Gioconda:label_exact"]);
  assert.equal(result.externalSearched, false);
  assert.equal(result.localResults[0].preferredLabel, "Gioconda");
});

test("Marketplace Subject search falls back to Wikidata and exposes the already-bound ArtAround Subject", async () => {
  const { searchSubjectCascade } = await marketplaceSemanticSearchFlow();
  const calls = [];
  const boundSubject = { id: "subject-1", preferredLabel: "Gioconda" };
  const repository = {
    searchSubjects: async (query) => {
      calls.push(`local:${query}`);
      return [];
    },
    searchExternal: async ({ query, locale, entityKind }) => {
      calls.push(`external:${query}:${locale}:${entityKind}`);
      return {
        provider: { scheme: "wikidata" },
        candidates: [{
          scheme: "wikidata",
          id: "Q12418",
          label: "Mona Lisa",
          alreadyBoundSubject: boundSubject,
        }],
      };
    },
  };

  const result = await searchSubjectCascade({ repository, query: "Mona Lisa", entityKind: "item" });

  assert.deepEqual(calls, ["local:Mona Lisa", "external:Mona Lisa:it:item"]);
  assert.equal(result.externalSearched, true);
  assert.equal(result.externalResults[0].alreadyBoundSubject.preferredLabel, "Gioconda");
});

test("Marketplace Subject search retries Wikidata transparently without a leading Italian article", async () => {
  const { searchSubjectCascade } = await marketplaceSemanticSearchFlow();
  const calls = [];
  const repository = {
    searchSubjects: async (query, options) => {
      calls.push(`local:${query}:${options.match}`);
      return [];
    },
    searchExternal: async ({ query }) => {
      calls.push(`external:${query}`);
      if (query.startsWith("la ")) return { provider: { scheme: "wikidata" }, candidates: [] };
      return {
        provider: { scheme: "wikidata" },
        candidates: [{ scheme: "wikidata", id: "Q185372", label: "Ragazza con l'orecchino di perla" }],
      };
    },
  };

  const result = await searchSubjectCascade({
    repository,
    query: "la ragazza con l'orecchino di perla",
  });

  assert.deepEqual(calls, [
    "local:la ragazza con l'orecchino di perla:label_exact",
    "external:la ragazza con l'orecchino di perla",
    "external:ragazza con l'orecchino di perla",
  ]);
  assert.equal(result.externalResults[0].id, "Q185372");
  assert.deepEqual(result.externalQuery, {
    requested: "la ragazza con l'orecchino di perla",
    variant: "ragazza con l'orecchino di perla",
    attempted: ["la ragazza con l'orecchino di perla", "ragazza con l'orecchino di perla"],
    variantApplied: true,
    variantUnavailable: false,
  });
  assert.deepEqual(result.externalResults[0].queryMatches, ["variant"]);
});

test("Marketplace external discovery merges and deduplicates the original and article-free queries", async () => {
  const { searchExternalCandidates } = await marketplaceSemanticSearchFlow();
  const calls = [];
  const repository = {
    searchExternal: async ({ query }) => {
      calls.push(query);
      if (query === "La candidate") {
        return { candidates: [{ scheme: "wikidata", id: "Q1", label: "La candidate" }] };
      }
      return { candidates: [
        { scheme: "wikidata", id: "Q1", label: "La candidate" },
        { scheme: "wikidata", id: "Q2", label: "Candidate alternativa" },
      ] };
    },
  };

  const result = await searchExternalCandidates({
    repository,
    query: "La candidate",
    retryWithoutItalianArticle: true,
  });

  assert.deepEqual(calls, ["La candidate", "candidate"]);
  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["Q1", "Q2"]);
  assert.deepEqual(result.candidates[0].queryMatches, ["requested", "variant"]);
  assert.deepEqual(result.candidates[1].queryMatches, ["variant"]);
  assert.deepEqual(result.query, {
    requested: "La candidate",
    variant: "candidate",
    attempted: ["La candidate", "candidate"],
    variantApplied: true,
    variantUnavailable: false,
  });
});

test("Marketplace external discovery keeps original results if the optional variant fails", async () => {
  const { searchExternalCandidates } = await marketplaceSemanticSearchFlow();
  const repository = {
    searchExternal: async ({ query }) => {
      if (query !== "La candidate") throw new Error("variant unavailable");
      return { candidates: [{ scheme: "wikidata", id: "Q1", label: "La candidate" }] };
    },
  };

  const result = await searchExternalCandidates({
    repository,
    query: "La candidate",
    retryWithoutItalianArticle: true,
  });

  assert.deepEqual(result.candidates.map((candidate) => candidate.id), ["Q1"]);
  assert.equal(result.query.variantUnavailable, true);
  assert.equal(result.query.variant, "candidate");
});

test("Subject label normalization is exact but ignores case, accents, spacing and apostrophe style", async () => {
  const { normalizeSubjectLabel, listSubjects } = require("../services/subject.service");
  assert.equal(normalizeSubjectLabel("  L’Órecchino   di Perla "), "l'orecchino di perla");
  await assert.rejects(
    () => listSubjects({ search: "x", match: "fuzzy" }),
    (error) => error?.status === 400 && error.details?.[0]?.code === "INVALID_ENUM",
  );
});

test("Marketplace unified Subject search resolves a QID without running a text search on Wikidata", async () => {
  const { searchSubjectCascade } = await marketplaceSemanticSearchFlow();
  const calls = [];
  const repository = {
    searchSubjects: async () => [],
    searchExternal: async () => {
      calls.push("text-search");
      return { candidates: [] };
    },
    resolveExternal: async ({ id, locale }) => {
      calls.push(`resolve:${id}:${locale}`);
      return {
        status: "resolved",
        requestedId: "Q12418",
        provider: { scheme: "wikidata" },
        boundSubjects: [],
        candidate: { scheme: "wikidata", id: "Q12418", label: "Gioconda" },
      };
    },
  };

  const result = await searchSubjectCascade({ repository, query: "q12418" });

  assert.deepEqual(calls, ["resolve:q12418:it"]);
  assert.equal(result.externalResults[0].id, "Q12418");
  assert.equal(result.externalResults[0].requestedId, "Q12418");
});

test("Navigator external fallback only returns already-bound Subjects in the selected sources", () => {
  const { sourceScopedGroundedSubjectIds } = require("../services/generationSemanticOptionsV2.service");
  const result = sourceScopedGroundedSubjectIds({
    candidates: [
      { id: "Q1", alreadyBoundSubject: { id: "source-a" } },
      { id: "Q2", alreadyBoundSubject: { id: "outside" } },
      { id: "Q3", alreadyBoundSubject: null },
      { id: "Q4", alreadyBoundSubject: { id: "source-b" } },
    ],
    sourceSubjectIds: ["source-a", "source-b"],
    alreadyIncludedIds: ["source-a"],
  });
  assert.deepEqual(result, ["source-b"]);
});

test("PlaceType keeps user intents and vocabulary mappings as separate axes", async () => {
  const LayoutRevision = require("../models/layoutRevision.model");
  const objectId = () => new mongoose.Types.ObjectId();
  const revision = new LayoutRevision({
    venueId: objectId(),
    version: 1,
    placeTypes: [{
      key: "gallery",
      label: "Sala espositiva",
      userIntents: ["find_quiet_area"],
      semanticRefs: [{ scheme: "wikidata", id: "Q180516", matchType: "close" }],
    }],
    createdBy: objectId(),
    updatedBy: objectId(),
  });
  await revision.validate();
  assert.deepEqual([...revision.placeTypes[0].userIntents], ["FIND_QUIET_AREA"]);
  assert.deepEqual(revision.placeTypes[0].semanticRefs.map((entry) => ({ scheme: entry.scheme, id: entry.id, matchType: entry.matchType })), [
    { scheme: "wikidata", id: "Q180516", matchType: "close" },
  ]);
});

test("Wikidata adapter searches fingerprints, resolves redirects and coalesces cached requests", async () => {
  const { WikidataProvider } = require("../services/semanticResolver/providers/wikidata.provider");
  let calls = 0;
  const requestedUrls = [];
  const provider = new WikidataProvider({
    fetchImpl: async (url) => {
      calls += 1;
      requestedUrls.push(new URL(url));
      const action = new URL(url).searchParams.get("action");
      if (action === "wbsearchentities") {
        return jsonResponse({ search: [{ id: "Q42", label: "Douglas Adams", description: "scrittore", aliases: ["DNA"], concepturi: "https://www.wikidata.org/entity/Q42" }] });
      }
      return jsonResponse({
        redirects: [{ from: "Q1", to: "Q42" }],
        entities: {
          Q42: {
            labels: { it: { language: "it", value: "Douglas Adams" } },
            descriptions: { it: { language: "it", value: "scrittore" } },
            aliases: { it: [{ language: "it", value: "DNA" }] },
          },
        },
      });
    },
  });

  const search = await provider.search({ query: "Douglas", locale: "it-IT", entityKind: "item", limit: 5 });
  assert.equal(search[0].id, "Q42");
  assert.deepEqual(search[0].aliases, ["DNA"]);
  const [left, right] = await Promise.all([
    provider.resolve({ id: "q1", locale: "it" }),
    provider.resolve({ id: "Q1", locale: "it" }),
  ]);
  assert.equal(left.status, "redirected");
  assert.equal(left.canonicalId, "Q42");
  assert.deepEqual(right.candidate.redirectedFrom, ["Q1"]);
  assert.equal(calls, 2, "search e resolve devono produrre una sola chiamata ciascuno");
  assert.equal(requestedUrls.every((url) => !url.searchParams.has("maxlag")), true, "le richieste interattive non devono inviare maxlag");
});

test("Wikidata adapter propone immagini P18 con metadati Wikimedia Commons", async () => {
  const { WikidataProvider } = require("../services/semanticResolver/providers/wikidata.provider");
  const requestedUrls = [];
  const provider = new WikidataProvider({
    fetchImpl: async (url) => {
      const requested = new URL(url);
      requestedUrls.push(requested);
      if (requested.hostname === "commons.wikimedia.org") {
        return jsonResponse({
          query: {
            pages: {
              12: {
                title: "File:Example artwork.jpg",
                imageinfo: [{
                  url: "https://upload.wikimedia.org/original.jpg",
                  thumburl: "https://upload.wikimedia.org/thumb-1200.jpg",
                  mime: "image/jpeg",
                  width: 2400,
                  height: 1600,
                  thumbwidth: 1200,
                  thumbheight: 800,
                  descriptionurl: "https://commons.wikimedia.org/wiki/File:Example_artwork.jpg",
                  extmetadata: {
                    Artist: { value: "<b>Autrice</b>" },
                    LicenseShortName: { value: "CC BY-SA 4.0" },
                    LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
                  },
                }],
              },
            },
          },
        });
      }
      return jsonResponse({
        entities: {
          Q42: {
            labels: { it: { language: "it", value: "Opera di esempio" } },
            claims: {
              P18: [{ rank: "preferred", mainsnak: { datavalue: { type: "string", value: "Example artwork.jpg" } } }],
            },
          },
        },
      });
    },
  });

  const media = await provider.mediaCandidates({ id: "Q42", locale: "it" });

  assert.equal(media.length, 1);
  assert.equal(media[0].url, "https://upload.wikimedia.org/thumb-1200.jpg");
  assert.equal(media[0].altText, "Opera di esempio");
  assert.equal(media[0].source.provider, "wikimedia_commons");
  assert.equal(media[0].source.wikidataEntityId, "Q42");
  assert.equal(media[0].rights.creator, "Autrice");
  assert.equal(media[0].rights.licenseName, "CC BY-SA 4.0");
  assert.equal(requestedUrls[0].searchParams.get("props"), "labels|claims");
  assert.equal(requestedUrls[1].searchParams.get("iiurlwidth"), "1200");
  assert.match(requestedUrls[1].searchParams.get("iiprop"), /extmetadata/);
});

test("Wikidata background mode keeps maxlag and retries one short transient failure", async () => {
  const { WikidataProvider } = require("../services/semanticResolver/providers/wikidata.provider");
  let calls = 0;
  const delays = [];
  const requestedUrls = [];
  const provider = new WikidataProvider({
    fetchImpl: async (url) => {
      calls += 1;
      requestedUrls.push(new URL(url));
      if (calls === 1) {
        return jsonResponse(
          { error: { code: "maxlag", info: "Provider occupato", lag: 8 } },
          { headers: { "Retry-After": "1" } },
        );
      }
      return jsonResponse({ search: [{ id: "Q42", label: "Douglas Adams" }] });
    },
    sleepImpl: async (delayMs) => { delays.push(delayMs); },
  });

  const result = await provider.search({ query: "Douglas", interactionMode: "background" });

  assert.equal(result[0].id, "Q42");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1000]);
  assert.equal(requestedUrls.every((url) => url.searchParams.get("maxlag") === "5"), true);
});

test("Wikidata adapter distinguishes provider unavailability and Retry-After", async () => {
  const { WikidataProvider } = require("../services/semanticResolver/providers/wikidata.provider");
  const { SemanticProviderUnavailableError } = require("../services/semanticResolver/providerErrors");
  const provider = new WikidataProvider({ fetchImpl: async () => jsonResponse({}, { status: 429, headers: { "Retry-After": "3" } }) });
  await assert.rejects(
    () => provider.search({ query: "x", entityKind: "item" }),
    (error) => error instanceof SemanticProviderUnavailableError
      && error.retryAfterSeconds === 3
      && error.providerCode === "http_429"
      && error.attempts === 1,
  );
});

test("Wikidata retries network and timeout failures but not permanent API errors", async () => {
  const { WikidataProvider } = require("../services/semanticResolver/providers/wikidata.provider");
  const { SemanticProviderUnavailableError } = require("../services/semanticResolver/providerErrors");
  let networkCalls = 0;
  const networkProvider = new WikidataProvider({
    fetchImpl: async () => {
      networkCalls += 1;
      if (networkCalls === 1) throw new TypeError("temporary network failure");
      return jsonResponse({ search: [{ id: "Q42", label: "Douglas Adams" }] });
    },
    sleepImpl: async () => {},
  });
  const recovered = await networkProvider.search({ query: "Douglas" });
  assert.equal(recovered[0].id, "Q42");
  assert.equal(networkCalls, 2);

  let timeoutCalls = 0;
  const timeoutProvider = new WikidataProvider({
    fetchImpl: async (url, { signal }) => {
      timeoutCalls += 1;
      if (timeoutCalls > 1) return jsonResponse({ search: [{ id: "Q42", label: "Douglas Adams" }] });
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          const timeoutError = new Error("request aborted");
          timeoutError.name = "AbortError";
          reject(timeoutError);
        }, { once: true });
      });
    },
    sleepImpl: async () => {},
    timeoutMs: 10,
  });
  const recoveredAfterTimeout = await timeoutProvider.search({ query: "Douglas" });
  assert.equal(recoveredAfterTimeout[0].id, "Q42");
  assert.equal(timeoutCalls, 2);

  let permanentCalls = 0;
  const permanentProvider = new WikidataProvider({
    fetchImpl: async () => {
      permanentCalls += 1;
      return jsonResponse({ error: { code: "badvalue", info: "Parametro non valido" } });
    },
    sleepImpl: async () => {},
  });
  await assert.rejects(
    () => permanentProvider.search({ query: "Douglas" }),
    (error) => error instanceof SemanticProviderUnavailableError
      && error.providerCode === "badvalue"
      && error.retryable === false,
  );
  assert.equal(permanentCalls, 1);
});

test("Marketplace ApiClient preserves provider code and Retry-After for the retry UI", async () => {
  const { ApiClient, ApiError } = await marketplaceApiClient();
  const client = new ApiClient("/api", {
    fetchImpl: async () => jsonResponse({
      message: "Provider semantico temporaneamente non disponibile",
      errors: [{
        code: "PROVIDER_UNAVAILABLE",
        providerCode: "http_429",
        retryable: true,
        retryAfterSeconds: 7,
      }],
    }, { status: 503, headers: { "Retry-After": "7" } }),
  });

  await assert.rejects(
    () => client.request("/v2/semantic-resolver/search"),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.code === "PROVIDER_UNAVAILABLE"
      && error.providerCode === "http_429"
      && error.retryable === true
      && error.retryAfterSeconds === 7,
  );
});

test("Semantic Resolver persists canonical and historical identities, reuses and reports reconciliation", { skip: !mongoUri }, async () => {
  const registry = require("../services/semanticResolver/providerRegistry.service");
  const { SemanticProviderUnavailableError } = require("../services/semanticResolver/providerErrors");
  let forcedSearchFailure = null;
  const fakeProvider = {
    scheme: "wikidata",
    descriptor: () => ({ scheme: "wikidata", label: "Wikidata test", entityKinds: ["item", "property"], attribution: { label: "Test data", url: "https://example.test" } }),
    search: async () => {
      if (forcedSearchFailure) throw forcedSearchFailure;
      return [{ scheme: "wikidata", id: "Q42", canonicalId: "Q42", redirectedFrom: [], entityKind: "item", label: "Entita", description: "Descrizione", aliases: [], providerUrl: "https://example.test/Q42" }];
    },
    resolve: async ({ id }) => {
      const requestedId = String(id).toUpperCase();
      const canonicalId = requestedId === "Q1" ? "Q42" : requestedId;
      return {
        status: requestedId === canonicalId ? "resolved" : "redirected",
        requestedId,
        canonicalId,
        candidate: { scheme: "wikidata", id: canonicalId, canonicalId, redirectedFrom: requestedId === canonicalId ? [] : [requestedId], entityKind: "item", label: `Entita ${canonicalId}`, description: "Descrizione verificata", aliases: [], providerUrl: `https://example.test/${canonicalId}` },
      };
    },
  };

  registry.replaceProvidersForTests([fakeProvider]);
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  try {
    await mongoose.connection.dropDatabase();
    const User = require("../models/user");
    const Subject = require("../models/subject.model");
    const { createSubject } = require("../services/subject.service");
    const { createSubjectFromExternalIdentity } = require("../services/subjectExternalIdentity.service");
    const user = await User.create({ username: "semantic-author", passwordHash: "hash" });
    await Subject.syncIndexes();

    const created = await createSubjectFromExternalIdentity({ actorUserId: user._id, payload: { scheme: "wikidata", id: "Q1", preferredLabel: "Scelta ArtAround" } });
    assert.equal(created.outcome, "created");
    assert.deepEqual(created.subject.externalIdentities.map((entry) => [entry.id, entry.role, entry.canonicalId]), [
      ["Q42", "canonical", null],
      ["Q1", "historical", "Q42"],
    ]);

    const reused = await createSubjectFromExternalIdentity({ actorUserId: user._id, payload: { scheme: "wikidata", id: "Q42" } });
    assert.equal(reused.outcome, "reuse_existing");
    assert.equal(reused.subject.id, created.subject.id);

    await assert.rejects(
      () => Subject.create({ preferredLabel: "Duplicato", externalIdentities: [identity({ id: "Q42", userId: user._id })], createdBy: user._id }),
      (error) => error?.code === 11000,
    );

    const local = await createSubject({ actorUserId: user._id, payload: { preferredLabel: "Solo locale" } });
    assert.equal(local.externalIdentities.length, 0);
    await createSubject({ actorUserId: user._id, payload: { preferredLabel: "L’Orecchino di Perla" } });
    const exactLabels = await require("../services/subject.service").listSubjects({
      search: "  l'orecchino   di pérla ",
      match: "label_exact",
    });
    assert.deepEqual(exactLabels.map((subject) => subject.preferredLabel), ["L’Orecchino di Perla"]);
    const unrelatedLabels = await require("../services/subject.service").listSubjects({
      search: "la ragazza con l'orecchino di perla",
      match: "label_exact",
    });
    assert.deepEqual(unrelatedLabels, []);
    await assert.rejects(
      () => createSubject({ actorUserId: user._id, payload: { preferredLabel: "Non verificato", externalIdentities: [{ scheme: "wikidata", id: "Q9" }] } }),
      (error) => error?.status === 400 && error.details.some((issue) => issue.field === "externalIdentities"),
    );

    await Subject.deleteMany({});
    const [historicalOwner, canonicalOwner] = await Subject.create([
      { preferredLabel: "Storico", externalIdentities: [identity({ id: "Q1", userId: user._id })], createdBy: user._id },
      { preferredLabel: "Canonico", externalIdentities: [identity({ id: "Q42", userId: user._id })], createdBy: user._id },
    ]);
    await assert.rejects(
      () => createSubjectFromExternalIdentity({ actorUserId: user._id, payload: { scheme: "wikidata", id: "Q1" } }),
      (error) => error?.status === 409
        && error.details.some((issue) => issue.code === "RECONCILIATION_REQUIRED"
          && issue.subjectIds.includes(String(historicalOwner._id))
          && issue.subjectIds.includes(String(canonicalOwner._id))),
    );

    const app = require("../app");
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`;
      const unauthenticated = await jsonFetch(`${baseUrl}/api/v2/semantic-resolver/providers`);
      assert.equal(unauthenticated.response.status, 401);

      const { hashPassword } = require("../services/auth.service");
      user.passwordHash = await hashPassword("12345678");
      await user.save();
      const login = await jsonFetch(`${baseUrl}/api/auth/login`, { method: "POST", body: JSON.stringify({ username: user.username, password: "12345678" }) });
      const cookie = login.response.headers.get("set-cookie")?.split(";")[0];
      const providers = await jsonFetch(`${baseUrl}/api/v2/semantic-resolver/providers`, { cookie });
      assert.equal(providers.response.status, 200);
      assert.equal(providers.body.providers[0].scheme, "wikidata");
      const search = await jsonFetch(`${baseUrl}/api/v2/semantic-resolver/search?scheme=wikidata&query=entita&entityKind=item`, { cookie });
      assert.equal(search.response.status, 200);
      assert.equal(search.body.candidates[0].alreadyBoundSubject.preferredLabel, "Canonico");
      forcedSearchFailure = new SemanticProviderUnavailableError("Test provider unavailable", {
        retryAfterSeconds: 7,
        providerCode: "http_429",
        retryable: true,
        attempts: 1,
      });
      const unavailable = await jsonFetch(`${baseUrl}/api/v2/semantic-resolver/search?scheme=wikidata&query=entita&entityKind=item`, { cookie });
      assert.equal(unavailable.response.status, 503);
      assert.equal(unavailable.response.headers.get("retry-after"), "7");
      assert.deepEqual(unavailable.body.errors[0], {
        code: "PROVIDER_UNAVAILABLE",
        scheme: "wikidata",
        retryAfterSeconds: 7,
        providerCode: "http_429",
        retryable: true,
        attempts: 1,
      });
      forcedSearchFailure = null;
      const apiCreated = await jsonFetch(`${baseUrl}/api/subjects/from-external-identity`, { cookie, method: "POST", body: JSON.stringify({ scheme: "wikidata", id: "Q100" }) });
      assert.equal(apiCreated.response.status, 201);
      const apiReused = await jsonFetch(`${baseUrl}/api/subjects/from-external-identity`, { cookie, method: "POST", body: JSON.stringify({ scheme: "wikidata", id: "Q100" }) });
      assert.equal(apiReused.response.status, 200);
      assert.equal(apiReused.body.outcome, "reuse_existing");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    registry.resetProvidersForTests();
    await mongoose.connection.dropDatabase().catch(() => {});
    await mongoose.disconnect();
  }
});
