// Every item of the sidebar that can be shown/hidden with permissions
// (`comercial:<module>:view` — migrations 079, 093 and 115), grouped by menu
// section and in the same order as the menu. ONE place: the sidebar gates its
// items with these module names, and both screens that edit the visibility
// (per person in "Gerenciar acesso", per cargo in "Cargos e permissões") draw
// their lists from here. A new menu item = one line here + its permission row.
//
// Labels come from the "Sidebar" namespace (nested keys allowed).

export interface NavItem {
  module: string;
  labelKey: string;
}

/**
 * Key (in nav_overrides) of the "Acessar Afiliados" permission
 * (operational:affiliates:access). It has no switch of its own: the person's
 * "Afiliados" menu choice drives it, so Visível = sees AND can open it.
 */
export const AFFILIATES_ACCESS_MODULE = 'affiliates_access';
/** The menu item whose choice also grants/denies the access permission above. */
export const AFFILIATES_MENU_MODULE = 'op_affiliates';

export interface NavSection {
  key: string;
  titleKey: string;
  /** Switch for the whole section (hides every item inside). */
  master: NavItem;
  items: NavItem[];
  /** Shown instead of switches for a section that is not configurable. */
  noteKey?: string;
}

export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'comercial',
    titleKey: 'environment.comercial',
    master: { module: 'section_comercial', labelKey: 'menuAdmin.wholeSection' },
    items: [
      { module: 'dashboard', labelKey: 'dashboard' },
      { module: 'inbox', labelKey: 'inbox' },
      { module: 'contacts', labelKey: 'contacts' },
      { module: 'prospecting', labelKey: 'prospecting' },
      { module: 'pipelines', labelKey: 'pipelines' },
      { module: 'activities', labelKey: 'activities' },
      { module: 'broadcasts', labelKey: 'broadcasts' },
      { module: 'automations', labelKey: 'automations' },
      { module: 'flows', labelKey: 'flows' },
      { module: 'agents', labelKey: 'aiAgents' },
    ],
  },
  {
    key: 'operational',
    titleKey: 'environment.operational',
    master: { module: 'operational', labelKey: 'menuAdmin.wholeSection' },
    items: [
      { module: 'op_dashboard', labelKey: 'menuAdmin.opDashboard' },
      { module: 'op_boards', labelKey: 'menuAdmin.opBoards' },
      { module: 'op_clients', labelKey: 'menuAdmin.opClients' },
      { module: AFFILIATES_MENU_MODULE, labelKey: 'menuAdmin.opAffiliates' },
    ],
  },
  {
    key: 'chat',
    titleKey: 'environment.chat',
    master: { module: 'chat', labelKey: 'menuAdmin.wholeSection' },
    items: [],
  },
  {
    key: 'materiais',
    titleKey: 'materiais',
    // The `playbook` module name is the gate's historical name (it used to
    // just be the Playbook link); the section it gates is "Materiais".
    master: { module: 'playbook', labelKey: 'menuAdmin.wholeSection' },
    items: [
      { module: 'mat_comercial', labelKey: 'menuAdmin.matComercial' },
      { module: 'mat_midia', labelKey: 'menuAdmin.matMidia' },
    ],
  },
  {
    key: 'financeiro',
    titleKey: 'environment.financeiro',
    master: { module: '', labelKey: '' },
    items: [],
    noteKey: 'menuAdmin.financeiroNote',
  },
];

/** Section keys whose items need "Operacional ›" style prefixes where the list is flat. */
const PREFIXED = new Set(['operational', 'materiais']);

/** Every configurable module, flat (used where the grouped layout is not needed). */
export const NAV_MODULES: { module: string; labelKey: string }[] = NAV_SECTIONS.flatMap((s) =>
  s.master.module ? [s.master, ...s.items] : s.items,
);

/**
 * Unambiguous label for a module in a flat list: "Dashboard" exists in both
 * Comercial and Operacional, and a section's own switch reads "Chat" /
 * "Operacional" / "Materiais" (not "menu inteiro").
 */
export function navLabel(t: (key: string) => string, module: string): string {
  for (const section of NAV_SECTIONS) {
    if (section.master.module === module) {
      return section.key === 'comercial' ? `${t(section.titleKey)} · ${t(section.master.labelKey)}` : t(section.titleKey);
    }
    const item = section.items.find((i) => i.module === module);
    if (item) return PREFIXED.has(section.key) ? `${t(section.titleKey)} › ${t(item.labelKey)}` : t(item.labelKey);
  }
  return module;
}
