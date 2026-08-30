import "./venue-slot-subject-assignment.js";
import { venueSectionMixin } from "./venue-editor-section-mixin.js";

export const venueSlotSubjectUiMixin = {
  render() {
    venueSectionMixin.render.call(this);
    if (!this.data || this.onboarding?.required) return;

    for (const assignmentForm of this.querySelectorAll("[data-slot-assignment]")) {
      const exhibitSlotId = assignmentForm.dataset.slotAssignment;
      if (!exhibitSlotId || assignmentForm.nextElementSibling?.matches("artaround-venue-slot-subject-assignment")) continue;
      const chooser = document.createElement("artaround-venue-slot-subject-assignment");
      chooser.setAttribute("venue-id", this.id);
      chooser.setAttribute("exhibit-slot-id", exhibitSlotId);
      assignmentForm.insertAdjacentElement("afterend", chooser);
    }
  },
};
