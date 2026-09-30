export interface SourceLimits {
  timeoutMs: number;
  maxResponseBytes: number;
  maxRequestsPerTask: number;
  maxRecords: number;
}

export interface SourceDefinition {
  id: string;
  adapterId: string;
  organization: string;
  boardToken: string;
  allowedHosts: string[];
  fetchStrategy: "board_once";
  applicableQueryFamilies: Array<"BROAD" | "ROLE" | "STACK" | "CONTEXT" | "COMPANY" | "EXPERIMENTAL">;
  limits: SourceLimits;
  active: boolean;
}

export const pilotSources: SourceDefinition[] = [{
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
