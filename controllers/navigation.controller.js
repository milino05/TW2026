const service = require("../services/navigation.service");
async function route(req, res, next) {
  try {
    res.json(await service.routeBetweenPlaces({
      museumId: req.params.museumId,
      userId: req.user._id,
      fromPlaceId: req.body?.fromPlaceId,
      toPlaceId: req.body?.toPlaceId,
      navigation: req.body?.navigation || {},
    }));
  } catch (error) { next(error); }
}
async function intent(req, res, next) {
  try {
    res.json(await service.routeToIntent({
      museumId: req.params.museumId,
      userId: req.user._id,
      fromPlaceId: req.body?.fromPlaceId,
      intent: req.body?.intent,
      navigation: req.body?.navigation || {},
    }));
  } catch (error) { next(error); }
}
module.exports = { route, intent };
