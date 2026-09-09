// Sidebar nav items that can be shown/hidden via permissions (migration
// 079) — mirrors the `module` values set on navItems in
// components/layout/sidebar.tsx, and reuses that component's own
// translation keys ("Sidebar" namespace) so labels never drift between
// surfaces. Dashboard has no `module` there (never hideable), so it's
// intentionally absent here too. Shared by members-tab.tsx (per-person
// overrides) and roles-panel.tsx (per-cargo permissions + bulk toggle).
export const NAV_MODULES: { module: string; labelKey: string }[] = [
  { module: 'inbox', labelKey: 'inbox' },
  { module: 'notifications', labelKey: 'notifications' },
  { module: 'contacts', labelKey: 'contacts' },
  { module: 'prospecting', labelKey: 'prospecting' },
  { module: 'pipelines', labelKey: 'pipelines' },
  { module: 'activities', labelKey: 'activities' },
  { module: 'broadcasts', labelKey: 'broadcasts' },
  { module: 'automations', labelKey: 'automations' },
  { module: 'flows', labelKey: 'flows' },
  { module: 'agents', labelKey: 'aiAgents' },
  { module: 'playbook', labelKey: 'playbook' },
];
