import {
  AnalysisResult,
  ContractStructure,
  ServiceClassification,
  ContractDefinition,
  InteractionDefinition,
} from "../types.js";

export async function generateContractStructure(
  repositoryPath: string,
  analysis: AnalysisResult
): Promise<ContractStructure> {
  const internalServices: ServiceClassification[] = [];
  const externalServices: ServiceClassification[] = [];
  const consumerContracts: ContractDefinition[] = [];
  const providerContracts: ContractDefinition[] = [];

  // Classify services
  for (const service of analysis.services) {
    if (
      service.type === "rest-controller" ||
      service.type === "lambda-handler" ||
      service.type === "cloud-function"
    ) {
      // These are internal services that we provide
      internalServices.push({
        name: service.name,
        type: "internal",
        reason: `This is an ${service.type} that exposes endpoints`,
        serviceInfo: service,
      });
    } else if (service.type === "feign-client" || service.type === "rest-client") {
      // These are external services that we consume
      externalServices.push({
        name: service.name,
        type: "external",
        reason: `This is a ${service.type} that calls external services`,
        serviceInfo: service,
      });
    }
  }

  // Add external services detected from HTTP clients
  for (const client of analysis.httpClients) {
    for (const usage of client.usages) {
      if (usage.targetService) {
        const existing = externalServices.find(
          (s) => s.name === usage.targetService
        );
        if (!existing) {
          externalServices.push({
            name: usage.targetService,
            type: "external",
            reason: `Detected ${client.type} call to external service`,
          });
        }
      }
    }
  }

  // Add Cloud SDK services as external dependencies
  for (const sdk of analysis.cloudSdks) {
    for (const service of sdk.services) {
      externalServices.push({
        name: `${sdk.provider.toUpperCase()}-${service}`,
        type: "external",
        reason: `Cloud SDK dependency: ${sdk.provider} ${service}`,
      });
    }
  }

  // Generate Consumer Contracts (for external services we call)
  const appName = extractAppName(analysis);
  
  for (const external of externalServices) {
    if (external.serviceInfo) {
      const interactions = generateInteractions(external.serviceInfo);
      consumerContracts.push({
        consumerName: appName,
        providerName: external.name,
        interactions,
        type: "consumer",
      });
    } else {
      // Create placeholder contract for detected services
      consumerContracts.push({
        consumerName: appName,
        providerName: external.name,
        interactions: [
          {
            description: `${appName} calls ${external.name}`,
            request: {
              method: "GET",
              path: "/",
              headers: { "Content-Type": "application/json" },
            },
            response: {
              status: 200,
              headers: { "Content-Type": "application/json" },
              body: {},
            },
          },
        ],
        type: "consumer",
      });
    }
  }

  // Generate Provider Contracts (for internal services we expose)
  for (const internal of internalServices) {
    if (internal.serviceInfo) {
      const interactions = generateInteractions(internal.serviceInfo);
      providerContracts.push({
        consumerName: "consumer-service",
        providerName: internal.name,
        interactions,
        type: "provider",
      });
    }
  }

  return {
    internalServices,
    externalServices,
    consumerContracts,
    providerContracts,
  };
}

function extractAppName(analysis: AnalysisResult): string {
  // Try to get app name from package
  const parts = analysis.packageName.split(".");
  return parts[parts.length - 1] || "my-service";
}

function generateInteractions(
  serviceInfo: NonNullable<ServiceClassification["serviceInfo"]>
): InteractionDefinition[] {
  const interactions: InteractionDefinition[] = [];

  for (const endpoint of serviceInfo.endpoints) {
    const interaction: InteractionDefinition = {
      description: `${endpoint.method} ${endpoint.path}`,
      request: {
        method: endpoint.method,
        path: endpoint.path,
        headers: {
          "Content-Type": endpoint.consumes || "application/json",
        },
      },
      response: {
        status: 200,
        headers: {
          "Content-Type": endpoint.produces || "application/json",
        },
        body: {},
      },
    };

    // Add request body for POST/PUT/PATCH
    if (["POST", "PUT", "PATCH"].includes(endpoint.method)) {
      interaction.request.body = {};
    }

    interactions.push(interaction);
  }

  // If no endpoints detected, add a default interaction
  if (interactions.length === 0) {
    interactions.push({
      description: `Call to ${serviceInfo.name}`,
      request: {
        method: "GET",
        path: "/",
        headers: { "Content-Type": "application/json" },
      },
      response: {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {},
      },
    });
  }

  return interactions;
}
