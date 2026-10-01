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
}

export interface GreenhouseSourceDefinition extends SourceDefinitionBase {
  adapterId: "greenhouse";
  boardToken: string;
}

export interface GitHubIssuesSourceDefinition extends SourceDefinitionBase {
  adapterId: "github-issues";
  repository: string;
}

export type SourceDefinition = GreenhouseSourceDefinition | GitHubIssuesSourceDefinition;

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

export const githubIssuesSources: GitHubIssuesSourceDefinition[] = [
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
];

export const pilotSources: SourceDefinition[] = [...greenhouseSources, ...githubIssuesSources];

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
