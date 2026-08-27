const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const errorsUrl = pathToFileURL(path.join(root, "clients/marketplace/src/application/user-facing-errors.js")).href;
const apiClientUrl = pathToFileURL(path.join(root, "clients/marketplace/src/infrastructure/http/api-client.js")).href;

test("gli errori delle regole editoriali indicano esattamente durata e campo da correggere", async () => {
  const { userFacingErrorMessage } = await import(errorsUrl);
  const message = userFacingErrorMessage("Definizioni Namespace non valide", {
    status: 400,
    details: [
      { field: "durationTypes[1].targetSeconds", code: "DUPLICATE_TARGET_SECONDS", message: "targetSeconds deve essere univoco" },
      { field: "durationTypes[1].targetSeconds", code: "NON_INCREASING_TARGET_SECONDS", message: "targetSeconds deve crescere" },
    ],
  });

  assert.match(message, /Non è stato possibile salvare le regole editoriali/);
  assert.match(message, /Durata 2 · Durata in secondi/);
  assert.match(message, /numero di secondi diverso/);
  assert.match(message, /dalla più breve alla più lunga/);
  assert.doesNotMatch(message, /Namespace|targetSeconds/);
});

test("ApiClient mostra il messaggio comprensibile ma conserva i dettagli diagnostici", async () => {
  const { ApiClient, ApiError } = await import(apiClientUrl);
  const client = new ApiClient("/api", {
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        message: "Payload revisione Namespace non valido",
        errors: [{ field: "languageLevels[1].label", code: "REQUIRED", message: "label e obbligatoria" }],
      }),
      headers: { get: () => null },
    }),
  });

  await assert.rejects(
    () => client.request("/regole"),
    (error) => error instanceof ApiError
      && error.message.includes("Livello di linguaggio 2 · Nome visibile: Compila questo campo")
      && error.details[0].code === "REQUIRED",
  );
});

test("i termini tecnici più comuni vengono tradotti anche senza dettagli", async () => {
  const { userFacingErrorMessage } = await import(errorsUrl);
  const message = userFacingErrorMessage("ItemEdition e NamespaceRevision non disponibili", { status: 409 });
  assert.equal(message, "versione editoriale e versione delle regole editoriali non disponibili");
  assert.doesNotMatch(message, /ItemEdition|NamespaceRevision/);
});

test("gli errori di rete non espongono il messaggio inglese del browser", async () => {
  const { ApiClient, ApiError } = await import(apiClientUrl);
  const client = new ApiClient("/api", { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(
    () => client.request("/contenuti"),
    (error) => error instanceof ApiError
      && error.status === 0
      && error.message === "Non è stato possibile contattare il servizio. Controlla la connessione e riprova.",
  );
});

test("un errore DNS del resolver mantiene una spiegazione operativa", async () => {
  const { ApiClient, ApiError } = await import(apiClientUrl);
  const client = new ApiClient("/api", {
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      json: async () => ({
        message: "Il server non riesce a risolvere l'indirizzo di Wikidata. Controlla la configurazione DNS e riprova.",
        errors: [{ code: "PROVIDER_UNAVAILABLE", providerCode: "dns_error", retryable: true }],
      }),
      headers: { get: () => null },
    }),
  });

  await assert.rejects(
    () => client.request("/v2/semantic-resolver/search"),
    (error) => error instanceof ApiError
      && error.providerCode === "dns_error"
      && error.message.includes("configurazione DNS"),
  );
});
