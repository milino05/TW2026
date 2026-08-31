function isolatedTestMongoUri(value) {
  if (!value) return value;
  const parsed = new URL(value);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || "artaround";
  if (!databaseName.endsWith("_test_suite")) {
    parsed.pathname = `/${encodeURIComponent(`${databaseName}_test_suite`)}`;
  }
  return parsed.toString();
}

if (process.env.MONGO_URI) {
  process.env.MONGO_URI = isolatedTestMongoUri(process.env.MONGO_URI);
  process.env.ARTAROUND_ALLOW_CONFIGURED_DATABASE_DROP = "true";
}

module.exports = { isolatedTestMongoUri };
