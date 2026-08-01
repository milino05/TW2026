const Visit = require("../models/visit");

/**
 * Quando un item usato da una visita cambia o viene eliminato, la visita non
 * viene corretta automaticamente: torna in draft e richiede un nuovo controllo.
 */
async function invalidateVisitsUsingItem({ itemId, code, message, context = {} }) {
  const visits = await Visit.find({ "stops.itemId": itemId });

  for (const visit of visits) {
    const existingIssues = Array.isArray(visit.integrity?.issues) ? visit.integrity.issues : [];
    const alreadyPresent = existingIssues.some(
      (issue) => issue.code === code && String(issue.context?.itemId || "") === String(itemId),
    );

    const issues = alreadyPresent
      ? existingIssues
      : [
          ...existingIssues,
          {
            code,
            field: "stops",
            message,
            context: { itemId, ...context },
          },
        ];

    visit.integrity = {
      status: "needs_review",
      issues,
    };

    if (visit.status === "published") {
      visit.status = "draft";
      visit.publishedAt = null;
    }

    await visit.save();
  }

  return visits.length;
}

module.exports = {
  invalidateVisitsUsingItem,
};
