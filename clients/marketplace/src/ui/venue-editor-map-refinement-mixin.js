import { venueMapRefinementMixin as venueMapRefinementBaseMixin } from "./venue-editor-map-refinement-base.js";
import { extendVenueMapRefinementMixin } from "./venue-editor-map-interaction-refinement-mixin.js";

const refinedVenueMapMixin = extendVenueMapRefinementMixin(venueMapRefinementBaseMixin);

export const venueMapRefinementMixin = {
  ...refinedVenueMapMixin,
  render(...args) {
    const result = refinedVenueMapMixin.render.apply(this, args);
    this.decorateNavigatorWorkspace?.();
    return result;
  },
};
