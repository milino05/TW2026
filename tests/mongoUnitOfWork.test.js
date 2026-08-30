const test = require("node:test");
const assert = require("node:assert/strict");
const {
  installMongoUnitOfWorkCompatibility,
  supportsNativeTransactionsFromHello,
} = require("../config/mongoUnitOfWork");

test("Mongo capability detection distinguishes standalone from transaction-capable topologies", () => {
  assert.equal(supportsNativeTransactionsFromHello({ isWritablePrimary: true }), false);
  assert.equal(supportsNativeTransactionsFromHello({ setName: "rs0", isWritablePrimary: true }), true);
  assert.equal(supportsNativeTransactionsFromHello({ msg: "isdbgrid" }), true);
});

test("standalone Mongo executes an ordered unit of work without a ClientSession", async () => {
  let nativeCalls = 0;
  const connection = {
    db: { admin: () => ({ command: async () => ({ isWritablePrimary: true }) }) },
    transaction: async (work) => {
      nativeCalls += 1;
      return work({ native: true });
    },
  };
  const state = installMongoUnitOfWorkCompatibility(connection);
  const result = await connection.transaction(async (session) => {
    assert.equal(session, null);
    return "ordered-result";
  });
  assert.equal(result, "ordered-result");
  assert.equal(nativeCalls, 0);
  assert.equal(state.mode, "ordered");
});

test("replica-set Mongo preserves the native Mongoose transaction", async () => {
  let nativeCalls = 0;
  const nativeSession = { native: true };
  const connection = {
    db: { admin: () => ({ command: async () => ({ setName: "rs0", isWritablePrimary: true }) }) },
    transaction: async (work) => {
      nativeCalls += 1;
      return work(nativeSession);
    },
  };
  const state = installMongoUnitOfWorkCompatibility(connection);
  const result = await connection.transaction(async (session) => {
    assert.equal(session, nativeSession);
    return "transaction-result";
  });
  assert.equal(result, "transaction-result");
  assert.equal(nativeCalls, 1);
  assert.equal(state.mode, "transaction");
});
