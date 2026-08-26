const discovery = require("../services/marketplaceDiscoveryV2.service");

async function organizations(req, res, next) {
  try { res.status(200).json(await discovery.organizationDirectory({ q: req.query.q, page: req.query.page, limit: req.query.limit })); }
  catch (error) { next(error); }
}
async function organization(req, res, next) {
  try { res.status(200).json(await discovery.organizationPublicProfile({ organizationId: req.params.organizationId })); }
  catch (error) { next(error); }
}
async function venues(req, res, next) {
  try { res.status(200).json(await discovery.venueDirectory({ q: req.query.q, page: req.query.page, limit: req.query.limit })); }
  catch (error) { next(error); }
}
async function venue(req, res, next) {
  try { res.status(200).json(await discovery.venuePublicProfile({ venueId: req.params.venueId })); }
  catch (error) { next(error); }
}
module.exports = { organizations, organization, venues, venue };
