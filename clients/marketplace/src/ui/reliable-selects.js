const RELIABLE_SELECT_SELECTOR = "select:not([multiple]):not([data-native-select])";
const controllers = new WeakMap();

const RELIABLE_SELECT_STYLES = `
  .reliable-select{position:relative;display:block;width:100%;min-width:0;font:inherit}
  .reliable-select__native{position:absolute!important;width:1px!important;height:1px!important;min-height:1px!important;margin:0!important;padding:0!important;overflow:hidden!important;clip:rect(0 0 0 0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;opacity:0!important;pointer-events:none!important}
  .reliable-select__details{position:relative;width:100%;border:0!important;border-radius:.55rem}
  .reliable-select__summary{display:flex;box-sizing:border-box;width:100%;min-height:2.7rem;align-items:center;justify-content:space-between;gap:.65rem;border:1px solid var(--line-strong,#91a39b);border-radius:.55rem;padding:.62rem .72rem;background:var(--surface,#fff);color:var(--ink-950,#173e35);font:inherit;font-weight:500;line-height:1.35;list-style:none;cursor:pointer}
  .reliable-select__summary::-webkit-details-marker{display:none}
  .reliable-select__summary::marker{content:""}
  .reliable-select__summary::after{content:"⌄";flex:0 0 auto;font-size:1rem;font-weight:800;line-height:1;transition:transform .15s ease}
  .reliable-select__details[open]>.reliable-select__summary{margin-bottom:0;border-color:var(--ink-800,#173e35);box-shadow:0 0 0 3px rgba(233,168,68,.3)}
  .reliable-select__details[open]>.reliable-select__summary::after{transform:rotate(180deg)}
  .reliable-select__summary:focus-visible{outline:3px solid rgba(233,168,68,.36);outline-offset:2px;border-color:var(--ink-800,#173e35)}
  .reliable-select__details[data-disabled="true"]>.reliable-select__summary{cursor:not-allowed;opacity:.55}
  .reliable-select__options{position:absolute;z-index:90;top:calc(100% + .35rem);right:0;left:0;display:grid;max-height:min(18rem,50vh);gap:.2rem;overflow:auto;padding:.3rem;border:1px solid var(--line,#c4d0ca);border-radius:.6rem;background:var(--surface,#fff);box-shadow:0 .8rem 2rem rgba(16,40,33,.18)}
  .reliable-select__option{display:flex;box-sizing:border-box;width:100%;min-height:2.45rem;align-items:center;justify-content:space-between;gap:.5rem;border:0;border-radius:.4rem;padding:.55rem .65rem;background:var(--surface,#fff);color:var(--ink-950,#173e35);font:inherit;font-weight:600;text-align:left;box-shadow:none;transform:none;cursor:pointer}
  .reliable-select__option:hover:not(:disabled),.reliable-select__option[aria-selected="true"]{background:var(--sage-100,#eef4f1);color:var(--ink-950,#173e35);box-shadow:none;transform:none}
  .reliable-select__option:focus-visible{outline:2px solid var(--ink-800,#173e35);outline-offset:-2px}
  .reliable-select__option:disabled{cursor:not-allowed;opacity:.48}
  .reliable-select__check{flex:0 0 auto;font-weight:900}
  .reliable-select__error{display:block;margin-top:.35rem;color:#842f22;font-size:.78rem;font-weight:650}
`;

function styleHost(root) {
  return root instanceof ShadowRoot ? root : document.head;
}

function ensureReliableSelectStyles(root) {
  const host = styleHost(root);
  if (host.querySelector("style[data-reliable-select-styles]")) return;
  const style = document.createElement("style");
  style.dataset.reliableSelectStyles = "true";
  style.textContent = RELIABLE_SELECT_STYLES;
  host.append(style);
}

function directLabelText(select) {
  const ariaLabel = String(select.getAttribute("aria-label") || "").trim();
  if (ariaLabel) return ariaLabel;
  const labelledBy = String(select.getAttribute("aria-labelledby") || "").trim();
  if (labelledBy) {
    const labelledText = labelledBy.split(/\s+/).map((entry) => select.getRootNode().getElementById?.(entry)?.textContent || "").join(" ").trim();
    if (labelledText) return labelledText;
  }
  const label = select.labels?.[0] || select.closest("label");
  const directText = label ? [...label.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim() : "";
  return directText || select.name || "Scegli un'opzione";
}

function optionButtons(list, select, choose) {
  list.replaceChildren();
  for (const option of select.options) {
    const button = document.createElement("button");
    button.className = "reliable-select__option";
    button.type = "button";
    button.setAttribute("role", "option");
    button.dataset.value = option.value;
    button.disabled = option.disabled;
    const text = document.createElement("span");
    text.textContent = option.label || option.textContent || option.value;
    const check = document.createElement("span");
    check.className = "reliable-select__check";
    check.setAttribute("aria-hidden", "true");
    button.append(text, check);
    button.addEventListener("click", () => choose(option.value));
    list.append(button);
  }
}

function enhanceReliableSelect(select) {
  if (!(select instanceof HTMLSelectElement) || controllers.has(select) || select.multiple || Number(select.size) > 1) return;
  const label = directLabelText(select);
  const wrapper = document.createElement("span");
  wrapper.className = "reliable-select";
  const details = document.createElement("details");
  details.className = "reliable-select__details";
  details.setAttribute("name", "artaround-reliable-select");
  const summary = document.createElement("summary");
  summary.className = "reliable-select__summary";
  summary.setAttribute("role", "button");
  summary.setAttribute("aria-haspopup", "listbox");
  summary.setAttribute("aria-label", label);
  summary.setAttribute("aria-expanded", "false");
  const value = document.createElement("span");
  value.className = "reliable-select__value";
  summary.append(value);
  const list = document.createElement("div");
  list.className = "reliable-select__options";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", label);
  const error = document.createElement("small");
  error.className = "reliable-select__error";
  error.textContent = "Seleziona un'opzione prima di continuare.";
  error.hidden = true;

  select.replaceWith(wrapper);
  select.classList.add("reliable-select__native");
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  wrapper.append(select, details, error);
  details.append(summary, list);

  const sync = () => {
    const selected = select.selectedOptions?.[0] || select.options[select.selectedIndex] || null;
    value.textContent = selected?.label || selected?.textContent || "Scegli un'opzione";
    details.dataset.disabled = String(select.disabled);
    summary.tabIndex = select.disabled ? -1 : 0;
    summary.setAttribute("aria-disabled", String(select.disabled));
    summary.setAttribute("aria-required", String(select.required));
    summary.setAttribute("aria-invalid", String(!select.validity.valid));
    for (const button of list.querySelectorAll("button[data-value]")) {
      const selectedOption = button.dataset.value === select.value;
      button.setAttribute("aria-selected", String(selectedOption));
      const check = button.querySelector(".reliable-select__check");
      if (check) check.textContent = selectedOption ? "✓" : "";
    }
    if (select.validity.valid) error.hidden = true;
  };
  const choose = (nextValue) => {
    if (select.disabled) return;
    select.value = nextValue;
    select.setCustomValidity("");
    details.open = false;
    sync();
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    summary.focus({ preventScroll: true });
  };
  const rebuild = () => { optionButtons(list, select, choose); sync(); };
  controllers.set(select, { rebuild, sync });
  rebuild();

  select.addEventListener("change", sync);
  select.addEventListener("invalid", (event) => {
    event.preventDefault();
    details.open = true;
    error.hidden = false;
    summary.setAttribute("aria-invalid", "true");
    summary.focus({ preventScroll: true });
  });
  summary.addEventListener("click", (event) => { if (select.disabled) event.preventDefault(); });
  summary.addEventListener("keydown", (event) => {
    if (select.disabled || !["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    details.open = true;
    const enabled = [...list.querySelectorAll("button:not(:disabled)")];
    const selectedIndex = enabled.findIndex((button) => button.dataset.value === select.value);
    enabled[Math.max(0, selectedIndex)]?.focus();
  });
  list.addEventListener("keydown", (event) => {
    const buttons = [...list.querySelectorAll("button:not(:disabled)")];
    const current = buttons.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); details.open = false; summary.focus(); return; }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowDown" ? Math.min(buttons.length - 1, current + 1) : Math.max(0, current - 1);
    buttons[next]?.focus();
  });
  details.addEventListener("toggle", () => {
    summary.setAttribute("aria-expanded", String(details.open));
    if (details.open) requestAnimationFrame(() => list.querySelector('button[aria-selected="true"]:not(:disabled)')?.focus({ preventScroll: true }));
  });
}

export function enhanceReliableSelects(root) {
  ensureReliableSelectStyles(root);
  if (root instanceof HTMLSelectElement && root.matches(RELIABLE_SELECT_SELECTOR)) enhanceReliableSelect(root);
  for (const select of root.querySelectorAll?.(RELIABLE_SELECT_SELECTOR) || []) enhanceReliableSelect(select);
}

export function observeReliableSelects(root) {
  enhanceReliableSelects(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target instanceof HTMLSelectElement) controllers.get(record.target)?.rebuild();
      for (const node of record.addedNodes) if (node instanceof Element || node instanceof ShadowRoot) enhanceReliableSelects(node);
    }
  });
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "required"] });
  const closeOutside = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".reliable-select__details")) return;
    for (const details of root.querySelectorAll?.(".reliable-select__details[open]") || []) details.open = false;
  };
  root.addEventListener("click", closeOutside);
  return () => { observer.disconnect(); root.removeEventListener("click", closeOutside); };
}
