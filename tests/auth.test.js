const test = require("node:test");
const assert = require("node:assert/strict");

const { hashPassword, verifyPassword } = require("../services/auth.service");

test("scrypt verifica la password corretta e rifiuta quella errata", async () => {
  const hash = await hashPassword("12345678");

  assert.equal(await verifyPassword("12345678", hash), true);
  assert.equal(await verifyPassword("password-errata", hash), false);
  assert.equal(hash.startsWith("scrypt$"), true);
});

test("hash successivi della stessa password usano salt differenti", async () => {
  const first = await hashPassword("12345678");
  const second = await hashPassword("12345678");

  assert.notEqual(first, second);
});
