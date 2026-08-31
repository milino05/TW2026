export class GuidedTourController {
  constructor({ steps = [], storageKey = null, onStepChange = null, onClose = null } = {}) {
    this.steps = [...steps];
    this.storageKey = storageKey;
    this.onStepChange = onStepChange;
    this.onClose = onClose;
    this.index = 0;
    this.open = false;
  }

  get current() { return this.steps[this.index] || null; }
  get progress() { return { current: this.steps.length ? this.index + 1 : 0, total: this.steps.length }; }

  setSteps(steps = []) {
    this.steps = [...steps];
    this.index = this.steps.length ? Math.max(0, Math.min(this.steps.length - 1, this.index)) : 0;
    return this.current;
  }

  wasSeen() {
    if (!this.storageKey) return false;
    try { return localStorage.getItem(this.storageKey) === "seen"; } catch { return false; }
  }

  rememberSeen() {
    if (!this.storageKey) return;
    try { localStorage.setItem(this.storageKey, "seen"); } catch { /* persistence is non-blocking */ }
  }

  start({ remember = true, index = 0 } = {}) {
    if (!this.steps.length) return null;
    this.open = true;
    this.index = Math.max(0, Math.min(this.steps.length - 1, Number(index) || 0));
    if (remember) this.rememberSeen();
    this.emit();
    return this.current;
  }

  setStep(index) {
    if (!this.open || !this.steps.length) return null;
    this.index = Math.max(0, Math.min(this.steps.length - 1, Number(index) || 0));
    this.emit();
    return this.current;
  }

  next() { return this.setStep(this.index + 1); }
  previous() { return this.setStep(this.index - 1); }

  close(reason = "dismissed") {
    if (!this.open) return;
    this.open = false;
    this.onClose?.({ reason, index: this.index, step: this.current, progress: this.progress });
  }

  target(root = document) {
    const selector = this.current?.target;
    return selector ? root.querySelector(selector) : null;
  }

  emit() {
    this.onStepChange?.({ index: this.index, step: this.current, progress: this.progress, target: this.target() });
  }
}
