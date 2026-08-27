const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");

const { storeItemMedia } = require("../services/itemMediaUpload.service");
const {
  normalizeRevisionPayload,
  validateRevisionPayloadShape,
} = require("../services/validation/itemV2.validation");

test("l'immagine editoriale viene normalizzata e validata come campo facoltativo singolo", () => {
  const payload = normalizeRevisionPayload({
    illustrativeMedia: [{
      url: " https://upload.wikimedia.org/example.jpg ",
      altText: " Opera vista frontalmente ",
      source: { provider: " wikimedia_commons ", wikidataEntityId: " Q42 " },
      rights: { creator: " Autrice ", licenseName: " CC BY 4.0 " },
    }],
  });

  assert.equal(payload.illustrativeMedia[0].url, "https://upload.wikimedia.org/example.jpg");
  assert.equal(payload.illustrativeMedia[0].altText, "Opera vista frontalmente");
  assert.equal(payload.illustrativeMedia[0].source.wikidataEntityId, "Q42");
  assert.equal(validateRevisionPayloadShape(payload, { partial: true }).length, 0);

  const missingAlt = validateRevisionPayloadShape({ illustrativeMedia: [{ url: "https://example.test/image.jpg" }] }, { partial: true });
  assert.ok(missingAlt.some((issue) => issue.field === "illustrativeMedia[0].altText" && issue.code === "REQUIRED"));

  const tooMany = validateRevisionPayloadShape({
    illustrativeMedia: [
      { url: "https://example.test/one.jpg", altText: "Uno" },
      { url: "https://example.test/two.jpg", altText: "Due" },
    ],
  }, { partial: true });
  assert.ok(tooMany.some((issue) => issue.code === "MAX_ITEMS"));

  const unsafeSource = validateRevisionPayloadShape({
    illustrativeMedia: [{
      url: "https://example.test/image.jpg",
      altText: "Opera",
      source: { pageUrl: "javascript:alert(1)" },
    }],
  }, { partial: true });
  assert.ok(unsafeSource.some((issue) => issue.field === "illustrativeMedia[0].source.pageUrl" && issue.code === "INVALID_URL"));
});

test("il caricamento locale accetta immagini controllate e restituisce un URL persistibile", async () => {
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "artaround-item-media-"));
  try {
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("test-image"),
    ]);
    const media = await storeItemMedia({
      mediaRoot,
      payload: {
        fileName: "opera.png",
        mimeType: "image/png",
        dataBase64: png.toString("base64"),
        altText: "Opera",
      },
    });

    assert.match(media.url, /^\/uploads\/item-media\/[a-f0-9-]+\.png$/);
    assert.equal(media.source.provider, "author_upload");
    assert.equal(media.source.fileTitle, "opera.png");
    assert.deepEqual(await fs.readFile(path.join(mediaRoot, path.basename(media.url))), png);
  } finally {
    await fs.rm(mediaRoot, { recursive: true, force: true });
  }
});

test("il caricamento locale rifiuta estensioni dichiarate che non corrispondono al contenuto", async () => {
  await assert.rejects(
    () => storeItemMedia({
      mediaRoot: path.join(os.tmpdir(), "artaround-item-media-invalid"),
      payload: {
        fileName: "falsa.png",
        mimeType: "image/png",
        dataBase64: Buffer.from("not-a-png").toString("base64"),
      },
    }),
    (error) => error?.status === 400 && error?.details?.[0]?.code === "INVALID_IMAGE_SIGNATURE",
  );
});
