export interface SourceLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRequestsPerTask: number;
  maxRecords: number;
}

interface SourceDefinitionBase {
  id: string;
  adapterId: string;
  organization: string;
  allowedHosts: string[];
  fetchStrategy: "board_once";
  applicableQueryFamilies: Array<"BROAD" | "ROLE" | "STACK" | "CONTEXT" | "COMPANY" | "EXPERIMENTAL">;
  limits: SourceLimits;
  active: boolean;
  dispatchDelaySeconds?: number;
}

export interface GreenhouseSourceDefinition extends SourceDefinitionBase {
  adapterId: "greenhouse";
  boardToken: string;
}

export interface GitHubIssuesSourceDefinition extends SourceDefinitionBase {
  adapterId: "github-issues";
  repository: string;
}

export interface GupySourceDefinition extends SourceDefinitionBase {
  adapterId: "gupy";
  term: string;
}

export interface TramposSourceDefinition extends SourceDefinitionBase {
  adapterId: "trampos";
}
export interface RssSourceDefinition extends SourceDefinitionBase { adapterId: "google-news-rss"; feedUrl: string; }
export interface LinkedInGuestSourceDefinition extends SourceDefinitionBase {
  adapterId: "linkedin-guest";
  keywords: string;
  geoId: "106057199";
  timeRange: "r7200";
}

export type SourceDefinition = GreenhouseSourceDefinition | GitHubIssuesSourceDefinition | GupySourceDefinition | TramposSourceDefinition | RssSourceDefinition | LinkedInGuestSourceDefinition;

export const greenhouseSources: GreenhouseSourceDefinition[] = [{
  id: "greenhouse:planetscale",
  adapterId: "greenhouse",
  organization: "PlanetScale",
  boardToken: "planetscale",
  allowedHosts: ["boards-api.greenhouse.io"],
  fetchStrategy: "board_once",
  applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT", "COMPANY"],
  limits: { timeoutMs: 10_000, maxResponseBytes: 2 * 1024 * 1024, maxRequestsPerTask: 1, maxRecords: 200 },
  active: true,
}];

export const githubIssuesSources: GitHubIssuesSourceDefinition[] = ([
  {
    id: "github-issues:backend-br/vagas",
    adapterId: "github-issues",
    repository: "backend-br/vagas",
    organization: "backend-br/vagas",
    allowedHosts: ["api.github.com"],
    fetchStrategy: "board_once",
    applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"],
    limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 50 },
    active: true,
  },
  {
    id: "github-issues:soujava/vagas-java",
    adapterId: "github-issues",
    repository: "soujava/vagas-java",
    organization: "soujava/vagas-java",
    allowedHosts: ["api.github.com"],
    fetchStrategy: "board_once",
    applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"],
    limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 50 },
    active: true,
  },
  {
    id: "github-issues:frontendbr/vagas",
    adapterId: "github-issues",
    repository: "frontendbr/vagas",
    organization: "frontendbr/vagas",
    allowedHosts: ["api.github.com"],
    fetchStrategy: "board_once",
    applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"],
    limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 50 },
    active: true,
  },
  {
    id: "github-issues:react-brasil/vagas",
    adapterId: "github-issues",
    repository: "react-brasil/vagas",
    organization: "react-brasil/vagas",
    allowedHosts: ["api.github.com"],
    fetchStrategy: "board_once",
    applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"],
    limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 50 },
    active: true,
  },
  {
    id: "github-issues:nodejsdevbr/vagas",
    adapterId: "github-issues",
    repository: "nodejsdevbr/vagas",
    organization: "nodejsdevbr/vagas",
    allowedHosts: ["api.github.com"],
    fetchStrategy: "board_once",
    applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"],
    limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 50 },
    active: true,
  },
  {
    id: "github-issues:frontend-pt/vagas",
    adapterId: "github-issues",
    repository: "frontend-pt/vagas",
    organization: "frontend-pt/vagas",
    allowedHosts: ["api.github.com"],
    fetchStrategy: "board_once",
    applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"],
    limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 50 },
    active: true,
  },
  {
    id: "github-issues:backend-pt/vagas",
    adapterId: "github-issues",
    repository: "backend-pt/vagas",
    organization: "backend-pt/vagas",
    allowedHosts: ["api.github.com"],
    fetchStrategy: "board_once",
    applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"],
    limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 50 },
    active: true,
  },
] satisfies GitHubIssuesSourceDefinition[]).map((source, index) => ({ ...source, dispatchDelaySeconds: index * 30 }));

export const gupySources: GupySourceDefinition[] = ([
  { id: "gupy:full-stack-junior", adapterId: "gupy", term: "Full Stack Junior", organization: "Gupy", allowedHosts: ["candidates.mcp.api.gupy.io"], fetchStrategy: "board_once", applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"], limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 20 }, active: true },
  { id: "gupy:java-junior", adapterId: "gupy", term: "Java Junior", organization: "Gupy", allowedHosts: ["candidates.mcp.api.gupy.io"], fetchStrategy: "board_once", applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"], limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 20 }, active: true },
  { id: "gupy:python-junior", adapterId: "gupy", term: "Python Junior", organization: "Gupy", allowedHosts: ["candidates.mcp.api.gupy.io"], fetchStrategy: "board_once", applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"], limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 20 }, active: true },
] satisfies GupySourceDefinition[]).map((source, index) => ({ ...source, dispatchDelaySeconds: index * 30 }));

export const tramposSources: TramposSourceDefinition[] = [
  { id: "trampos:development", adapterId: "trampos", organization: "Trampos.co", allowedHosts: ["trampos.co"], fetchStrategy: "board_once", applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"], limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 50 }, active: true },
];
export const rssSources: RssSourceDefinition[] = [
  { id: "rss:goomer", adapterId: "google-news-rss", feedUrl: "https://news.google.com/rss/search?q=%22Goomer%22+(vaga+OR+contratando+OR+oportunidade+OR+desenvolvedor+OR+programador)&hl=pt-BR&gl=BR&ceid=BR:pt-419", organization: "Google News: Goomer", allowedHosts: ["news.google.com"], fetchStrategy: "board_once", applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"], limits: { timeoutMs: 10_000, maxResponseBytes: 256 * 1024, maxRequestsPerTask: 1, maxRecords: 30 }, active: true },
  { id: "rss:gft", adapterId: "google-news-rss", feedUrl: "https://news.google.com/rss/search?q=site:jobs.gft.com+(Brasil+OR+Sorocaba+OR+Remoto)&hl=pt-BR&gl=BR&ceid=BR:pt-419", organization: "Google News: GFT", allowedHosts: ["news.google.com"], fetchStrategy: "board_once", applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"], limits: { timeoutMs: 10_000, maxResponseBytes: 256 * 1024, maxRequestsPerTask: 1, maxRecords: 30 }, active: true },
  { id: "rss:indeed-junior", adapterId: "google-news-rss", feedUrl: "https://news.google.com/rss/search?q=site:br.indeed.com+(desenvolvedor+OR+developer+OR+programador+OR+software)+(junior+OR+jr+OR+estagio)+remoto&hl=pt-BR&gl=BR&ceid=BR:pt-419", organization: "Google News: Indeed", allowedHosts: ["news.google.com"], fetchStrategy: "board_once", applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"], limits: { timeoutMs: 10_000, maxResponseBytes: 256 * 1024, maxRequestsPerTask: 1, maxRecords: 30 }, active: true },
];

export const linkedinGuestSources: LinkedInGuestSourceDefinition[] = [
  "Desenvolvedor Java Junior",
  "Desenvolvedor Node Junior",
  "Desenvolvedor Full Stack Junior",
].map((keywords, index) => ({
  id: `linkedin-guest:${keywords.toLowerCase().replaceAll(" ", "-")}`,
  adapterId: "linkedin-guest",
  keywords,
  geoId: "106057199",
  timeRange: "r7200",
  organization: "LinkedIn guest search",
  allowedHosts: ["www.linkedin.com"],
  fetchStrategy: "board_once",
  applicableQueryFamilies: ["BROAD", "ROLE", "STACK", "CONTEXT"],
  limits: { timeoutMs: 10_000, maxResponseBytes: 512 * 1024, maxRequestsPerTask: 1, maxRecords: 25 },
  active: true,
  dispatchDelaySeconds: index * 180,
}));

export const pilotSources: SourceDefinition[] = [...greenhouseSources, ...githubIssuesSources, ...gupySources, ...tramposSources, ...rssSources, ...linkedinGuestSources];

export interface RelevanceProfile {
  roles: string[];
  seniority: string[];
  locations: string[];
  remoteAccepted: boolean;
  technologies: string[];
  exclusions: string[];
}

export const defaultRelevanceProfile: RelevanceProfile = {
  roles: ["backend", "software engineer", "software developer"],
  seniority: ["junior", "entry level", "associate"],
  locations: ["Brazil", "Latin America", "LATAM"],
  remoteAccepted: true,
  technologies: ["Node.js", "TypeScript", "Java", "Spring", "PostgreSQL"],
  exclusions: ["staff", "principal", "director", "manager"],
};
