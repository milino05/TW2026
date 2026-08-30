const mongoose = require("mongoose");

const INSTALL_MARKER = Symbol.for("artaround.mongoUnitOfWork.installed");

function supportsNativeTransactionsFromHello(hello) {
  return Boolean(hello?.setName || hello?.msg === "isdbgrid");
}

async function detectNativeTransactionSupport(connection) {
  if (!connection?.db) {
    throw new Error("MongoDB connection is not ready");
  }
  const hello = await connection.db.admin().command({ hello: 1 });
  return supportsNativeTransactionsFromHello(hello);
}

function installMongoUnitOfWorkCompatibility(connection = mongoose.connection) {
  if (!connection || typeof connection.transaction !== "function") {
    throw new TypeError("A Mongoose connection with transaction() is required");
  }
  if (connection[INSTALL_MARKER]) return connection[INSTALL_MARKER];

  const nativeTransaction = connection.transaction.bind(connection);
  const state = {
    nativeTransaction,
    mode: "unknown",
  };

  connection.transaction = async function transactionWithCapabilityFallback(work, options) {
    if (typeof work !== "function") return nativeTransaction(work, options);
    const supportsNativeTransactions = await detectNativeTransactionSupport(connection);
    state.mode = supportsNativeTransactions ? "transaction" : "ordered";
    if (supportsNativeTransactions) return nativeTransaction(work, options);

    // Department MongoDB is standalone. Domain commands are therefore executed
    // as an ordered unit of work without a ClientSession. Callers must keep
    // individual writes atomic/idempotent and use live lifecycle state as the
    // authority for externally visible availability.
    return work(null);
  };

  connection[INSTALL_MARKER] = state;
  return state;
}

installMongoUnitOfWorkCompatibility();

module.exports = {
  detectNativeTransactionSupport,
  installMongoUnitOfWorkCompatibility,
  supportsNativeTransactionsFromHello,
};
