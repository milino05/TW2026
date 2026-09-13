import { venueMapRefinementMixin as venueMapRefinementBaseMixin } from "./venue-editor-map-refinement-base.js";
import { extendVenueMapRefinementMixin } from "./venue-editor-map-interaction-refinement-mixin.js";

export const venueMapRefinementMixin = extendVenueMapRefinementMixin(venueMapRefinementBaseMixin);
