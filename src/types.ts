// Types for the Pact Contract MCP Server

export interface AnalysisResult {
  language: "java" | "kotlin" | "unknown";
  buildTool: "gradle" | "maven" | "unknown";
  framework: FrameworkInfo;
  dependencies: DependencyInfo[];
  httpClients: HttpClientInfo[];
  cloudSdks: CloudSdkInfo[];
  services: ServiceInfo[];
  sourceDirectories: string[];
  testDirectories: string[];
  packageName: string;
}

export interface FrameworkInfo {
  type: "spring-boot" | "aws-lambda" | "gcp-functions" | "unknown";
  version?: string;
  modules: string[];
}

export interface DependencyInfo {
  name: string;
  group: string;
  version?: string;
  scope: "compile" | "runtime" | "test" | "provided";
}

export interface HttpClientInfo {
  type: "RestTemplate" | "WebClient" | "Feign" | "OkHttp" | "HttpClient";
  usages: HttpClientUsage[];
}

export interface HttpClientUsage {
  file: string;
  line: number;
  method: string;
  url?: string;
  targetService?: string;
}

export interface CloudSdkInfo {
  provider: "aws" | "gcp" | "azure";
  services: string[];
  usages: CloudSdkUsage[];
}

export interface CloudSdkUsage {
  file: string;
  line: number;
  service: string;
  operation: string;
}

export interface ServiceInfo {
  name: string;
  type: "rest-controller" | "lambda-handler" | "cloud-function" | "feign-client" | "rest-client";
  file: string;
  endpoints: EndpointInfo[];
  dependencies: string[];
}

export interface EndpointInfo {
  path: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  consumes?: string;
  produces?: string;
  parameters: ParameterInfo[];
  responseType?: string;
}

export interface ParameterInfo {
  name: string;
  type: string;
  source: "path" | "query" | "body" | "header";
  required: boolean;
}

export interface ContractStructure {
  internalServices: ServiceClassification[];
  externalServices: ServiceClassification[];
  consumerContracts: ContractDefinition[];
  providerContracts: ContractDefinition[];
}

export interface ServiceClassification {
  name: string;
  type: "internal" | "external";
  reason: string;
  serviceInfo?: ServiceInfo;
}

export interface ContractDefinition {
  consumerName: string;
  providerName: string;
  interactions: InteractionDefinition[];
  type: "consumer" | "provider";
}

export interface InteractionDefinition {
  description: string;
  request: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    headers?: Record<string, string>;
    body?: unknown;
  };
}

export interface ScaffoldResult {
  createdFiles: string[];
  updatedFiles: string[];
  testClasses: TestClassInfo[];
  buildUpdates: BuildUpdateInfo;
  cliCommand: string;
  nextSteps: string[];
}

export interface TestClassInfo {
  className: string;
  filePath: string;
  type: "consumer" | "provider";
  targetService: string;
}

export interface BuildUpdateInfo {
  file: string;
  addedDependencies: string[];
  addedTasks: string[];
  addedConfigurations: string[];
}

export interface LocalBrokerResult {
  dockerComposeFile: string;
  startCommand: string;
  stopCommand: string;
  brokerUrl: string;
  instructions: string[];
}

export interface RemoteBrokerResult {
  createdFiles: string[];
  updatedFiles: string[];
  configLocations: string[];
  instructions: string[];
}
