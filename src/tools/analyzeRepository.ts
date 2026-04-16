import * as fs from "fs/promises";
import * as path from "path";
import { glob } from "glob";
import {
  AnalysisResult,
  DependencyInfo,
  FrameworkInfo,
  HttpClientInfo,
  HttpClientUsage,
  CloudSdkInfo,
  CloudSdkUsage,
  ServiceInfo,
  EndpointInfo,
} from "../types.js";

export async function analyzeRepository(
  repositoryPath: string
): Promise<AnalysisResult> {
  // Verify the path exists
  try {
    await fs.access(repositoryPath);
  } catch {
    throw new Error(`Repository path does not exist: ${repositoryPath}`);
  }

  // Detect language and build tool
  const language = await detectLanguage(repositoryPath);
  const buildTool = await detectBuildTool(repositoryPath);
  const dependencies = await parseDependencies(repositoryPath, buildTool);
  const framework = detectFramework(dependencies);
  const packageName = await detectPackageName(repositoryPath, language);
  
  // Find source directories
  const sourceDirectories = await findSourceDirectories(repositoryPath, language);
  const testDirectories = await findTestDirectories(repositoryPath, language);
  
  // Analyze HTTP clients and their usages
  const httpClients = await analyzeHttpClients(repositoryPath, language);
  
  // Analyze Cloud SDK usages
  const cloudSdks = await analyzeCloudSdks(repositoryPath, language, dependencies);
  
  // Analyze services (controllers, handlers, clients)
  const services = await analyzeServices(repositoryPath, language, framework);

  return {
    language,
    buildTool,
    framework,
    dependencies,
    httpClients,
    cloudSdks,
    services,
    sourceDirectories,
    testDirectories,
    packageName,
  };
}

async function detectLanguage(
  repoPath: string
): Promise<"java" | "kotlin" | "unknown"> {
  const javaFiles = await glob("**/*.java", {
    cwd: repoPath,
    ignore: ["**/node_modules/**", "**/build/**", "**/target/**"],
  });
  const kotlinFiles = await glob("**/*.kt", {
    cwd: repoPath,
    ignore: ["**/node_modules/**", "**/build/**", "**/target/**"],
  });

  if (kotlinFiles.length > javaFiles.length) {
    return "kotlin";
  } else if (javaFiles.length > 0) {
    return "java";
  }
  return "unknown";
}

async function detectBuildTool(
  repoPath: string
): Promise<"gradle" | "maven" | "unknown"> {
  const hasGradle =
    (await fileExists(path.join(repoPath, "build.gradle"))) ||
    (await fileExists(path.join(repoPath, "build.gradle.kts")));
  const hasMaven = await fileExists(path.join(repoPath, "pom.xml"));

  if (hasGradle) return "gradle";
  if (hasMaven) return "maven";
  return "unknown";
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function parseDependencies(
  repoPath: string,
  buildTool: "gradle" | "maven" | "unknown"
): Promise<DependencyInfo[]> {
  const dependencies: DependencyInfo[] = [];

  if (buildTool === "gradle") {
    const gradleFile =
      (await fileExists(path.join(repoPath, "build.gradle.kts")))
        ? path.join(repoPath, "build.gradle.kts")
        : path.join(repoPath, "build.gradle");

    if (await fileExists(gradleFile)) {
      const content = await fs.readFile(gradleFile, "utf-8");
      
      // Parse dependencies from Gradle
      const depRegex = /(?:implementation|compileOnly|runtimeOnly|testImplementation|api)\s*[(\s]["']([^"':]+):([^"':]+)(?::([^"']+))?["']/g;
      let match;
      while ((match = depRegex.exec(content)) !== null) {
        dependencies.push({
          group: match[1],
          name: match[2],
          version: match[3],
          scope: match[0].includes("test") ? "test" : "compile",
        });
      }
      
      // Also check for platform/BOM dependencies
      const bomRegex = /platform\s*\(\s*["']([^"':]+):([^"':]+)(?::([^"']+))?["']/g;
      while ((match = bomRegex.exec(content)) !== null) {
        dependencies.push({
          group: match[1],
          name: match[2],
          version: match[3],
          scope: "compile",
        });
      }
    }
  } else if (buildTool === "maven") {
    const pomFile = path.join(repoPath, "pom.xml");
    if (await fileExists(pomFile)) {
      const content = await fs.readFile(pomFile, "utf-8");
      
      // Simple XML parsing for dependencies
      const depRegex = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]+)<\/version>)?(?:\s*<scope>([^<]+)<\/scope>)?/g;
      let match;
      while ((match = depRegex.exec(content)) !== null) {
        dependencies.push({
          group: match[1],
          name: match[2],
          version: match[3],
          scope: (match[4] as DependencyInfo["scope"]) || "compile",
        });
      }
    }
  }

  return dependencies;
}

function detectFramework(dependencies: DependencyInfo[]): FrameworkInfo {
  const depNames = dependencies.map((d) => `${d.group}:${d.name}`);
  const modules: string[] = [];

  // Check for Spring Boot
  const isSpringBoot = depNames.some(
    (d) =>
      d.includes("spring-boot") ||
      d.includes("org.springframework.boot")
  );

  if (isSpringBoot) {
    if (depNames.some((d) => d.includes("spring-boot-starter-web"))) {
      modules.push("web");
    }
    if (depNames.some((d) => d.includes("spring-boot-starter-webflux"))) {
      modules.push("webflux");
    }
    if (depNames.some((d) => d.includes("spring-cloud-starter-openfeign"))) {
      modules.push("feign");
    }
    if (depNames.some((d) => d.includes("spring-boot-starter-data"))) {
      modules.push("data");
    }
    
    const versionDep = dependencies.find(
      (d) => d.group === "org.springframework.boot"
    );
    
    return {
      type: "spring-boot",
      version: versionDep?.version,
      modules,
    };
  }

  // Check for AWS Lambda
  const isLambda = depNames.some(
    (d) =>
      d.includes("aws-lambda-java") ||
      d.includes("com.amazonaws:aws-lambda")
  );

  if (isLambda) {
    if (depNames.some((d) => d.includes("aws-lambda-java-events"))) {
      modules.push("events");
    }
    if (depNames.some((d) => d.includes("aws-java-sdk"))) {
      modules.push("sdk");
    }
    return {
      type: "aws-lambda",
      modules,
    };
  }

  // Check for GCP Functions
  const isGcpFunctions = depNames.some(
    (d) =>
      d.includes("functions-framework") ||
      d.includes("com.google.cloud.functions")
  );

  if (isGcpFunctions) {
    return {
      type: "gcp-functions",
      modules,
    };
  }

  return {
    type: "unknown",
    modules: [],
  };
}

async function detectPackageName(
  repoPath: string,
  language: "java" | "kotlin" | "unknown"
): Promise<string> {
  const ext = language === "kotlin" ? "kt" : "java";
  const sourceFiles = await glob(`**/src/main/**/*.${ext}`, {
    cwd: repoPath,
    ignore: ["**/build/**", "**/target/**"],
  });

  if (sourceFiles.length > 0) {
    const firstFile = path.join(repoPath, sourceFiles[0]);
    const content = await fs.readFile(firstFile, "utf-8");
    const packageMatch = content.match(/package\s+([\w.]+)/);
    if (packageMatch) {
      // Return base package (first 2-3 segments)
      const parts = packageMatch[1].split(".");
      return parts.slice(0, Math.min(3, parts.length)).join(".");
    }
  }

  return "com.example";
}

async function findSourceDirectories(
  repoPath: string,
  language: "java" | "kotlin" | "unknown"
): Promise<string[]> {
  const dirs: string[] = [];
  const mainJava = path.join(repoPath, "src", "main", "java");
  const mainKotlin = path.join(repoPath, "src", "main", "kotlin");

  if (await fileExists(mainJava)) dirs.push(mainJava);
  if (await fileExists(mainKotlin)) dirs.push(mainKotlin);

  return dirs;
}

async function findTestDirectories(
  repoPath: string,
  language: "java" | "kotlin" | "unknown"
): Promise<string[]> {
  const dirs: string[] = [];
  const testJava = path.join(repoPath, "src", "test", "java");
  const testKotlin = path.join(repoPath, "src", "test", "kotlin");

  if (await fileExists(testJava)) dirs.push(testJava);
  if (await fileExists(testKotlin)) dirs.push(testKotlin);

  return dirs;
}

async function analyzeHttpClients(
  repoPath: string,
  language: "java" | "kotlin" | "unknown"
): Promise<HttpClientInfo[]> {
  const clients: HttpClientInfo[] = [];
  const ext = language === "kotlin" ? "kt" : "java";
  
  const sourceFiles = await glob(`**/*.${ext}`, {
    cwd: repoPath,
    ignore: ["**/build/**", "**/target/**", "**/node_modules/**"],
  });

  const clientPatterns: { type: HttpClientInfo["type"]; pattern: RegExp }[] = [
    { type: "RestTemplate", pattern: /RestTemplate|restTemplate/g },
    { type: "WebClient", pattern: /WebClient|webClient/g },
    { type: "Feign", pattern: /@FeignClient|FeignClient/g },
    { type: "OkHttp", pattern: /OkHttpClient|okHttpClient/g },
    { type: "HttpClient", pattern: /HttpClient|httpClient/g },
  ];

  for (const pattern of clientPatterns) {
    const usages: HttpClientUsage[] = [];

    for (const file of sourceFiles) {
      const filePath = path.join(repoPath, file);
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (pattern.pattern.test(lines[i])) {
          // Try to extract URL if present
          const urlMatch = lines[i].match(/["'](https?:\/\/[^"']+)["']/);
          const methodMatch = lines[i].match(/\.(get|post|put|delete|patch)\s*\(/i);
          
          usages.push({
            file,
            line: i + 1,
            method: methodMatch ? methodMatch[1].toUpperCase() : "UNKNOWN",
            url: urlMatch ? urlMatch[1] : undefined,
          });
        }
        // Reset regex
        pattern.pattern.lastIndex = 0;
      }
    }

    if (usages.length > 0) {
      clients.push({
        type: pattern.type,
        usages,
      });
    }
  }

  return clients;
}

async function analyzeCloudSdks(
  repoPath: string,
  language: "java" | "kotlin" | "unknown",
  dependencies: DependencyInfo[]
): Promise<CloudSdkInfo[]> {
  const sdks: CloudSdkInfo[] = [];
  const ext = language === "kotlin" ? "kt" : "java";

  // AWS SDK patterns
  const awsDeps = dependencies.filter(
    (d) => d.group.includes("aws") || d.name.includes("aws")
  );
  if (awsDeps.length > 0) {
    const awsUsages = await findCloudSdkUsages(repoPath, ext, [
      { pattern: /AmazonS3|S3Client/g, service: "S3" },
      { pattern: /AmazonDynamoDB|DynamoDbClient/g, service: "DynamoDB" },
      { pattern: /AmazonSQS|SqsClient/g, service: "SQS" },
      { pattern: /AmazonSNS|SnsClient/g, service: "SNS" },
      { pattern: /AmazonKinesis|KinesisClient/g, service: "Kinesis" },
      { pattern: /SecretsManager/g, service: "SecretsManager" },
    ]);

    if (awsUsages.length > 0) {
      sdks.push({
        provider: "aws",
        services: [...new Set(awsUsages.map((u) => u.service))],
        usages: awsUsages,
      });
    }
  }

  // GCP SDK patterns
  const gcpDeps = dependencies.filter(
    (d) => d.group.includes("google.cloud") || d.name.includes("gcp")
  );
  if (gcpDeps.length > 0) {
    const gcpUsages = await findCloudSdkUsages(repoPath, ext, [
      { pattern: /Storage|StorageClient/g, service: "Storage" },
      { pattern: /Firestore|FirestoreClient/g, service: "Firestore" },
      { pattern: /PubSub|Publisher|Subscriber/g, service: "PubSub" },
      { pattern: /BigQuery/g, service: "BigQuery" },
    ]);

    if (gcpUsages.length > 0) {
      sdks.push({
        provider: "gcp",
        services: [...new Set(gcpUsages.map((u) => u.service))],
        usages: gcpUsages,
      });
    }
  }

  return sdks;
}

async function findCloudSdkUsages(
  repoPath: string,
  ext: string,
  patterns: { pattern: RegExp; service: string }[]
): Promise<CloudSdkUsage[]> {
  const usages: CloudSdkUsage[] = [];
  const sourceFiles = await glob(`**/*.${ext}`, {
    cwd: repoPath,
    ignore: ["**/build/**", "**/target/**", "**/node_modules/**"],
  });

  for (const file of sourceFiles) {
    const filePath = path.join(repoPath, file);
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split("\n");

    for (const { pattern, service } of patterns) {
      for (let i = 0; i < lines.length; i++) {
        if (pattern.test(lines[i])) {
          const operationMatch = lines[i].match(/\.(\w+)\s*\(/);
          usages.push({
            file,
            line: i + 1,
            service,
            operation: operationMatch ? operationMatch[1] : "unknown",
          });
        }
        pattern.lastIndex = 0;
      }
    }
  }

  return usages;
}

async function analyzeServices(
  repoPath: string,
  language: "java" | "kotlin" | "unknown",
  framework: FrameworkInfo
): Promise<ServiceInfo[]> {
  const services: ServiceInfo[] = [];
  const ext = language === "kotlin" ? "kt" : "java";

  const sourceFiles = await glob(`**/*.${ext}`, {
    cwd: repoPath,
    ignore: ["**/build/**", "**/target/**", "**/node_modules/**", "**/test/**"],
  });

  for (const file of sourceFiles) {
    const filePath = path.join(repoPath, file);
    const content = await fs.readFile(filePath, "utf-8");

    // Detect REST Controllers
    if (content.includes("@RestController") || content.includes("@Controller")) {
      const service = await parseRestController(file, content);
      if (service) services.push(service);
    }

    // Detect Feign Clients
    if (content.includes("@FeignClient")) {
      const service = await parseFeignClient(file, content);
      if (service) services.push(service);
    }

    // Detect Lambda Handlers
    if (
      content.includes("RequestHandler") ||
      content.includes("handleRequest")
    ) {
      const service = await parseLambdaHandler(file, content);
      if (service) services.push(service);
    }

    // Detect GCP Functions
    if (
      content.includes("HttpFunction") ||
      content.includes("BackgroundFunction")
    ) {
      const service = await parseCloudFunction(file, content);
      if (service) services.push(service);
    }
  }

  return services;
}

async function parseRestController(
  file: string,
  content: string
): Promise<ServiceInfo | null> {
  const classMatch = content.match(/class\s+(\w+)/);
  if (!classMatch) return null;

  const endpoints: EndpointInfo[] = [];
  const mappingRegex = /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;
  const requestMappingRegex = /@RequestMapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/;

  const basePath = requestMappingRegex.exec(content)?.[1] || "";

  let match;
  while ((match = mappingRegex.exec(content)) !== null) {
    endpoints.push({
      path: basePath + match[2],
      method: match[1].toUpperCase() as EndpointInfo["method"],
      parameters: [],
    });
  }

  return {
    name: classMatch[1],
    type: "rest-controller",
    file,
    endpoints,
    dependencies: [],
  };
}

async function parseFeignClient(
  file: string,
  content: string
): Promise<ServiceInfo | null> {
  const clientMatch = content.match(
    /@FeignClient\s*\(\s*(?:name\s*=\s*)?["']([^"']+)["']/
  );
  const interfaceMatch = content.match(/interface\s+(\w+)/);

  if (!interfaceMatch) return null;

  const endpoints: EndpointInfo[] = [];
  const mappingRegex = /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*)?["']([^"']+)["']/g;

  let match;
  while ((match = mappingRegex.exec(content)) !== null) {
    endpoints.push({
      path: match[2],
      method: match[1].toUpperCase() as EndpointInfo["method"],
      parameters: [],
    });
  }

  return {
    name: interfaceMatch[1],
    type: "feign-client",
    file,
    endpoints,
    dependencies: [clientMatch?.[1] || "unknown-service"],
  };
}

async function parseLambdaHandler(
  file: string,
  content: string
): Promise<ServiceInfo | null> {
  const classMatch = content.match(/class\s+(\w+)/);
  if (!classMatch) return null;

  return {
    name: classMatch[1],
    type: "lambda-handler",
    file,
    endpoints: [
      {
        path: "/",
        method: "POST",
        parameters: [],
      },
    ],
    dependencies: [],
  };
}

async function parseCloudFunction(
  file: string,
  content: string
): Promise<ServiceInfo | null> {
  const classMatch = content.match(/class\s+(\w+)/);
  if (!classMatch) return null;

  return {
    name: classMatch[1],
    type: "cloud-function",
    file,
    endpoints: [
      {
        path: "/",
        method: "POST",
        parameters: [],
      },
    ],
    dependencies: [],
  };
}
