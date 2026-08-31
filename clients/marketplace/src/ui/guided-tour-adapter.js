import { GuidedTourController } from "../application/guided-tour-controller.js";

const CONFIGS = [
  {
    selector: "artaround-namespace-editor-view",
    storageKey: "artaround.namespace-editor.tutorial.v1",
    progressSelector: ".namespace-tutorial-progress > span",
    closeMethod: "finishTutorial",
    rememberMethod: "rememberTutorialSeen",
  },
  {
    selector: "artaround-physical-vocabulary-editor-view",
    storageKey: "artaround.physical-vocabulary-editor.tutorial.v2",
    progressSelector: ".physical-tutorial-progress > span",
    closeMethod: "closeTutorial",
  },
];

const states = new WeakMap();
let observer = null;
let scanQueued = false;

function placeholderSteps(count) {
  return Array.from({ length: count }, (_, index) => ({ id: String(index), target: null }));
}

function progressCount(editor, config) {
  return editor.querySelectorAll(config.progressSelector).length;
}

function synchronizeController(editor, config, state, { rememberSeen = false } = {}) {
  const count = progressCount(editor, config);
  if (count) state.controller.setSteps(placeholderSteps(count));
  if (rememberSeen) state.controller.rememberSeen();

  if (editor.tutorialOpen && state.controller.steps.length) {
    if (!state.controller.open) state.controller.start({ remember: false, index: editor.tutorialStep });
    else state.controller.setStep(editor.tutorialStep);
  } else if (!editor.tutorialOpen && state.controller.open) {
    state.controller.close("external");
  }
}

function installEditor(editor, config) {
  let state = states.get(editor);
  if (state) {
    synchronizeController(editor, config, state);
    return;
  }

  const controller = new GuidedTourController({ storageKey: config.storageKey });
  state = { controller };
  states.set(editor, state);
  editor.artaroundGuidedTour = controller;
  editor.dataset.artaroundGuidedTour = "true";

  const originalStart = typeof editor.startTutorial === "function" ? editor.startTutorial.bind(editor) : null;
  const originalSetStep = typeof editor.setTutorialStep === "function" ? editor.setTutorialStep.bind(editor) : null;
  const originalClose = typeof editor[config.closeMethod] === "function" ? editor[config.closeMethod].bind(editor) : null;

  if (originalStart) {
    editor.startTutorial = (...args) => {
      const result = originalStart(...args);
      const rememberSeen = Boolean(args[0]?.remember);
      synchronizeController(editor, config, state, { rememberSeen });
      return result;
    };
  }

  if (originalSetStep) {
    editor.setTutorialStep = (requestedStep) => {
      synchronizeController(editor, config, state);
      if (!controller.open && editor.tutorialOpen && controller.steps.length) controller.start({ remember: false, index: editor.tutorialStep });
      const resolved = controller.setStep(requestedStep);
      const result = originalSetStep(resolved ? controller.index : requestedStep);
      synchronizeController(editor, config, state);
      return result;
    };
  }

  if (originalClose) {
    editor[config.closeMethod] = (...args) => {
      controller.close("dismissed");
      const result = originalClose(...args);
      synchronizeController(editor, config, state);
      return result;
    };
  }

  if (config.rememberMethod && typeof editor[config.rememberMethod] === "function") {
    const originalRemember = editor[config.rememberMethod].bind(editor);
    editor[config.rememberMethod] = (...args) => {
      controller.rememberSeen();
      return originalRemember(...args);
    };
  }

  synchronizeController(editor, config, state);
}

function scanEditors() {
  for (const config of CONFIGS) {
    for (const editor of document.querySelectorAll(config.selector)) installEditor(editor, config);
  }
}

function queueScan() {
  if (scanQueued) return;
  scanQueued = true;
  queueMicrotask(() => {
    scanQueued = false;
    scanEditors();
  });
}

export function installGuidedTourAdapter() {
  if (observer || typeof document === "undefined") return;
  queueScan();
  observer = new MutationObserver(queueScan);
  observer.observe(document.body, { childList: true, subtree: true });
}

installGuidedTourAdapter();
