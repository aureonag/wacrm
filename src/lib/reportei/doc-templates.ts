// Report templates: which networks a report has and which indicators go in each,
// never any number. A template is a `TemplateLayout`; making a report from one means
// choosing the client's integrations and asking a data source (today the demo one,
// later Meta, Google, TikTok, YouTube...) for each (network, key). The same list is
// shown wherever a report is started: the Reportei ones (built in), the experts' and
// "Meus templates" (both stored in the database).

import { LIMITS, type IdMaker, type ReportDoc } from "./doc";
import { CATALOG_NETWORKS, NETWORK_CATALOG, blockFrom, catalogEntry, customBlockFrom, defaultKeys, type DataSource, type Range } from "./doc-catalog";

export interface LayoutBlock {
  network: string;
  /** Catalog keys of the indicators, in order. */
  keys: string[];
}

export interface CustomItem {
  key: string;
  /** Networks that make the total up (their icons show under it). The item is left out when none is connected. */
  networks: string[];
}

export interface TemplateLayout {
  custom: CustomItem[];
  blocks: LayoutBlock[];
}

export const EMPTY_LAYOUT: TemplateLayout = { custom: [], blocks: [] };

// ---- validation ------------------------------------------------------------------------

/** A usable layout from untrusted input (a saved template); unknown networks and keys are dropped. Null when nothing is left. */
export function parseLayout(input: unknown): TemplateLayout | null {
  if (typeof input !== "object" || input === null) return null;
  const o = input as Record<string, unknown>;
  if (!Array.isArray(o.blocks) || o.blocks.length > LIMITS.blocks) return null;

  const blocks: LayoutBlock[] = [];
  for (const b of o.blocks) {
    if (typeof b !== "object" || b === null) return null;
    const { network, keys } = b as Record<string, unknown>;
    if (typeof network !== "string" || !CATALOG_NETWORKS.includes(network) || !Array.isArray(keys) || keys.length > LIMITS.widgetsPerBlock) return null;
    const known = keys.filter((k): k is string => typeof k === "string" && catalogEntry(network, k) !== null);
    if (known.length > 0) blocks.push({ network, keys: known });
  }

  const custom: CustomItem[] = [];
  for (const c of Array.isArray(o.custom) ? o.custom : []) {
    if (typeof c !== "object" || c === null) return null;
    const { key, networks } = c as Record<string, unknown>;
    if (typeof key !== "string" || catalogEntry("custom", key) === null || !Array.isArray(networks)) return null;
    custom.push({ key, networks: networks.filter((n): n is string => typeof n === "string" && CATALOG_NETWORKS.includes(n)) });
  }

  return blocks.length > 0 || custom.length > 0 ? { custom, blocks } : null;
}

/** The layout of a report document: what its blocks hold, so it can be saved as a template. */
export function layoutOfDoc(doc: ReportDoc): TemplateLayout {
  const blocks: LayoutBlock[] = [];
  const custom: CustomItem[] = [];
  for (const b of doc.blocks) {
    const keys = b.widgets.map((w) => w.key).filter((k): k is string => !!k);
    if (b.kind === "custom") {
      for (const w of b.widgets) if (w.key && w.kind === "metric") custom.push({ key: w.key, networks: w.networks });
    } else if (b.network && keys.length > 0) {
      blocks.push({ network: b.network, keys });
    }
  }
  return { custom, blocks };
}

// ---- making a document from a layout -----------------------------------------------------

export interface Integration {
  network: string;
  /** The account's name, shown under the block title. */
  account: string;
}

/**
 * The report document for a layout and the integrations chosen for it. A block exists
 * for each chosen integration of a network the layout has; a chosen network the layout
 * does not have still gets its usual indicators; a network of the layout with no chosen
 * integration is left out. The Bloco Personalizado keeps the totals whose networks are there.
 */
export function buildDocFromTemplate(
  opts: { layout: TemplateLayout; integrations: Integration[]; range: Range; seed: string; source: DataSource },
  newId: IdMaker,
): ReportDoc {
  const { layout, integrations, range, seed, source } = opts;
  const present = new Set(integrations.map((i) => i.network));

  const customItems = layout.custom
    .map((it) => ({ key: it.key, networks: it.networks.filter((n) => present.has(n)) }))
    .filter((it) => it.networks.length > 0);

  const blocks = [...(customItems.length > 0 ? [customBlockFrom(source, customItems, range, seed, newId)] : [])];
  const done = new Set<string>();
  // First the networks in the layout's order, then any other chosen one.
  const order = [...layout.blocks.map((b) => b.network), ...integrations.map((i) => i.network)].filter((n, i, all) => all.indexOf(n) === i);
  for (const network of order) {
    const keys = layout.blocks.find((b) => b.network === network)?.keys ?? defaultKeys(network);
    for (const integration of integrations.filter((i) => i.network === network)) {
      const id = `${network}:${integration.account}`;
      if (done.has(id)) continue;
      done.add(id);
      blocks.push(blockFrom(source, network, integration.account, keys, range, seed, newId));
    }
  }
  return { version: 1, demo: source.demo, cover: { hidden: false, subtitle: "Análise de desempenho", analysis: "" }, blocks };
}

/** What a layout contains, for the preview: per block, the titles of its indicators. */
export function layoutSummary(layout: TemplateLayout): { network: string | null; title: string; indicators: string[] }[] {
  const custom = layout.custom.map((c) => catalogEntry("custom", c.key)?.title).filter((t): t is string => !!t);
  return [
    ...(custom.length > 0 ? [{ network: null, title: "Bloco Personalizado", indicators: custom }] : []),
    ...layout.blocks.map((b) => ({
      network: b.network,
      title: b.network,
      indicators: b.keys.map((k) => catalogEntry(b.network, k)?.title).filter((t): t is string => !!t),
    })),
  ];
}

// ---- the templates that come with the system ----------------------------------------------

export type TemplateGroup = "reportei" | "expert" | "mine";

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  layout: TemplateLayout;
}

const L = (blocks: [string, string[]][], custom: [string, string[]][] = []): TemplateLayout => ({
  custom: custom.map(([key, networks]) => ({ key, networks })),
  blocks: blocks.map(([network, keys]) => ({ network, keys })),
});

const SOCIAL = ["facebook", "instagram_business"];
const ADS = ["meta_ads", "google_ads", "tiktok_ads"];

/** The model of a client's dashboard (the Amexlog one in Reportei): totals, then each network with its indicators. */
export const DASHBOARD_LAYOUT: TemplateLayout = {
  custom: ["total_spend", "total_impressions", "total_clicks", "total_ads"].map((key) => ({ key, networks: ["meta_ads", "google_ads"] })).concat(["total_reach", "total_engagement", "total_new_followers", "total_posts"].map((key) => ({ key, networks: SOCIAL }))),
  blocks: [
    { network: "google_ads", keys: ["g_cost", "g_impressions", "g_clicks", "g_ctr", "g_cpc", "g_cpm", "g_conversions", "g_conversion_value", "g_conversion_rate", "g_all_conversions", "g_all_conversion_value", "g_roas", "g_all_campaigns", "g_pmax_assets", "g_clicks_over_time", "g_conversions_over_time", "g_cost_over_time", "g_ad_groups", "g_cost_by_device", "g_conversions_by_device", "g_clicks_by_device", "g_keywords"] },
    { network: "meta_ads", keys: defaultKeys("meta_ads") },
    { network: "instagram_business", keys: defaultKeys("instagram_business") },
    { network: "facebook", keys: defaultKeys("facebook") },
  ],
};

/** The four models of Reportei, built in and read-only. */
export const REPORTEI_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "builtin:padrao",
    name: "Padrão",
    description: "Modelo clássico do Reportei, com as principais métricas para uma análise completa!",
    layout: L(
      [
        ["instagram_business", defaultKeys("instagram_business")],
        ["facebook", defaultKeys("facebook")],
        ["meta_ads", defaultKeys("meta_ads")],
        ["google_ads", defaultKeys("google_ads")],
        ["google_analytics_4", defaultKeys("google_analytics_4")],
      ],
      [["total_reach", SOCIAL], ["total_engagement", SOCIAL]],
    ),
  },
  {
    id: "builtin:ecommerce",
    name: "E-commerce",
    description: "Template com as principais métricas e redes para analisar E-Commerce.",
    layout: L(
      [
        ["meta_ads", ["spend", "purchases", "purchase_value", "roas", "cost_per_purchase", "add_to_cart", "checkouts", "spend_daily", "campaigns"]],
        ["google_ads", ["g_cost", "g_conversions", "g_conversion_value", "g_roas", "g_cost_per_conversion", "g_cost_daily", "g_campaigns"]],
        ["google_analytics_4", ["ga_sessions", "ga_transactions", "ga_revenue", "ga_conversion_rate", "ga_cart_adds", "ga_channels", "ga_sessions_daily", "ga_top_products"]],
        ["instagram_business", ["followers", "reach_total", "interactions_total"]],
      ],
      [["total_spend", ADS], ["total_revenue", ["google_analytics_4"]], ["overall_roas", ["meta_ads", "google_ads"]]],
    ),
  },
  {
    id: "builtin:recebidas",
    name: "Recebidas",
    description: "Modelo de relatório que contém as principais redes e métricas para análise da estratégia de Inbound Marketing.",
    layout: L(
      [
        ["facebook", ["page_followers", "page_reach", "post_engagement", "link_clicks", "top_posts"]],
        ["instagram_business", ["followers", "reach_total", "interactions_total", "profile_visits", "followers_growth", "organic_posts"]],
        ["google_analytics_4", ["ga_sessions", "ga_users", "ga_new_users", "ga_conversions", "ga_conversion_rate", "ga_sessions_daily", "ga_channels", "ga_source_medium", "ga_landing_pages"]],
        ["linkedin", ["li_followers", "li_impressions", "li_clicks", "li_engagement_rate"]],
      ],
      [["total_reach", SOCIAL], ["total_engagement", SOCIAL]],
    ),
  },
  {
    id: "builtin:trafego-pago",
    name: "Tráfego Pago",
    description: "Template com as principais métricas e redes para uma análise de Tráfego Pago.",
    layout: L(
      [
        ["meta_ads", ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "frequency", "leads", "cost_per_lead", "spend_daily", "clicks_daily", "campaigns"]],
        ["google_ads", ["g_cost", "g_impressions", "g_clicks", "g_ctr", "g_cpc", "g_conversions", "g_cost_per_conversion", "g_clicks_daily", "g_campaigns"]],
        ["tiktok_ads", ["t_spend", "t_impressions", "t_clicks", "t_ctr", "t_cpc", "t_conversions", "t_spend_daily"]],
      ],
      [["total_spend", ADS], ["total_leads", ADS], ["total_cost_per_lead", ADS]],
    ),
  },
];

export const findBuiltin = (id: string): BuiltinTemplate | null => REPORTEI_TEMPLATES.find((t) => t.id === id) ?? null;

// ---- the starting templates of "Meus templates" and of the experts (saved to the database once) ----

export interface SeedTemplate {
  name: string;
  description: string;
  layout: TemplateLayout;
}

const LEAD_BASIC = L([["meta_ads", ["spend", "impressions", "clicks", "ctr", "cpc", "leads", "cost_per_lead"]], ["google_ads", ["g_cost", "g_clicks", "g_conversions", "g_cost_per_conversion"]]], [["total_spend", ["meta_ads", "google_ads"]], ["total_leads", ["meta_ads", "google_ads"]], ["total_cost_per_lead", ["meta_ads", "google_ads"]]]);
const LEAD_MEDIUM = L(
  [
    ["meta_ads", ["spend", "impressions", "clicks", "ctr", "cpc", "leads", "cost_per_lead", "leads_daily", "campaigns"]],
    ["google_ads", ["g_cost", "g_clicks", "g_conversions", "g_cost_per_conversion", "g_clicks_daily", "g_campaigns"]],
    ["google_analytics_4", ["ga_sessions", "ga_users", "ga_conversions", "ga_conversion_rate", "ga_channels"]],
  ],
  [["total_spend", ["meta_ads", "google_ads"]], ["total_leads", ["meta_ads", "google_ads"]], ["total_cost_per_lead", ["meta_ads", "google_ads"]]],
);
const LEAD_ADVANCED = L(
  [
    ["meta_ads", ["spend", "reach", "impressions", "frequency", "clicks", "ctr", "cpc", "leads", "cost_per_lead", "spend_daily", "leads_daily", "campaigns"]],
    ["google_ads", ["g_cost", "g_impressions", "g_clicks", "g_ctr", "g_cpc", "g_conversions", "g_cost_per_conversion", "g_clicks_daily", "g_campaigns"]],
    ["tiktok_ads", ["t_spend", "t_clicks", "t_ctr", "t_conversions", "t_cost_per_conversion", "t_spend_daily"]],
    ["google_analytics_4", ["ga_sessions", "ga_users", "ga_new_users", "ga_engagement_rate", "ga_conversions", "ga_conversion_rate", "ga_sessions_daily", "ga_channels", "ga_source_medium", "ga_landing_pages"]],
  ],
  [["total_spend", ADS], ["total_leads", ADS], ["total_cost_per_lead", ADS]],
);

const SHOP_BASIC = L([["meta_ads", ["spend", "purchases", "purchase_value", "roas", "cost_per_purchase"]], ["google_analytics_4", ["ga_sessions", "ga_transactions", "ga_revenue", "ga_conversion_rate"]]], [["total_spend", ["meta_ads"]], ["total_revenue", ["google_analytics_4"]], ["overall_roas", ["meta_ads"]]]);
const SHOP_MEDIUM = L(
  [
    ["meta_ads", ["spend", "purchases", "purchase_value", "roas", "cost_per_purchase", "add_to_cart", "checkouts", "spend_daily"]],
    ["google_ads", ["g_cost", "g_conversions", "g_conversion_value", "g_roas"]],
    ["google_analytics_4", ["ga_sessions", "ga_transactions", "ga_revenue", "ga_conversion_rate", "ga_channels", "ga_top_products"]],
  ],
  [["total_spend", ["meta_ads", "google_ads"]], ["total_revenue", ["google_analytics_4"]], ["overall_roas", ["meta_ads", "google_ads"]]],
);
const SHOP_ADVANCED = L(
  [
    ["meta_ads", ["spend", "purchases", "purchase_value", "roas", "cost_per_purchase", "add_to_cart", "checkouts", "frequency", "spend_daily", "campaigns"]],
    ["google_ads", ["g_cost", "g_conversions", "g_conversion_value", "g_roas", "g_cost_per_conversion", "g_cost_daily", "g_campaigns"]],
    ["tiktok_ads", ["t_spend", "t_conversions", "t_cost_per_conversion", "t_spend_daily"]],
    ["google_analytics_4", ["ga_sessions", "ga_users", "ga_transactions", "ga_revenue", "ga_conversion_rate", "ga_cart_adds", "ga_sessions_daily", "ga_channels", "ga_source_medium", "ga_top_products"]],
    ["instagram_business", ["followers", "reach_total", "interactions_total"]],
  ],
  [["total_spend", ADS], ["total_revenue", ["google_analytics_4"]], ["overall_roas", ["meta_ads", "google_ads"]]],
);

const SOCIAL_BASIC = L([["instagram_business", ["followers", "reach_total", "views_total", "interactions_total", "followers_growth"]], ["facebook", ["page_followers", "page_reach", "post_engagement"]]], [["total_reach", SOCIAL], ["total_engagement", SOCIAL]]);
const SOCIAL_MEDIUM = L(
  [
    ["instagram_business", ["followers", "reach_total", "views_total", "interactions_total", "followers_growth", "reach_daily", "audience", "gender", "organic_posts", "best_day", "best_hour"]],
    ["facebook", ["page_followers", "page_reach", "post_engagement", "page_reach_daily", "top_posts"]],
    ["tiktok", ["tk_followers", "tk_video_views", "tk_likes"]],
  ],
  [["total_reach", SOCIAL], ["total_engagement", SOCIAL]],
);
const SOCIAL_ADVANCED = L(
  [
    ["instagram_business", ["followers", "reach_total", "paid_reach", "views_total", "interactions_total", "profile_visits", "reels_views", "followers_growth", "reach_daily", "audience", "gender", "cities", "organic_posts", "best_day", "best_hour", "stories_count", "stories_views", "stories_reach", "stories"]],
    ["facebook", ["page_followers", "page_reach", "page_views", "post_engagement", "fb_reactions", "page_reach_daily", "fb_audience", "top_posts"]],
    ["tiktok", ["tk_followers", "tk_video_views", "tk_profile_views", "tk_likes", "tk_comments", "tk_shares", "tk_views_daily"]],
    ["youtube", ["yt_subscribers", "yt_views", "yt_watch_hours", "yt_likes", "yt_views_daily", "yt_top_videos"]],
    ["linkedin", ["li_followers", "li_impressions", "li_clicks", "li_engagement_rate", "li_impressions_daily"]],
  ],
  [["total_reach", [...SOCIAL, "tiktok", "youtube"]], ["total_engagement", [...SOCIAL, "tiktok"]]],
);

/** The nine starting templates of "Meus templates": three fronts, three levels each. */
export const MY_TEMPLATE_SEEDS: SeedTemplate[] = [
  { name: "Geração de leads — Básico", description: "O essencial de uma campanha de captação: investimento, cliques, leads e custo por lead no Meta Ads e no Google Ads.", layout: LEAD_BASIC },
  { name: "Geração de leads — Intermediário", description: "Acrescenta a evolução diária de leads, as campanhas e o que acontece no site (sessões, conversões e canais) no Google Analytics.", layout: LEAD_MEDIUM },
  { name: "Geração de leads — Avançado", description: "Visão completa do funil de captação: alcance e frequência, TikTok Ads, origem e páginas de destino que mais convertem.", layout: LEAD_ADVANCED },
  { name: "E-commerce — Básico", description: "O essencial de uma loja: investimento, compras, receita, ROAS e custo por compra, com sessões e conversão do site.", layout: SHOP_BASIC },
  { name: "E-commerce — Intermediário", description: "Acrescenta o Google Ads, o carrinho e a finalização, os canais de venda e os produtos mais vendidos.", layout: SHOP_MEDIUM },
  { name: "E-commerce — Avançado", description: "Visão completa da operação de vendas: campanhas por rede, TikTok Ads, origem das vendas, carrinho e redes sociais.", layout: SHOP_ADVANCED },
  { name: "Social media — Básico", description: "O essencial do orgânico: seguidores, alcance, visualizações e interações no Instagram e no Facebook.", layout: SOCIAL_BASIC },
  { name: "Social media — Intermediário", description: "Acrescenta a audiência, as melhores postagens, o melhor dia e horário para publicar e o TikTok.", layout: SOCIAL_MEDIUM },
  { name: "Social media — Avançado", description: "Visão completa das redes: stories, reels, cidades, YouTube e LinkedIn, além de tudo do intermediário.", layout: SOCIAL_ADVANCED },
];

/** A generic layout that each expert's own template will replace later. */
export const GENERIC_EXPERT_LAYOUT: TemplateLayout = L(
  [
    ["instagram_business", ["followers", "reach_total", "interactions_total", "followers_growth"]],
    ["meta_ads", ["spend", "clicks", "ctr", "cpc", "leads", "cost_per_lead"]],
    ["google_analytics_4", ["ga_sessions", "ga_users", "ga_conversions"]],
  ],
  [["total_reach", SOCIAL], ["total_spend", ["meta_ads"]]],
);

/** Names (as in the CRM) of the people whose expert template is made, with the text of each. */
export const EXPERT_SEEDS: { profileName: string; description: (name: string) => string }[] = [
  {
    profileName: "Matheus Machado",
    description: (n) => `Template do ${n}, da equipe Aureon. Aqui vai o jeito dele de montar o relatório: a ordem das métricas e as análises que ele destaca para o cliente. Por enquanto vem com um modelo genérico de redes sociais, mídia paga e site, para ele personalizar.`,
  },
  {
    profileName: "Bruna Natali",
    description: (n) => `Template da ${n}, da equipe Aureon. Aqui vai o jeito dela de montar o relatório: a ordem das métricas e as análises que ela destaca para o cliente. Por enquanto vem com um modelo genérico de redes sociais, mídia paga e site, para ela personalizar.`,
  },
  {
    profileName: "Mauro Soares",
    description: (n) => `Template do ${n}, da equipe Aureon. Aqui vai o jeito dele de montar o relatório: a ordem das métricas e as análises que ele destaca para o cliente. Por enquanto vem com um modelo genérico de redes sociais, mídia paga e site, para ele personalizar.`,
  },
];

/** Every network a layout can mention, for tests and the picker. */
export const KNOWN_NETWORKS = Object.keys(NETWORK_CATALOG).filter((n) => n !== "custom");
