// What can go into a report block, per network (the "Métricas predefinidas" list of
// Reportei's editor), and the generator of made-up numbers for the model client.
// Until the networks are connected for real, every number made here is fictitious and
// the document says so (`demo: true`). Pure and deterministic: the same seed gives the
// same numbers, so a model report looks the same every time.

import type { Block, Column, IdMaker, ReportDoc, Widget, WidgetKind } from "./doc";

export interface Range {
  since: string;
  until: string;
}

export interface MakeContext {
  id: string;
  range: Range;
  seed: string;
}

export interface CatalogEntry {
  key: string;
  title: string;
  kind: WidgetKind;
  description: string;
  make: (ctx: MakeContext) => Widget;
}

export const NETWORK_LABEL: Record<string, string> = {
  instagram_business: "Instagram Business",
  facebook: "Facebook",
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_ads: "TikTok Ads",
  google_analytics_4: "Google Analytics 4",
  youtube: "YouTube",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

// ---- deterministic numbers --------------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small seeded generator, 0 <= n < 1. */
export function rng(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (r: () => number, lo: number, hi: number) => lo + r() * (hi - lo);
const DAY = 24 * 60 * 60 * 1000;
const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** Every day of a range as dd/mm/yyyy. */
export function daysOf(range: Range): string[] {
  const out: string[] = [];
  for (let t = toDate(range.since).getTime(); t <= toDate(range.until).getTime() && out.length < 400; t += DAY) out.push(dmy(toYmd(new Date(t))));
  return out;
}

const COLORS = { green: "#16a34a", blue: "#1d4ed8", sky: "#38bdf8", orange: "#f97316", purple: "#7c3aed" };

// ---- builders of each kind --------------------------------------------------------------

interface MetricSpec {
  value: [number, number];
  decimals?: number;
  format?: "int" | "percent" | "money";
  upIsGood?: boolean;
  networks?: string[];
  ownPeriod?: boolean;
  /** How far the previous period can be from this one (0.3 = ±30%). */
  swing?: number;
}

function metric(entry: { key: string; title: string; description: string }, spec: MetricSpec): CatalogEntry {
  return {
    ...entry,
    kind: "metric",
    make: ({ id, range, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const decimals = spec.decimals ?? 0;
      const raw = between(r, spec.value[0], spec.value[1]);
      const value = Number(raw.toFixed(decimals));
      const swing = spec.swing ?? 0.3;
      const previous = Number((value * between(r, 1 - swing, 1 + swing)).toFixed(decimals));
      // A period of its own starts a day after the report's, like "02/10/2026 a 31/10/2026".
      const own = spec.ownPeriod ? { since: toYmd(new Date(toDate(range.since).getTime() + DAY)), until: range.until } : null;
      return {
        id, kind: "metric", title: entry.title, description: entry.description, size: "normal", highlight: false, period: own,
        value, previous, decimals, format: spec.format ?? "int", comparison: true, absolute: false, upIsGood: spec.upIsGood ?? true, networks: spec.networks ?? [],
      };
    },
  };
}

function daily(entry: { key: string; title: string; description: string }, kind: "bar" | "line", seriesName: string, spec: { base: number; wave: number; growth?: number }): CatalogEntry {
  return {
    ...entry,
    kind,
    make: ({ id, range, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const labels = daysOf(range);
      const points = labels.map((label, i) => {
        const trend = (spec.growth ?? 0) * i;
        // Spiky days for lines (a post that went around), a gentle climb for bars.
        const spike = kind === "line" && r() > 0.85 ? between(r, 1.5, 3) : 1;
        return { label, value: Math.max(0, Math.round((spec.base + trend + between(r, -spec.wave, spec.wave)) * spike)) };
      });
      return { id, kind, title: entry.title, description: entry.description, size: "normal", highlight: false, period: null, seriesName, points };
    },
  };
}

function weekdays(entry: { key: string; title: string; description: string }): CatalogEntry {
  return {
    ...entry,
    kind: "bar",
    make: ({ id, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const base = between(r, 1200, 2000);
      return {
        id, kind: "bar", title: entry.title, description: entry.description, size: "normal", highlight: false, period: null, seriesName: "Seguidores Online",
        points: ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((label) => ({ label, value: Math.round(base * between(r, 0.75, 1)) })),
      };
    },
  };
}

function hours(entry: { key: string; title: string; description: string }): CatalogEntry {
  return {
    ...entry,
    kind: "bar",
    make: ({ id, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const peak = between(r, 1400, 2000);
      return {
        id, kind: "bar", title: entry.title, description: entry.description, size: "normal", highlight: false, period: null, seriesName: "Seguidores Online",
        // Quiet at night, busiest in the afternoon.
        points: Array.from({ length: 12 }, (_, i) => {
          const h = i * 2;
          const shape = Math.max(0.03, Math.sin(((h - 4) / 20) * Math.PI));
          return { label: `${h}h`, value: Math.round(peak * shape * between(r, 0.9, 1)) };
        }),
      };
    },
  };
}

const AGES = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];

function audience(entry: { key: string; title: string; description: string }): CatalogEntry {
  return {
    ...entry,
    kind: "groupedBar",
    make: ({ id, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const weight = [0.01, 0.08, 0.38, 0.36, 0.13, 0.05, 0.02];
      const col = (scale: number) => weight.map((w) => Math.round(w * scale * between(r, 0.8, 1.2)));
      return {
        id, kind: "groupedBar", title: entry.title, description: entry.description, size: "normal", highlight: false, period: null, categories: AGES,
        series: [
          { name: "Masculino", color: COLORS.green, values: col(1100) },
          { name: "Feminino", color: COLORS.blue, values: col(2300) },
          { name: "Desconhecido", color: COLORS.sky, values: col(1200) },
        ],
      };
    },
  };
}

function gender(entry: { key: string; title: string; description: string }): CatalogEntry {
  return {
    ...entry,
    kind: "pie",
    make: ({ id, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const male = Math.round(between(r, 25, 45) * 100) / 100;
      return {
        id, kind: "pie", title: entry.title, description: entry.description, size: "normal", highlight: false, period: null,
        slices: [{ label: "Masculino", value: male, color: COLORS.green }, { label: "Feminino", value: Math.round((100 - male) * 100) / 100, color: COLORS.blue }],
      };
    },
  };
}

const CITY_LIST = ["São Paulo, São Paulo (estado)", "Santo André, São Paulo (state)", "Rio de Janeiro, Rio de Janeiro (estado)", "Guarulhos, São Paulo (state)", "Campinas, São Paulo (state)", "Osasco, São Paulo (state)", "Curitiba, Paraná (state)", "Belo Horizonte, Minas Gerais (state)"];

function cities(entry: { key: string; title: string; description: string }): CatalogEntry {
  const columns: Column[] = [{ key: "city", label: "Cidade", align: "left" }, { key: "followers", label: "Seguidores", align: "right" }];
  return {
    ...entry,
    kind: "table",
    make: ({ id, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const top = Math.round(between(r, 900, 1600));
      const rows = CITY_LIST.slice(0, 6).map((city, i) => ({ city, followers: Math.max(20, Math.round((i === 0 ? top : top * Math.pow(0.45, i) * 0.3) * between(r, 0.8, 1.1))) }));
      return { id, kind: "table", title: entry.title, description: entry.description, size: "normal", highlight: false, period: null, columns, rows, sortKey: "followers" };
    },
  };
}

const POST_TEXTS = [
  "Uma mudança envolve muito mais do que transportar móveis d…",
  "Outubro chegou, trazendo novas oportunidades, novos planos e…",
  "A proteção dos móveis é uma etapa importante para reduzi…",
  "Dicas para organizar a sua mudança sem estresse e com…",
];

function posts(entry: { key: string; title: string; description: string }): CatalogEntry {
  const columns: Column[] = [
    { key: "type", label: "Tipo", align: "left" }, { key: "views", label: "Visualizações", align: "right" }, { key: "reach", label: "Alcance", align: "right" },
    { key: "interactions", label: "Interações", align: "right" }, { key: "rate", label: "Taxa de Interação", align: "right" }, { key: "likes", label: "Curtidas", align: "right" },
    { key: "comments", label: "Comentários", align: "right" }, { key: "saved", label: "Salvo", align: "right" }, { key: "shares", label: "Compartilhamentos", align: "right" },
  ];
  return {
    ...entry,
    kind: "posts",
    make: ({ id, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const types = ["Imagem", "Imagem", "Carrossel", "Reels"];
      const rows = POST_TEXTS.slice(0, 3).map((text, i) => {
        const reach = Math.round(between(r, 70, 200));
        const views = Math.round(reach * between(r, 1.4, 1.8));
        const interactions = Math.round(reach * between(r, 0.06, 0.12));
        const likes = Math.round(interactions * 0.7);
        return {
          hue: 100 + i * 40, text,
          values: {
            type: types[i], views, reach, interactions, rate: `${(Math.round((interactions / reach) * 10000) / 100).toLocaleString("pt-BR")}%`, likes,
            comments: Math.round(between(r, 0, 3)), saved: Math.round(between(r, 0, 2)), shares: Math.round(between(r, 0, 2)),
          },
        };
      });
      return { id, kind: "posts", title: entry.title, description: entry.description, size: "normal", highlight: false, period: null, columns, rows, sortKey: "reach" };
    },
  };
}

function stories(entry: { key: string; title: string; description: string }): CatalogEntry {
  return {
    ...entry,
    kind: "stories",
    make: ({ id, range, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const days = daysOf(range);
      const items = Array.from({ length: 6 }, (_, i) => {
        const views = Math.round(between(r, 18, 40));
        const reach = Math.max(1, views - Math.round(between(r, 2, 6)));
        return {
          hue: 110 + i * 25,
          date: days[Math.min(days.length - 1, Math.floor((i * days.length) / 6))] ?? "",
          stats: [
            { label: "Visualizações", value: views }, { label: "Alcance", value: reach }, { label: "Interações", value: Math.round(between(r, 0, 2)) },
            { label: "Visitas ao Perfil", value: Math.round(between(r, 0, 2)) }, { label: "Respostas", value: 0 }, { label: "Compartilhamentos", value: 0 },
            { label: "Retenção", value: `${Math.round(between(r, 55, 90))}%` }, { label: "Avançar", value: Math.round(views * 0.65) }, { label: "Próximo Story", value: Math.round(between(r, 0, 6)) },
            { label: "Voltar", value: Math.round(between(r, 0, 2)) }, { label: "Sair", value: Math.round(between(r, 1, 6)) },
          ],
        };
      });
      return { id, kind: "stories", title: entry.title, description: entry.description, size: "normal", highlight: false, period: null, items };
    },
  };
}

// ---- generic builders for tables and pies ------------------------------------------------

type Meta = { key: string; title: string; description: string };
const PALETTE = ["#16a34a", "#1d4ed8", "#38bdf8", "#f97316", "#7c3aed", "#e11d48", "#0d9488", "#ca8a04"];

function tableOf(entry: Meta, columns: Column[], row: (r: () => number, i: number) => Record<string, string | number>, count: number, sortKey: string | null): CatalogEntry {
  return {
    ...entry,
    kind: "table",
    make: ({ id, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const rows = Array.from({ length: count }, (_, i) => row(r, i));
      return { id, kind: "table", title: entry.title, description: entry.description, size: "normal", highlight: false, period: null, columns, rows, sortKey };
    },
  };
}

function pieOf(entry: Meta, labels: string[]): CatalogEntry {
  return {
    ...entry,
    kind: "pie",
    make: ({ id, seed }) => {
      const r = rng(`${seed}:${entry.key}`);
      const raw = labels.map(() => between(r, 0.3, 1.5));
      const total = raw.reduce((s, x) => s + x, 0);
      return {
        id, kind: "pie", title: entry.title, description: entry.description, size: "normal", highlight: false, period: null,
        slices: labels.map((label, i) => ({ label, value: Math.round((raw[i] / total) * 10000) / 100, color: PALETTE[i % PALETTE.length] })),
      };
    },
  };
}

const left = (key: string, label: string): Column => ({ key, label, align: "left" });
const right = (key: string, label: string): Column => ({ key, label, align: "right" });
export const CAMPAIGNS = ["Black Friday", "Institucional", "Remarketing", "Lançamento", "Captação de leads", "Conversão — fundo de funil", "Topo de funil", "Promoção de Natal"];
const PAGES = ["/", "/contato", "/servicos", "/orcamento", "/blog/como-organizar-uma-mudanca", "/sobre"];
const SOURCES = ["google / organic", "facebook / paid", "(direct) / (none)", "instagram / social", "google / cpc", "email / newsletter"];
const PRODUCTS = ["Caixa organizadora G", "Kit de embalagem", "Fita adesiva reforçada", "Plástico bolha 50m", "Cobertor de proteção", "Caixa para livros"];
const VIDEOS = ["Como funciona a vistoria", "5 dicas para sua mudança", "Bastidores da equipe", "Cliente conta sua experiência", "Como embalar móveis"];

// ---- the catalogs -----------------------------------------------------------------------

const IG = (key: string, title: string, description: string) => ({ key, title, description });
const INSTAGRAM: CatalogEntry[] = [
  metric(IG("followers", "Número de seguidores", "Número total de seguidores da sua conta. O Instagram só repassa os dados de seguidores para períodos em que a integração esteve ativa."), { value: [4800, 5300], swing: 0.03 }),
  metric(IG("paid_reach", "Alcance Pago dos últimos 30 dias", "Contas únicas alcançadas por anúncios nos últimos 30 dias."), { value: [8000, 17000], ownPeriod: true, swing: 0.6 }),
  metric(IG("views_total", "Visualizações totais (orgânicas + pagas)", "Total de visualizações do conteúdo, orgânicas e pagas."), { value: [20000, 30000] }),
  metric(IG("reach_total", "Alcance total (orgânico + pago) dos últimos 30 dias", "Contas únicas alcançadas, orgânico e pago, nos últimos 30 dias."), { value: [9000, 17000], ownPeriod: true, swing: 0.5 }),
  metric(IG("likes_posts", "Curtidas em postagens", "Total de curtidas nas postagens do período."), { value: [15, 40], swing: 0.5 }),
  metric(IG("reach_posts", "Alcance das postagens dos últimos 30 dias", "Contas únicas alcançadas pelas postagens."), { value: [150, 300], ownPeriod: true, swing: 0.2 }),
  metric(IG("stories_count", "Número de stories", "Quantidade de stories publicados no período."), { value: [5, 20], swing: 0.7 }),
  metric(IG("stories_views", "Visualizações Totais dos Stories", "Total de visualizações dos stories."), { value: [150, 6000], swing: 0.9 }),
  metric(IG("stories_reach", "Alcance dos stories dos últimos 30 dias", "Contas únicas alcançadas pelos stories."), { value: [120, 4500], ownPeriod: true, swing: 0.9 }),
  metric(IG("profile_visits", "Visitas do perfil", "Quantas vezes o seu perfil foi visitado."), { value: [200, 600] }),
  metric(IG("comments", "Comentários", "Total de comentários recebidos."), { value: [5, 40], swing: 0.6 }),
  metric(IG("shares", "Compartilhamentos", "Total de compartilhamentos do conteúdo."), { value: [8, 60], swing: 0.6 }),
  metric(IG("saves", "Salvamentos", "Total de vezes que o conteúdo foi salvo."), { value: [3, 30], swing: 0.6 }),
  metric(IG("interactions_total", "Interações totais", "Soma de curtidas, comentários, compartilhamentos e salvamentos."), { value: [80, 400] }),
  metric(IG("reels_views", "Total de visualizações dos Reels", "Visualizações dos Reels publicados no período."), { value: [800, 9000], swing: 0.5 }),
  metric(IG("reels_count", "Número de Reels", "Quantidade de Reels publicados no período."), { value: [2, 14], swing: 0.5 }),
  daily(IG("followers_growth", "Crescimento de seguidores", "Evolução diária do número de seguidores."), "bar", "Seguidores", { base: 5070, wave: 8, growth: 1.7 }),
  daily(IG("reach_daily", "Alcance diário", "Contas únicas alcançadas por dia."), "line", "Alcance", { base: 500, wave: 450 }),
  audience(IG("audience", "Audiência por idade e gênero", "Distribuição dos seus seguidores por faixa etária e gênero.")),
  gender(IG("gender", "Seguidores por gênero", "Percentual dos seguidores por gênero.")),
  cities(IG("cities", "Cidades com o maior número de seguidores", "As cidades onde estão mais dos seus seguidores.")),
  posts(IG("organic_posts", "Dados orgânicos de postagens", "Desempenho das postagens do período, sem anúncios.")),
  weekdays(IG("best_day", "Melhor dia para postagens", "Dias da semana em que mais seguidores estão online.")),
  hours(IG("best_hour", "Melhor horário para postagens", "Horários em que mais seguidores estão online.")),
  stories(IG("stories", "Stories", "Desempenho de cada story do período.")),
];

const FB = (key: string, title: string, description: string) => ({ key, title, description });
const FACEBOOK: CatalogEntry[] = [
  metric(FB("page_followers", "Seguidores da página", "Número de pessoas que seguem a página."), { value: [2800, 3400], swing: 0.03 }),
  metric(FB("page_likes", "Curtidas da página", "Total de curtidas da página."), { value: [2600, 3200], swing: 0.03 }),
  metric(FB("page_reach", "Alcance da página", "Pessoas únicas que viram qualquer conteúdo da página."), { value: [14000, 28000], swing: 0.4 }),
  metric(FB("page_views", "Visualizações da página", "Total de visualizações do conteúdo da página."), { value: [20000, 45000], swing: 0.4 }),
  metric(FB("post_engagement", "Engajamento das postagens", "Reações, comentários e compartilhamentos das postagens."), { value: [60, 300], swing: 0.5 }),
  metric(FB("link_clicks", "Cliques em links", "Cliques em links publicados pela página."), { value: [20, 220], swing: 0.5 }),
  metric(FB("page_posts", "Número de postagens", "Postagens publicadas pela página no período."), { value: [6, 30], swing: 0.5 }),
  metric(FB("fb_reactions", "Reações nas postagens", "Curtidas e outras reações recebidas nas postagens."), { value: [40, 220], swing: 0.5 }),
  daily(FB("page_reach_daily", "Alcance diário da página", "Pessoas alcançadas por dia."), "line", "Alcance", { base: 600, wave: 500 }),
  daily(FB("followers_growth_fb", "Crescimento de seguidores", "Evolução diária de seguidores da página."), "bar", "Seguidores", { base: 3100, wave: 6, growth: 1.2 }),
  audience(FB("fb_audience", "Audiência por idade e gênero", "Distribuição dos seguidores da página por faixa etária e gênero.")),
  posts(FB("top_posts", "Postagens com mais alcance", "As postagens que mais alcançaram pessoas no período.")),
];

const AD = (key: string, title: string, description: string) => ({ key, title, description });
const META_ADS: CatalogEntry[] = [
  metric(AD("spend", "Valor gasto", "Quanto foi investido em anúncios no período."), { value: [1500, 6000], decimals: 2, format: "money", swing: 0.4 }),
  metric(AD("impressions", "Impressões", "Quantas vezes os anúncios foram exibidos."), { value: [60000, 250000], swing: 0.4 }),
  metric(AD("reach", "Alcance", "Pessoas únicas que viram os anúncios."), { value: [20000, 90000], swing: 0.4 }),
  metric(AD("clicks", "Cliques", "Cliques nos anúncios."), { value: [800, 4000], swing: 0.4 }),
  metric(AD("ctr", "CTR", "Cliques divididos por impressões."), { value: [0.8, 2.4], decimals: 2, format: "percent", swing: 0.3 }),
  metric(AD("cpc", "CPC", "Custo médio por clique."), { value: [0.6, 2.2], decimals: 2, format: "money", upIsGood: false, swing: 0.3 }),
  metric(AD("frequency", "Frequência", "Quantas vezes, em média, cada pessoa viu os anúncios."), { value: [1.4, 3.2], decimals: 2, upIsGood: false, swing: 0.2 }),
  metric(AD("leads", "Leads", "Contatos gerados pelos anúncios."), { value: [20, 160], swing: 0.5 }),
  metric(AD("conversations", "Conversas por mensagem iniciadas", "Conversas iniciadas atribuídas aos anúncios pela Meta. Não representa quantidade de mensagens nem pessoas únicas."), { value: [20, 160], swing: 0.5 }),
  metric(AD("cost_per_conversation", "Custo por conversa", "Investimento dividido pelas conversas por mensagem iniciadas."), { value: [12, 60], decimals: 2, format: "money", upIsGood: false, swing: 0.4 }),
  metric(AD("cost_per_lead", "Custo por lead", "Valor gasto dividido pelos leads."), { value: [12, 60], decimals: 2, format: "money", upIsGood: false, swing: 0.4 }),
  metric(AD("purchases", "Compras", "Compras atribuídas aos anúncios."), { value: [30, 260], swing: 0.5 }),
  metric(AD("purchase_value", "Valor de conversão das compras", "Receita das compras atribuídas aos anúncios."), { value: [6000, 42000], decimals: 2, format: "money", swing: 0.5 }),
  metric(AD("roas", "ROAS", "Retorno sobre o investimento em anúncios: receita dividida pelo gasto."), { value: [2.4, 7.5], decimals: 2, swing: 0.3 }),
  metric(AD("cost_per_purchase", "Custo por compra", "Valor gasto dividido pelas compras."), { value: [18, 70], decimals: 2, format: "money", upIsGood: false, swing: 0.4 }),
  metric(AD("add_to_cart", "Adições ao carrinho", "Vezes que um produto foi colocado no carrinho."), { value: [120, 900], swing: 0.5 }),
  metric(AD("checkouts", "Finalizações iniciadas", "Pessoas que iniciaram a finalização da compra."), { value: [60, 420], swing: 0.5 }),
  daily(AD("spend_daily", "Gasto diário", "Quanto foi gasto em cada dia."), "line", "Gasto", { base: 120, wave: 60 }),
  daily(AD("clicks_daily", "Cliques por dia", "Cliques em cada dia."), "bar", "Cliques", { base: 90, wave: 40 }),
  daily(AD("leads_daily", "Leads por dia", "Leads gerados em cada dia."), "bar", "Leads", { base: 5, wave: 4 }),
  tableOf(AD("ads", "Anúncios em Destaque", "Criativos e resultados dos anúncios com veiculação no período. Leads seguem o evento configurado no cliente."), [left("ad", "Anúncio"), right("spend", "Valor investido"), right("leads", "Leads (cliente)")],
    (r, i) => ({ ad: "Anúncio de demonstração " + (i + 1), spend: Math.round(between(r, 150, 1800)), leads: Math.round(between(r, 3, 60)) }), 3, "spend"),
  tableOf(AD("campaigns", "Campanhas", "Desempenho de cada campanha no período."), [left("campaign", "Campanha"), right("spend", "Gasto (R$)"), right("impressions", "Impressões"), right("clicks", "Cliques"), right("results", "Resultados")],
    (r, i) => ({ campaign: CAMPAIGNS[i], spend: Math.round(between(r, 150, 1800)), impressions: Math.round(between(r, 6000, 60000)), clicks: Math.round(between(r, 80, 900)), results: Math.round(between(r, 3, 60)) }), 5, "spend"),
];

const GA = (key: string, title: string, description: string) => ({ key, title, description });
const GOOGLE_ADS: CatalogEntry[] = [
  metric(GA("g_clicks", "Cliques", "Cliques nos anúncios do Google."), { value: [600, 3500], swing: 0.4 }),
  metric(GA("g_impressions", "Impressões", "Exibições dos anúncios do Google."), { value: [20000, 120000], swing: 0.4 }),
  metric(GA("g_ctr", "CTR", "Cliques divididos por impressões."), { value: [2, 7], decimals: 2, format: "percent", swing: 0.3 }),
  metric(GA("g_cost", "Custo", "Valor investido em anúncios do Google."), { value: [1200, 5000], decimals: 2, format: "money", swing: 0.4 }),
  metric(GA("g_cpc", "CPC médio", "Custo médio por clique."), { value: [0.8, 3], decimals: 2, format: "money", upIsGood: false, swing: 0.3 }),
  metric(GA("g_conversions", "Conversões", "Ações valiosas realizadas depois do clique."), { value: [10, 120], swing: 0.5 }),
  metric(GA("g_cost_per_conversion", "Custo por conversão", "Custo dividido pelas conversões."), { value: [14, 80], decimals: 2, format: "money", upIsGood: false, swing: 0.4 }),
  metric(GA("g_conversion_value", "Valor de conversão", "Receita atribuída às conversões."), { value: [4000, 30000], decimals: 2, format: "money", swing: 0.5 }),
  metric(GA("g_roas", "ROAS", "Valor de conversão dividido pelo custo."), { value: [2, 6.5], decimals: 2, swing: 0.3 }),
  metric(GA("g_cpm", "CPM médio", "Custo médio por mil impressões."), { value: [20, 90], decimals: 2, format: "money", upIsGood: false, swing: 0.3 }),
  metric(GA("g_conversion_rate", "Taxa de conversão", "Conversões divididas pelos cliques."), { value: [0.4, 3], decimals: 2, format: "percent", swing: 0.4 }),
  metric(GA("g_all_conversions", "Todas as conversões", "Todas as ações de conversão, inclusive as de visualização."), { value: [12, 140], swing: 0.5 }),
  metric(GA("g_all_conversion_value", "Valor de todas as conversões", "Receita atribuída a todas as conversões."), { value: [4000, 32000], decimals: 2, format: "money", swing: 0.5 }),
  daily(GA("g_clicks_over_time", "Cliques durante o tempo", "Cliques em cada dia do período."), "line", "Cliques", { base: 160, wave: 80 }),
  daily(GA("g_conversions_over_time", "Conversões durante o tempo", "Conversões em cada dia do período."), "line", "Conversões", { base: 5, wave: 4 }),
  daily(GA("g_cost_over_time", "Custo durante o tempo", "Custo em cada dia do período."), "line", "Custo", { base: 100, wave: 40 }),
  pieOf(GA("g_cost_by_device", "Custo por dispositivo", "Quanto foi investido em cada tipo de dispositivo."), ["DESKTOP", "MOBILE", "TABLET", "CONNECTED_TV"]),
  pieOf(GA("g_conversions_by_device", "Conversões por dispositivo", "Conversões em cada tipo de dispositivo."), ["DESKTOP", "MOBILE", "TABLET", "CONNECTED_TV"]),
  pieOf(GA("g_clicks_by_device", "Cliques por dispositivo", "Cliques em cada tipo de dispositivo."), ["DESKTOP", "MOBILE", "TABLET", "CONNECTED_TV"]),
  tableOf(GA("g_all_campaigns", "Todas as Campanhas", "Desempenho de cada campanha do Google Ads."), [left("campaign", "Campanhas"), right("cost", "Custo (R$)"), right("impressions", "Impressões"), right("clicks", "Cliques"), right("ctr", "CTR (Taxa de Cliques)"), right("cpc", "CPC médio (R$)"), right("conversions", "Conversões"), right("cpa", "Custo por conversão (R$)")],
    (r, i) => ({ campaign: CAMPAIGNS[(i + 3) % CAMPAIGNS.length], cost: Math.round(between(r, 200, 3000)), impressions: Math.round(between(r, 1500, 56000)), clicks: Math.round(between(r, 200, 4800)), ctr: Math.round(between(r, 3, 12) * 100) / 100, cpc: Math.round(between(r, 0.1, 12) * 100) / 100, conversions: Math.round(between(r, 20, 80)), cpa: Math.round(between(r, 4, 40) * 100) / 100 }), 2, "clicks"),
  tableOf(GA("g_pmax_assets", "Desempenho por Recurso PMAX", "Desempenho dos recursos das campanhas Performance Max."), [left("asset", "Recurso"), left("group", "Grupo de Recursos"), right("type", "Tipo de Recurso"), right("value_per_conversion", "Valor Por Conversão"), right("conversions", "Conversões"), right("conversion_value", "Valor das conversões (R$)")],
    (r, i) => ({ asset: ["LEARN_MORE", "Somos a Amexlog!", "Mudança Sem Dor de Cabeça", "Transportadora", "Mudanças Residencial Segura"][i % 5], group: "Grupo de recursos 1", type: ["CALL_TO_ACTION_SELECTION", "YOUTUBE_VIDEO", "HEADLINE", "HEADLINE", "HEADLINE"][i % 5], value_per_conversion: Math.round(between(r, 0, 0.1) * 100) / 100, conversions: Math.round(between(r, 10, 57)), conversion_value: Math.round(between(r, 0, 2) * 100) / 100 }), 5, "conversions"),
  tableOf(GA("g_ad_groups", "Resumo dos Grupos de Anúncio", "Desempenho de cada grupo de anúncios."), [left("group", "Grupo de Anúncios"), right("clicks", "Cliques"), right("cost", "Custo (R$)"), right("impressions", "Impressões"), right("conversions", "Conversões"), right("top_position", "% de Anúncios na 1ª posição"), right("cpa", "Custo por conversão (R$)")],
    (r, i) => ({ group: ["Mudanças", "Fretes", "Guarda-móveis"][i % 3], clicks: Math.round(between(r, 120, 400)), cost: Math.round(between(r, 900, 3200)), impressions: Math.round(between(r, 1200, 5000)), conversions: Math.round(between(r, 30, 90)), top_position: Math.round(between(r, 20, 45) * 100) / 100, cpa: Math.round(between(r, 20, 60) * 100) / 100 }), 1, "clicks"),
  tableOf(GA("g_keywords", "Resumo das Palavras-Chave de Pesquisa", "Desempenho de cada palavra-chave."), [left("keyword", "Palavra-chave"), right("clicks", "Cliques"), right("cost", "Custo (R$)"), right("impressions", "Impressões"), right("conversions", "Conversões"), right("top_position", "% de Anúncios na 1ª posição"), right("cpa", "Custo por conversão (R$)"), right("cpc", "CPC médio (R$)")],
    (r, i) => ({ keyword: ["[empresa de mudança completa]", "[mudança residencial]", "[transportadora de mudanças]", "[frete para mudança]", "[mudança segura]"][i % 5], clicks: Math.round(between(r, 20, 90)), cost: Math.round(between(r, 300, 1300)), impressions: Math.round(between(r, 150, 600)), conversions: Math.round(between(r, 6, 28)), top_position: Math.round(between(r, 20, 40) * 100) / 100, cpa: Math.round(between(r, 25, 60) * 100) / 100, cpc: Math.round(between(r, 8, 16) * 100) / 100 }), 5, "clicks"),
  daily(GA("g_clicks_daily", "Cliques por dia", "Cliques em cada dia."), "line", "Cliques", { base: 70, wave: 35 }),
  daily(GA("g_cost_daily", "Custo por dia", "Quanto foi investido em cada dia."), "bar", "Custo", { base: 100, wave: 45 }),
  tableOf(GA("g_campaigns", "Campanhas", "Desempenho de cada campanha do Google Ads."), [left("campaign", "Campanha"), right("cost", "Custo (R$)"), right("clicks", "Cliques"), right("conversions", "Conversões")],
    (r, i) => ({ campaign: CAMPAIGNS[(i + 2) % CAMPAIGNS.length], cost: Math.round(between(r, 120, 1500)), clicks: Math.round(between(r, 60, 700)), conversions: Math.round(between(r, 2, 40)) }), 5, "cost"),
];

const TT = (key: string, title: string, description: string) => ({ key, title, description });
const TIKTOK_ADS: CatalogEntry[] = [
  metric(TT("t_spend", "Valor gasto", "Quanto foi investido no TikTok Ads."), { value: [800, 3500], decimals: 2, format: "money", swing: 0.4 }),
  metric(TT("t_impressions", "Impressões", "Exibições dos anúncios."), { value: [40000, 220000], swing: 0.4 }),
  metric(TT("t_clicks", "Cliques", "Cliques nos anúncios."), { value: [500, 3200], swing: 0.4 }),
  metric(TT("t_ctr", "CTR", "Cliques divididos por impressões."), { value: [0.6, 2], decimals: 2, format: "percent", swing: 0.3 }),
  metric(TT("t_cpc", "CPC", "Custo médio por clique."), { value: [0.4, 1.8], decimals: 2, format: "money", upIsGood: false, swing: 0.3 }),
  metric(TT("t_conversions", "Conversões", "Ações valiosas depois do clique."), { value: [10, 110], swing: 0.5 }),
  metric(TT("t_cost_per_conversion", "Custo por conversão", "Valor gasto dividido pelas conversões."), { value: [10, 60], decimals: 2, format: "money", upIsGood: false, swing: 0.4 }),
  metric(TT("t_video_views", "Visualizações de vídeo", "Vezes que os vídeos dos anúncios foram vistos."), { value: [20000, 150000], swing: 0.4 }),
  daily(TT("t_spend_daily", "Gasto diário", "Quanto foi gasto em cada dia."), "line", "Gasto", { base: 70, wave: 35 }),
];

const GAN = (key: string, title: string, description: string) => ({ key, title, description });
const ANALYTICS: CatalogEntry[] = [
  metric(GAN("ga_sessions", "Sessões", "Visitas ao site no período."), { value: [2500, 9000], swing: 0.35 }),
  metric(GAN("ga_users", "Usuários", "Pessoas únicas que visitaram o site."), { value: [1800, 6500], swing: 0.35 }),
  metric(GAN("ga_new_users", "Novos usuários", "Pessoas que visitaram o site pela primeira vez."), { value: [1400, 5200], swing: 0.35 }),
  metric(GAN("ga_engagement_rate", "Taxa de engajamento", "Percentual de sessões engajadas."), { value: [48, 72], decimals: 2, format: "percent", swing: 0.12 }),
  metric(GAN("ga_conversions", "Conversões", "Eventos-chave concluídos no site."), { value: [40, 380], swing: 0.5 }),
  metric(GAN("ga_conversion_rate", "Taxa de conversão", "Conversões divididas pelas sessões."), { value: [1.2, 4.8], decimals: 2, format: "percent", swing: 0.3 }),
  metric(GAN("ga_transactions", "Transações", "Compras concluídas no site."), { value: [25, 240], swing: 0.5 }),
  metric(GAN("ga_revenue", "Receita", "Receita das compras no site."), { value: [5000, 48000], decimals: 2, format: "money", swing: 0.5 }),
  metric(GAN("ga_cart_adds", "Adições ao carrinho", "Vezes que um produto foi colocado no carrinho."), { value: [150, 1100], swing: 0.5 }),
  daily(GAN("ga_sessions_daily", "Sessões por dia", "Visitas ao site em cada dia."), "line", "Sessões", { base: 140, wave: 70 }),
  pieOf(GAN("ga_channels", "Sessões por canal", "De onde vêm as visitas: orgânico, pago, direto, social e e-mail."), ["Busca orgânica", "Busca paga", "Direto", "Social", "E-mail"]),
  tableOf(GAN("ga_source_medium", "Origem / mídia", "As origens que mais trazem visitas."), [left("source", "Origem / mídia"), right("sessions", "Sessões"), right("conversions", "Conversões")],
    (r, i) => ({ source: SOURCES[i], sessions: Math.round(between(r, 150, 2600)), conversions: Math.round(between(r, 2, 90)) }), 6, "sessions"),
  tableOf(GAN("ga_landing_pages", "Páginas de destino", "As páginas onde as visitas começam."), [left("page", "Página"), right("sessions", "Sessões"), right("conversions", "Conversões")],
    (r, i) => ({ page: PAGES[i], sessions: Math.round(between(r, 100, 2200)), conversions: Math.round(between(r, 1, 80)) }), 6, "sessions"),
  tableOf(GAN("ga_top_products", "Produtos mais vendidos", "Os produtos que mais venderam no período."), [left("product", "Produto"), right("quantity", "Quantidade"), right("revenue", "Receita (R$)")],
    (r, i) => ({ product: PRODUCTS[i], quantity: Math.round(between(r, 10, 160)), revenue: Math.round(between(r, 400, 7500)) }), 6, "revenue"),
];

const YT = (key: string, title: string, description: string) => ({ key, title, description });
const YOUTUBE: CatalogEntry[] = [
  metric(YT("yt_subscribers", "Inscritos", "Número de inscritos no canal."), { value: [900, 2600], swing: 0.05 }),
  metric(YT("yt_views", "Visualizações", "Vezes que os vídeos foram vistos."), { value: [3000, 26000], swing: 0.4 }),
  metric(YT("yt_watch_hours", "Horas assistidas", "Tempo total assistido, em horas."), { value: [120, 900], swing: 0.4 }),
  metric(YT("yt_likes", "Curtidas", "Curtidas recebidas nos vídeos."), { value: [60, 700], swing: 0.5 }),
  metric(YT("yt_comments", "Comentários", "Comentários recebidos nos vídeos."), { value: [8, 120], swing: 0.5 }),
  daily(YT("yt_views_daily", "Visualizações por dia", "Visualizações em cada dia."), "line", "Visualizações", { base: 300, wave: 160 }),
  tableOf(YT("yt_top_videos", "Vídeos com mais visualizações", "Os vídeos mais vistos do período."), [left("video", "Vídeo"), right("views", "Visualizações"), right("likes", "Curtidas"), right("minutes", "Minutos assistidos")],
    (r, i) => ({ video: VIDEOS[i], views: Math.round(between(r, 200, 5000)), likes: Math.round(between(r, 5, 160)), minutes: Math.round(between(r, 400, 9000)) }), 5, "views"),
];

const TK = (key: string, title: string, description: string) => ({ key, title, description });
const TIKTOK: CatalogEntry[] = [
  metric(TK("tk_followers", "Seguidores", "Número de seguidores do perfil."), { value: [1200, 6400], swing: 0.05 }),
  metric(TK("tk_video_views", "Visualizações de vídeo", "Vezes que os vídeos foram vistos."), { value: [8000, 90000], swing: 0.5 }),
  metric(TK("tk_profile_views", "Visualizações do perfil", "Vezes que o perfil foi visitado."), { value: [300, 3200], swing: 0.5 }),
  metric(TK("tk_likes", "Curtidas", "Curtidas recebidas nos vídeos."), { value: [400, 7200], swing: 0.5 }),
  metric(TK("tk_comments", "Comentários", "Comentários recebidos nos vídeos."), { value: [20, 380], swing: 0.5 }),
  metric(TK("tk_shares", "Compartilhamentos", "Compartilhamentos dos vídeos."), { value: [15, 320], swing: 0.5 }),
  daily(TK("tk_views_daily", "Visualizações por dia", "Visualizações em cada dia."), "line", "Visualizações", { base: 900, wave: 700 }),
];

const LI = (key: string, title: string, description: string) => ({ key, title, description });
const LINKEDIN: CatalogEntry[] = [
  metric(LI("li_followers", "Seguidores", "Número de seguidores da página."), { value: [700, 2400], swing: 0.04 }),
  metric(LI("li_impressions", "Impressões", "Vezes que o conteúdo foi exibido."), { value: [2500, 24000], swing: 0.4 }),
  metric(LI("li_clicks", "Cliques", "Cliques no conteúdo da página."), { value: [60, 700], swing: 0.5 }),
  metric(LI("li_engagement_rate", "Taxa de engajamento", "Interações divididas pelas impressões."), { value: [1.5, 6], decimals: 2, format: "percent", swing: 0.3 }),
  metric(LI("li_reactions", "Reações", "Reações recebidas nas publicações."), { value: [30, 420], swing: 0.5 }),
  daily(LI("li_impressions_daily", "Impressões por dia", "Impressões em cada dia."), "line", "Impressões", { base: 450, wave: 300 }),
];

const CU = (key: string, title: string, description: string) => ({ key, title, description });
/** Totals of the "Bloco Personalizado", gathering several networks. */
const CUSTOM: CatalogEntry[] = [
  metric(CU("total_reach", "Alcance total das contas", "Soma do alcance das contas conectadas do cliente."), { value: [30000, 60000], swing: 0.25 }),
  metric(CU("total_engagement", "Engajamento das postagens", "Soma de reações, comentários e compartilhamentos das postagens."), { value: [900, 2400], swing: 0.3 }),
  metric(CU("total_spend", "Investimento total em mídia", "Soma do que foi investido em todas as redes de anúncios."), { value: [3000, 14000], decimals: 2, format: "money", swing: 0.35 }),
  metric(CU("total_impressions", "Impressões", "Soma das impressões de todas as redes de anúncios."), { value: [60000, 180000], swing: 0.3 }),
  metric(CU("total_clicks", "Cliques", "Soma dos cliques de todas as redes de anúncios."), { value: [3000, 9000], swing: 0.3 }),
  metric(CU("total_ads", "Número de anúncios", "Quantidade de anúncios ativos nas redes de anúncios."), { value: [12, 40], swing: 0.05 }),
  metric(CU("total_new_followers", "Novos seguidores", "Seguidores ganhos nas contas sociais no período."), { value: [15, 120], swing: 0.4 }),
  metric(CU("total_posts", "Número de postagens", "Postagens publicadas nas contas sociais no período."), { value: [3, 24], swing: 0.3 }),
  metric(CU("total_leads", "Leads gerados", "Soma dos leads de todas as redes."), { value: [60, 420], swing: 0.4 }),
  metric(CU("total_cost_per_lead", "Custo por lead geral", "Investimento total dividido pelos leads gerados."), { value: [14, 55], decimals: 2, format: "money", upIsGood: false, swing: 0.3 }),
  metric(CU("total_revenue", "Receita total", "Soma da receita atribuída às redes."), { value: [12000, 90000], decimals: 2, format: "money", swing: 0.4 }),
  metric(CU("overall_roas", "ROAS geral", "Receita total dividida pelo investimento total."), { value: [2.6, 7], decimals: 2, swing: 0.3 }),
];

/** Every catalog entry remembers its key on the widgets it makes (so a report can be saved as a template). */
const tag = (list: CatalogEntry[]): CatalogEntry[] => list.map((e) => ({ ...e, make: (ctx) => ({ ...e.make(ctx), key: e.key }) as Widget }));

export const NETWORK_CATALOG: Record<string, CatalogEntry[]> = {
  instagram_business: tag(INSTAGRAM),
  facebook: tag(FACEBOOK),
  meta_ads: tag(META_ADS),
  google_ads: tag(GOOGLE_ADS),
  tiktok_ads: tag(TIKTOK_ADS),
  google_analytics_4: tag(ANALYTICS),
  youtube: tag(YOUTUBE),
  tiktok: tag(TIKTOK),
  linkedin: tag(LINKEDIN),
  custom: tag(CUSTOM),
};

/** Networks a block can be about (the "custom" group is only for the Bloco Personalizado). */
export const CATALOG_NETWORKS = Object.keys(NETWORK_CATALOG).filter((n) => n !== "custom");

export function catalogEntry(network: string, key: string): CatalogEntry | null {
  return NETWORK_CATALOG[network]?.find((e) => e.key === key) ?? null;
}

// ---- where the numbers come from ----------------------------------------------------------

/**
 * A source of numbers for the indicators of a block. Today the only one is the demo
 * source below (made-up numbers). Meta, Google, TikTok, YouTube and the others each get
 * their own later: they return the same `Widget` for the same (network, key), reading
 * the connected account instead of inventing it. Templates and the editor never know
 * the difference, because they only ever name (network, key).
 */
export interface DataSource {
  readonly name: string;
  /** True when the numbers are not real (the report is then marked as a model). */
  readonly demo: boolean;
  widget(network: string, key: string, ctx: MakeContext): Widget | null;
}

export const demoSource: DataSource = {
  name: "demo",
  demo: true,
  widget: (network, key, ctx) => catalogEntry(network, key)?.make(ctx) ?? null,
};

// ---- the model documents ----------------------------------------------------------------

const DEFAULT_KEYS: Record<string, string[]> = {
  instagram_business: ["followers", "paid_reach", "views_total", "reach_total", "followers_growth", "reach_daily", "audience", "gender", "cities", "likes_posts", "reach_posts", "organic_posts", "best_day", "best_hour", "stories_count", "stories_views", "stories_reach", "stories"],
  facebook: ["page_followers", "page_reach", "page_views", "post_engagement", "page_reach_daily", "followers_growth_fb", "link_clicks", "top_posts"],
  meta_ads: ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "leads", "cost_per_lead", "conversations", "cost_per_conversation", "spend_daily", "clicks_daily"],
  google_ads: ["g_clicks", "g_impressions", "g_cost", "g_cpc", "g_conversions", "g_clicks_daily"],
  tiktok_ads: ["t_spend", "t_impressions", "t_clicks", "t_ctr", "t_cpc", "t_conversions", "t_spend_daily"],
  google_analytics_4: ["ga_sessions", "ga_users", "ga_new_users", "ga_engagement_rate", "ga_conversions", "ga_sessions_daily", "ga_channels", "ga_landing_pages"],
  youtube: ["yt_subscribers", "yt_views", "yt_watch_hours", "yt_likes", "yt_views_daily", "yt_top_videos"],
  tiktok: ["tk_followers", "tk_video_views", "tk_profile_views", "tk_likes", "tk_views_daily"],
  linkedin: ["li_followers", "li_impressions", "li_clicks", "li_engagement_rate", "li_impressions_daily"],
};

/** The usual indicators of a network, as keys. */
export const defaultKeys = (network: string): string[] => DEFAULT_KEYS[network] ?? [];

/** A block of a network with the given indicators, from a data source. Keys the network does not have are skipped. */
export function blockFrom(source: DataSource, network: string, account: string, keys: readonly string[], range: Range, seed: string, newId: IdMaker): Block {
  const widgets = keys
    .map((key) => source.widget(network, key, { id: newId("w"), range, seed: `${seed}:${network}` }))
    .filter((w): w is Widget => w !== null);
  return { id: newId("b"), kind: "network", network, title: NETWORK_LABEL[network] ?? network, subtitle: account, analysis: "", hidden: false, widgets };
}

/** The made-up block of a network with its usual indicators. */
export function demoBlock(network: string, account: string, range: Range, seed: string, newId: IdMaker): Block {
  return blockFrom(demoSource, network, account, defaultKeys(network), range, seed, newId);
}

/** The custom block: totals that gather several networks (the icons under each total show which). */
export function customBlockFrom(source: DataSource, items: { key: string; networks: string[] }[], range: Range, seed: string, newId: IdMaker): Block {
  const widgets = items
    .map((it) => {
      const w = source.widget("custom", it.key, { id: newId("w"), range, seed: `${seed}:custom` });
      return w && w.kind === "metric" ? { ...w, networks: it.networks } : w;
    })
    .filter((w): w is Widget => w !== null);
  return { id: newId("b"), kind: "custom", title: "Bloco Personalizado", subtitle: "Resumo consolidado dos resultados da rede", analysis: "", hidden: false, widgets };
}

/** A whole made-up report for a client: custom block first, then one block per network. */
export function buildDemoDoc(opts: { seed: string; range: Range; networks: { network: string; account: string }[] }, newId: IdMaker): ReportDoc {
  const list = opts.networks.map((n) => n.network);
  const social = list.filter((n) => n === "facebook" || n === "instagram_business");
  return {
    version: 1,
    demo: true,
    cover: { hidden: false, subtitle: "Análise de desempenho", analysis: "" },
    blocks: [
      ...(social.length > 0
        ? [customBlockFrom(demoSource, [{ key: "total_reach", networks: social }, { key: "total_engagement", networks: social }], opts.range, opts.seed, newId)]
        : []),
      ...opts.networks.map((n) => demoBlock(n.network, n.account, opts.range, opts.seed, newId)),
    ],
  };
}
