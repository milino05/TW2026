const PATHS = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10M9 20v-6h6v6"/>',
  catalog: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20"/>',
  workspace: '<rect width="18" height="14" x="3" y="5" rx="2"/><path d="M8 5V3h8v2M3 10h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  museum: '<path d="m3 10 9-6 9 6M5 10h14M6 10v8M10 10v8M14 10v8M18 10v8M4 21h16"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  arrowLeft: '<path d="m15 18-6-6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  building: '<rect width="16" height="18" x="4" y="3" rx="2"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M9 21v-5h6v5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z"/><path d="M8 7h8M8 11h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/>',
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h2a4 4 0 0 0 4-4v-4a4 4 0 0 1 4-4"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  store: '<path d="M4 10v10h16V10"/><path d="M3 4h18l-1 6a3 3 0 0 1-5 1 3 3 0 0 1-6 0 3 3 0 0 1-5-1L3 4ZM9 20v-6h6v6"/>',
  tag: '<path d="M20 13 13 20l-9-9V4h7l9 9Z"/><circle cx="8.5" cy="8.5" r="1.5"/>',
  shield: '<path d="M12 3 5 6v5c0 4.6 2.9 8.2 7 10 4.1-1.8 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/>',
  lock: '<rect width="16" height="11" x="4" y="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
};

export function icon(name, { size = 18, label = "" } = {}) {
  const path = PATHS[name] || PATHS.info;
  return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}>${path}</svg>`;
}
