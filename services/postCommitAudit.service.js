async function runPostCommitAudit(tasks = {}) {
  const results = {};
  const failures = [];
  for (const [name, task] of Object.entries(tasks)) {
    try {
      results[name] = await task();
    } catch (error) {
      failures.push({ name, message: error?.message || String(error) });
      results[name] = null;
    }
  }
  return { status: failures.length ? "incomplete" : "complete", results, failures };
}

module.exports = { runPostCommitAudit };
