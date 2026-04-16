import * as fs from "fs/promises";
import * as path from "path";
import {
  AnalysisResult,
  ContractStructure,
  ScaffoldResult,
  TestClassInfo,
  BuildUpdateInfo,
} from "../types.js";

export async function scaffoldPactTests(
  repositoryPath: string,
  analysis: AnalysisResult,
  contractStructure: ContractStructure
): Promise<ScaffoldResult> {
  const createdFiles: string[] = [];
  const updatedFiles: string[] = [];
  const testClasses: TestClassInfo[] = [];

  // Determine test directory
  const testDir = path.join(
    repositoryPath,
    "src",
    "test",
    analysis.language === "kotlin" ? "kotlin" : "java"
  );
  const packagePath = analysis.packageName.replace(/\./g, "/");
  const pactTestDir = path.join(testDir, packagePath, "pact");

  // Create Pact test directory
  await fs.mkdir(pactTestDir, { recursive: true });

  // Generate Consumer Tests
  for (const contract of contractStructure.consumerContracts) {
    const testClass = await generateConsumerTest(
      pactTestDir,
      contract,
      analysis,
      contractStructure
    );
    testClasses.push(testClass);
    createdFiles.push(testClass.filePath);
  }

  // Generate Provider Tests
  for (const contract of contractStructure.providerContracts) {
    const testClass = await generateProviderTest(
      pactTestDir,
      contract,
      analysis
    );
    testClasses.push(testClass);
    createdFiles.push(testClass.filePath);
  }

  // Generate mock wrappers for Lambda/Cloud Functions
  if (
    analysis.framework.type === "aws-lambda" ||
    analysis.framework.type === "gcp-functions"
  ) {
    const mockWrappers = await generateMockWrappers(
      pactTestDir,
      analysis,
      contractStructure
    );
    createdFiles.push(...mockWrappers);
  }

  // Update build files
  const buildUpdates = await updateBuildFile(repositoryPath, analysis);
  if (buildUpdates.file) {
    updatedFiles.push(buildUpdates.file);
  }

  // Generate CLI command
  const cliCommand = generateCliCommand(analysis);

  // Generate next steps
  const nextSteps = generateNextSteps(analysis, contractStructure);

  return {
    createdFiles,
    updatedFiles,
    testClasses,
    buildUpdates,
    cliCommand,
    nextSteps,
  };
}

async function generateConsumerTest(
  testDir: string,
  contract: ContractStructure["consumerContracts"][0],
  analysis: AnalysisResult,
  contractStructure: ContractStructure
): Promise<TestClassInfo> {
  const className = `${sanitizeClassName(contract.providerName)}ConsumerPactTest`;
  const ext = analysis.language === "kotlin" ? "kt" : "java";
  const filePath = path.join(testDir, `${className}.${ext}`);

  let content: string;
  if (analysis.language === "kotlin") {
    content = generateKotlinConsumerTest(contract, analysis, className);
  } else {
    content = generateJavaConsumerTest(contract, analysis, className);
  }

  await fs.writeFile(filePath, content, "utf-8");

  return {
    className,
    filePath,
    type: "consumer",
    targetService: contract.providerName,
  };
}

function generateJavaConsumerTest(
  contract: ContractStructure["consumerContracts"][0],
  analysis: AnalysisResult,
  className: string
): string {
  const interactions = contract.interactions
    .map(
      (interaction, index) => `
    @Pact(consumer = "${contract.consumerName}")
    public RequestResponsePact ${toCamelCase(interaction.description)}Pact(PactDslWithProvider builder) {
        return builder
            .given("${interaction.description} state")
            .uponReceiving("${interaction.description}")
                .path("${interaction.request.path}")
                .method("${interaction.request.method}")
                ${interaction.request.body ? '.body(new PactDslJsonBody())' : ''}
            .willRespondWith()
                .status(${interaction.response.status})
                .headers(Map.of("Content-Type", "application/json"))
                .body(new PactDslJsonBody()
                    // TODO: Add expected response body fields
                )
            .toPact();
    }

    @Test
    @PactTestFor(pactMethod = "${toCamelCase(interaction.description)}Pact")
    void test${capitalizeFirst(toCamelCase(interaction.description))}(MockServer mockServer) {
        // TODO: Configure your client to use mockServer.getUrl()
        // Example:
        // var client = new ${contract.providerName}Client(mockServer.getUrl());
        // var response = client.${toCamelCase(interaction.description)}();
        // assertThat(response).isNotNull();
    }`
    )
    .join("\n");

  return `package ${analysis.packageName}.pact;

import au.com.dius.pact.consumer.MockServer;
import au.com.dius.pact.consumer.dsl.PactDslJsonBody;
import au.com.dius.pact.consumer.dsl.PactDslWithProvider;
import au.com.dius.pact.consumer.junit5.PactConsumerTestExt;
import au.com.dius.pact.consumer.junit5.PactTestFor;
import au.com.dius.pact.core.model.RequestResponsePact;
import au.com.dius.pact.core.model.annotations.Pact;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Consumer Pact Test for ${contract.providerName}
 * 
 * This test verifies that ${contract.consumerName} correctly interacts with ${contract.providerName}.
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
@ExtendWith(PactConsumerTestExt.class)
@PactTestFor(providerName = "${contract.providerName}")
public class ${className} {
${interactions}
}
`;
}

function generateKotlinConsumerTest(
  contract: ContractStructure["consumerContracts"][0],
  analysis: AnalysisResult,
  className: string
): string {
  const interactions = contract.interactions
    .map(
      (interaction) => `
    @Pact(consumer = "${contract.consumerName}")
    fun ${toCamelCase(interaction.description)}Pact(builder: PactDslWithProvider): RequestResponsePact {
        return builder
            .given("${interaction.description} state")
            .uponReceiving("${interaction.description}")
                .path("${interaction.request.path}")
                .method("${interaction.request.method}")
                ${interaction.request.body ? '.body(PactDslJsonBody())' : ''}
            .willRespondWith()
                .status(${interaction.response.status})
                .headers(mapOf("Content-Type" to "application/json"))
                .body(PactDslJsonBody()
                    // TODO: Add expected response body fields
                )
            .toPact()
    }

    @Test
    @PactTestFor(pactMethod = "${toCamelCase(interaction.description)}Pact")
    fun \`test ${interaction.description}\`(mockServer: MockServer) {
        // TODO: Configure your client to use mockServer.url
        // Example:
        // val client = ${contract.providerName}Client(mockServer.url)
        // val response = client.${toCamelCase(interaction.description)}()
        // assertThat(response).isNotNull()
    }`
    )
    .join("\n");

  return `package ${analysis.packageName}.pact

import au.com.dius.pact.consumer.MockServer
import au.com.dius.pact.consumer.dsl.PactDslJsonBody
import au.com.dius.pact.consumer.dsl.PactDslWithProvider
import au.com.dius.pact.consumer.junit5.PactConsumerTestExt
import au.com.dius.pact.consumer.junit5.PactTestFor
import au.com.dius.pact.core.model.RequestResponsePact
import au.com.dius.pact.core.model.annotations.Pact
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.extension.ExtendWith

import org.assertj.core.api.Assertions.assertThat

/**
 * Consumer Pact Test for ${contract.providerName}
 * 
 * This test verifies that ${contract.consumerName} correctly interacts with ${contract.providerName}.
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
@ExtendWith(PactConsumerTestExt::class)
@PactTestFor(providerName = "${contract.providerName}")
class ${className} {
${interactions}
}
`;
}

async function generateProviderTest(
  testDir: string,
  contract: ContractStructure["providerContracts"][0],
  analysis: AnalysisResult
): Promise<TestClassInfo> {
  const className = `${sanitizeClassName(contract.providerName)}ProviderPactTest`;
  const ext = analysis.language === "kotlin" ? "kt" : "java";
  const filePath = path.join(testDir, `${className}.${ext}`);

  let content: string;
  if (analysis.language === "kotlin") {
    content = generateKotlinProviderTest(contract, analysis, className);
  } else {
    content = generateJavaProviderTest(contract, analysis, className);
  }

  await fs.writeFile(filePath, content, "utf-8");

  return {
    className,
    filePath,
    type: "provider",
    targetService: contract.providerName,
  };
}

function generateJavaProviderTest(
  contract: ContractStructure["providerContracts"][0],
  analysis: AnalysisResult,
  className: string
): string {
  const isSpringBoot = analysis.framework.type === "spring-boot";

  if (isSpringBoot) {
    return `package ${analysis.packageName}.pact;

import au.com.dius.pact.provider.junit5.HttpTestTarget;
import au.com.dius.pact.provider.junit5.PactVerificationContext;
import au.com.dius.pact.provider.junit5.PactVerificationInvocationContextProvider;
import au.com.dius.pact.provider.junitsupport.Provider;
import au.com.dius.pact.provider.junitsupport.State;
import au.com.dius.pact.provider.junitsupport.loader.PactBroker;
import au.com.dius.pact.provider.junitsupport.loader.PactFolder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.TestTemplate;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.test.context.junit.jupiter.SpringExtension;

/**
 * Provider Pact Test for ${contract.providerName}
 * 
 * This test verifies that ${contract.providerName} correctly fulfills the contract with consumers.
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
@ExtendWith(SpringExtension.class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Provider("${contract.providerName}")
@PactFolder("pacts")  // Use @PactBroker for remote broker
public class ${className} {

    @LocalServerPort
    private int port;

    @BeforeEach
    void setUp(PactVerificationContext context) {
        context.setTarget(new HttpTestTarget("localhost", port));
    }

    @TestTemplate
    @ExtendWith(PactVerificationInvocationContextProvider.class)
    void pactVerificationTestTemplate(PactVerificationContext context) {
        context.verifyInteraction();
    }

    // State handlers for each interaction
${contract.interactions.map(i => `
    @State("${i.description} state")
    public void ${toCamelCase(i.description)}State() {
        // TODO: Set up the provider state
        // This is where you prepare your database, mocks, etc.
    }
`).join('')}
}
`;
  } else {
    // Lambda or Cloud Functions
    return `package ${analysis.packageName}.pact;

import au.com.dius.pact.provider.junit5.HttpTestTarget;
import au.com.dius.pact.provider.junit5.PactVerificationContext;
import au.com.dius.pact.provider.junit5.PactVerificationInvocationContextProvider;
import au.com.dius.pact.provider.junitsupport.Provider;
import au.com.dius.pact.provider.junitsupport.State;
import au.com.dius.pact.provider.junitsupport.loader.PactFolder;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.TestTemplate;
import org.junit.jupiter.api.extension.ExtendWith;

/**
 * Provider Pact Test for ${contract.providerName}
 * 
 * This test verifies that ${contract.providerName} correctly fulfills the contract with consumers.
 * Uses a mock HTTP wrapper around the Lambda/Cloud Function handler.
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
@Provider("${contract.providerName}")
@PactFolder("pacts")
public class ${className} {

    private static MockHttpServer mockServer;

    @BeforeAll
    static void setUpServer() {
        // Start mock HTTP server that wraps the Lambda handler
        mockServer = new MockHttpServer(new ${contract.providerName}());
        mockServer.start();
    }

    @BeforeEach
    void setUp(PactVerificationContext context) {
        context.setTarget(new HttpTestTarget("localhost", mockServer.getPort()));
    }

    @TestTemplate
    @ExtendWith(PactVerificationInvocationContextProvider.class)
    void pactVerificationTestTemplate(PactVerificationContext context) {
        context.verifyInteraction();
    }

${contract.interactions.map(i => `
    @State("${i.description} state")
    public void ${toCamelCase(i.description)}State() {
        // TODO: Set up the provider state
    }
`).join('')}
}
`;
  }
}

function generateKotlinProviderTest(
  contract: ContractStructure["providerContracts"][0],
  analysis: AnalysisResult,
  className: string
): string {
  const isSpringBoot = analysis.framework.type === "spring-boot";

  if (isSpringBoot) {
    return `package ${analysis.packageName}.pact

import au.com.dius.pact.provider.junit5.HttpTestTarget
import au.com.dius.pact.provider.junit5.PactVerificationContext
import au.com.dius.pact.provider.junit5.PactVerificationInvocationContextProvider
import au.com.dius.pact.provider.junitsupport.Provider
import au.com.dius.pact.provider.junitsupport.State
import au.com.dius.pact.provider.junitsupport.loader.PactFolder
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.TestTemplate
import org.junit.jupiter.api.extension.ExtendWith
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.test.context.junit.jupiter.SpringExtension

/**
 * Provider Pact Test for ${contract.providerName}
 * 
 * This test verifies that ${contract.providerName} correctly fulfills the contract with consumers.
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
@ExtendWith(SpringExtension::class)
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Provider("${contract.providerName}")
@PactFolder("pacts")
class ${className} {

    @LocalServerPort
    private var port: Int = 0

    @BeforeEach
    fun setUp(context: PactVerificationContext) {
        context.target = HttpTestTarget("localhost", port)
    }

    @TestTemplate
    @ExtendWith(PactVerificationInvocationContextProvider::class)
    fun pactVerificationTestTemplate(context: PactVerificationContext) {
        context.verifyInteraction()
    }

${contract.interactions.map(i => `
    @State("${i.description} state")
    fun ${toCamelCase(i.description)}State() {
        // TODO: Set up the provider state
    }
`).join('')}
}
`;
  } else {
    return `package ${analysis.packageName}.pact

import au.com.dius.pact.provider.junit5.HttpTestTarget
import au.com.dius.pact.provider.junit5.PactVerificationContext
import au.com.dius.pact.provider.junit5.PactVerificationInvocationContextProvider
import au.com.dius.pact.provider.junitsupport.Provider
import au.com.dius.pact.provider.junitsupport.State
import au.com.dius.pact.provider.junitsupport.loader.PactFolder
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.TestTemplate
import org.junit.jupiter.api.extension.ExtendWith

/**
 * Provider Pact Test for ${contract.providerName}
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
@Provider("${contract.providerName}")
@PactFolder("pacts")
class ${className} {

    companion object {
        private lateinit var mockServer: MockHttpServer

        @BeforeAll
        @JvmStatic
        fun setUpServer() {
            mockServer = MockHttpServer(${contract.providerName}())
            mockServer.start()
        }
    }

    @BeforeEach
    fun setUp(context: PactVerificationContext) {
        context.target = HttpTestTarget("localhost", mockServer.port)
    }

    @TestTemplate
    @ExtendWith(PactVerificationInvocationContextProvider::class)
    fun pactVerificationTestTemplate(context: PactVerificationContext) {
        context.verifyInteraction()
    }

${contract.interactions.map(i => `
    @State("${i.description} state")
    fun ${toCamelCase(i.description)}State() {
        // TODO: Set up the provider state
    }
`).join('')}
}
`;
  }
}

async function generateMockWrappers(
  testDir: string,
  analysis: AnalysisResult,
  contractStructure: ContractStructure
): Promise<string[]> {
  const createdFiles: string[] = [];
  const ext = analysis.language === "kotlin" ? "kt" : "java";

  // Generate MockHttpServer wrapper
  const mockServerPath = path.join(testDir, `MockHttpServer.${ext}`);
  
  let content: string;
  if (analysis.framework.type === "aws-lambda") {
    content = analysis.language === "kotlin"
      ? generateKotlinLambdaMockServer(analysis)
      : generateJavaLambdaMockServer(analysis);
  } else {
    content = analysis.language === "kotlin"
      ? generateKotlinCloudFunctionMockServer(analysis)
      : generateJavaCloudFunctionMockServer(analysis);
  }

  await fs.writeFile(mockServerPath, content, "utf-8");
  createdFiles.push(mockServerPath);

  return createdFiles;
}

function generateJavaLambdaMockServer(analysis: AnalysisResult): string {
  return `package ${analysis.packageName}.pact;

import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;

/**
 * Mock HTTP Server wrapper for Lambda handlers
 * Wraps a Lambda RequestHandler to expose it as an HTTP endpoint for Pact testing.
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
public class MockHttpServer {
    
    private final HttpServer server;
    private final RequestHandler<Object, Object> handler;
    private int port;

    @SuppressWarnings("unchecked")
    public <I, O> MockHttpServer(RequestHandler<I, O> handler) {
        this.handler = (RequestHandler<Object, Object>) handler;
        try {
            this.server = HttpServer.create(new InetSocketAddress(0), 0);
            this.port = server.getAddress().getPort();
            this.server.createContext("/", this::handleRequest);
        } catch (IOException e) {
            throw new RuntimeException("Failed to create mock server", e);
        }
    }

    public void start() {
        server.start();
    }

    public void stop() {
        server.stop(0);
    }

    public int getPort() {
        return port;
    }

    private void handleRequest(HttpExchange exchange) throws IOException {
        try {
            // Read request body
            InputStream is = exchange.getRequestBody();
            String requestBody = new String(is.readAllBytes(), StandardCharsets.UTF_8);
            
            // Create mock Lambda context
            Context context = new MockLambdaContext();
            
            // Invoke handler
            Object response = handler.handleRequest(requestBody, context);
            
            // Write response
            String responseBody = response != null ? response.toString() : "";
            exchange.sendResponseHeaders(200, responseBody.length());
            OutputStream os = exchange.getResponseBody();
            os.write(responseBody.getBytes(StandardCharsets.UTF_8));
            os.close();
        } catch (Exception e) {
            String error = "Error: " + e.getMessage();
            exchange.sendResponseHeaders(500, error.length());
            OutputStream os = exchange.getResponseBody();
            os.write(error.getBytes(StandardCharsets.UTF_8));
            os.close();
        }
    }
}
`;
}

function generateKotlinLambdaMockServer(analysis: AnalysisResult): string {
  return `package ${analysis.packageName}.pact

import com.amazonaws.services.lambda.runtime.Context
import com.amazonaws.services.lambda.runtime.RequestHandler
import com.sun.net.httpserver.HttpServer
import com.sun.net.httpserver.HttpExchange
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets

/**
 * Mock HTTP Server wrapper for Lambda handlers
 * Wraps a Lambda RequestHandler to expose it as an HTTP endpoint for Pact testing.
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
class MockHttpServer(private val handler: RequestHandler<Any, Any>) {
    
    private val server: HttpServer = HttpServer.create(InetSocketAddress(0), 0)
    val port: Int get() = server.address.port

    init {
        server.createContext("/") { exchange -> handleRequest(exchange) }
    }

    fun start() {
        server.start()
    }

    fun stop() {
        server.stop(0)
    }

    private fun handleRequest(exchange: HttpExchange) {
        try {
            val requestBody = exchange.requestBody.readAllBytes().toString(StandardCharsets.UTF_8)
            val context = MockLambdaContext()
            val response = handler.handleRequest(requestBody, context)
            
            val responseBody = response?.toString() ?: ""
            exchange.sendResponseHeaders(200, responseBody.length.toLong())
            exchange.responseBody.use { os ->
                os.write(responseBody.toByteArray(StandardCharsets.UTF_8))
            }
        } catch (e: Exception) {
            val error = "Error: \${e.message}"
            exchange.sendResponseHeaders(500, error.length.toLong())
            exchange.responseBody.use { os ->
                os.write(error.toByteArray(StandardCharsets.UTF_8))
            }
        }
    }
}
`;
}

function generateJavaCloudFunctionMockServer(analysis: AnalysisResult): string {
  return `package ${analysis.packageName}.pact;

import com.google.cloud.functions.HttpFunction;
import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpExchange;

import java.io.IOException;
import java.net.InetSocketAddress;

/**
 * Mock HTTP Server wrapper for GCP Cloud Functions
 * Wraps a Cloud Function to expose it as an HTTP endpoint for Pact testing.
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
public class MockHttpServer {
    
    private final HttpServer server;
    private final HttpFunction function;
    private int port;

    public MockHttpServer(HttpFunction function) {
        this.function = function;
        try {
            this.server = HttpServer.create(new InetSocketAddress(0), 0);
            this.port = server.getAddress().getPort();
            this.server.createContext("/", this::handleRequest);
        } catch (IOException e) {
            throw new RuntimeException("Failed to create mock server", e);
        }
    }

    public void start() {
        server.start();
    }

    public void stop() {
        server.stop(0);
    }

    public int getPort() {
        return port;
    }

    private void handleRequest(HttpExchange exchange) throws IOException {
        // Wrap HttpExchange to Cloud Functions request/response
        MockHttpRequest request = new MockHttpRequest(exchange);
        MockHttpResponse response = new MockHttpResponse(exchange);
        
        try {
            function.service(request, response);
        } catch (Exception e) {
            exchange.sendResponseHeaders(500, 0);
        }
    }
}
`;
}

function generateKotlinCloudFunctionMockServer(analysis: AnalysisResult): string {
  return `package ${analysis.packageName}.pact

import com.google.cloud.functions.HttpFunction
import com.sun.net.httpserver.HttpServer
import com.sun.net.httpserver.HttpExchange
import java.net.InetSocketAddress

/**
 * Mock HTTP Server wrapper for GCP Cloud Functions
 * Wraps a Cloud Function to expose it as an HTTP endpoint for Pact testing.
 * 
 * Generated by pact-contract-mcp
 * Author: Sakthikannan Subramanian
 */
class MockHttpServer(private val function: HttpFunction) {
    
    private val server: HttpServer = HttpServer.create(InetSocketAddress(0), 0)
    val port: Int get() = server.address.port

    init {
        server.createContext("/") { exchange -> handleRequest(exchange) }
    }

    fun start() {
        server.start()
    }

    fun stop() {
        server.stop(0)
    }

    private fun handleRequest(exchange: HttpExchange) {
        val request = MockHttpRequest(exchange)
        val response = MockHttpResponse(exchange)
        
        try {
            function.service(request, response)
        } catch (e: Exception) {
            exchange.sendResponseHeaders(500, 0)
        }
    }
}
`;
}

async function updateBuildFile(
  repositoryPath: string,
  analysis: AnalysisResult
): Promise<BuildUpdateInfo> {
  const result: BuildUpdateInfo = {
    file: "",
    addedDependencies: [],
    addedTasks: [],
    addedConfigurations: [],
  };

  if (analysis.buildTool === "gradle") {
    const gradleKts = path.join(repositoryPath, "build.gradle.kts");
    const gradleGroovy = path.join(repositoryPath, "build.gradle");
    
    const isKts = await fileExists(gradleKts);
    const buildFile = isKts ? gradleKts : gradleGroovy;
    
    if (await fileExists(buildFile)) {
      result.file = buildFile;
      const content = await fs.readFile(buildFile, "utf-8");
      const updates = isKts
        ? generateGradleKtsUpdates(analysis)
        : generateGradleGroovyUpdates(analysis);
      
      // Append updates to build file
      await fs.appendFile(buildFile, "\n\n" + updates.content, "utf-8");
      result.addedDependencies = updates.dependencies;
      result.addedTasks = updates.tasks;
      result.addedConfigurations = updates.configurations;
    }
  } else if (analysis.buildTool === "maven") {
    const pomFile = path.join(repositoryPath, "pom.xml");
    if (await fileExists(pomFile)) {
      result.file = pomFile;
      // For Maven, we'll create a separate pom additions file
      const additionsFile = path.join(repositoryPath, "pact-dependencies.xml");
      await fs.writeFile(additionsFile, generateMavenUpdates(analysis), "utf-8");
      result.addedDependencies = [
        "au.com.dius.pact.consumer:junit5",
        "au.com.dius.pact.provider:junit5",
      ];
    }
  }

  return result;
}

function generateGradleKtsUpdates(analysis: AnalysisResult): {
  content: string;
  dependencies: string[];
  tasks: string[];
  configurations: string[];
} {
  const pactVersion = "4.6.5";
  
  return {
    content: `
// =====================================
// Pact Contract Testing Configuration
// Generated by pact-contract-mcp
// Author: Sakthikannan Subramanian
// =====================================

val pactVersion = "${pactVersion}"

dependencies {
    testImplementation("au.com.dius.pact.consumer:junit5:\$pactVersion")
    testImplementation("au.com.dius.pact.provider:junit5:\$pactVersion")
}

// Pact configuration
pact {
    broker {
        pactBrokerUrl = System.getenv("PACT_BROKER_URL") ?: "http://localhost:9292"
        pactBrokerToken = System.getenv("PACT_BROKER_TOKEN") ?: ""
    }
    publish {
        pactDirectory = "\$buildDir/pacts"
        consumerVersion = project.version.toString()
    }
}

// Custom task to run only Pact tests
tasks.register<Test>("runContractTests") {
    description = "Run Pact contract tests"
    group = "verification"
    
    useJUnitPlatform {
        includeTags("pact")
    }
    
    include("**/*PactTest*")
    
    systemProperty("pact.rootDir", "\$buildDir/pacts")
    systemProperty("pact.verifier.publishResults", "true")
    
    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = true
    }
}

// Task to publish pacts to broker
tasks.register("publishPacts") {
    description = "Publish Pact contracts to broker"
    group = "pact"
    dependsOn("runContractTests")
    
    doLast {
        println("Publishing pacts to broker...")
        // Pacts are published via the pact plugin
    }
}
`,
    dependencies: [
      "au.com.dius.pact.consumer:junit5",
      "au.com.dius.pact.provider:junit5",
    ],
    tasks: ["runContractTests", "publishPacts"],
    configurations: ["pact.broker", "pact.publish"],
  };
}

function generateGradleGroovyUpdates(analysis: AnalysisResult): {
  content: string;
  dependencies: string[];
  tasks: string[];
  configurations: string[];
} {
  const pactVersion = "4.6.5";
  
  return {
    content: `
// =====================================
// Pact Contract Testing Configuration
// Generated by pact-contract-mcp
// Author: Sakthikannan Subramanian
// =====================================

ext {
    pactVersion = '${pactVersion}'
}

dependencies {
    testImplementation "au.com.dius.pact.consumer:junit5:\${pactVersion}"
    testImplementation "au.com.dius.pact.provider:junit5:\${pactVersion}"
}

// Pact configuration
pact {
    broker {
        pactBrokerUrl = System.getenv('PACT_BROKER_URL') ?: 'http://localhost:9292'
        pactBrokerToken = System.getenv('PACT_BROKER_TOKEN') ?: ''
    }
    publish {
        pactDirectory = "\$buildDir/pacts"
        consumerVersion = project.version
    }
}

// Custom task to run only Pact tests
task runContractTests(type: Test) {
    description = 'Run Pact contract tests'
    group = 'verification'
    
    useJUnitPlatform {
        includeTags 'pact'
    }
    
    include '**/*PactTest*'
    
    systemProperty 'pact.rootDir', "\$buildDir/pacts"
    systemProperty 'pact.verifier.publishResults', 'true'
    
    testLogging {
        events 'passed', 'skipped', 'failed'
        showStandardStreams = true
    }
}

// Task to publish pacts to broker
task publishPacts {
    description = 'Publish Pact contracts to broker'
    group = 'pact'
    dependsOn runContractTests
    
    doLast {
        println 'Publishing pacts to broker...'
    }
}
`,
    dependencies: [
      "au.com.dius.pact.consumer:junit5",
      "au.com.dius.pact.provider:junit5",
    ],
    tasks: ["runContractTests", "publishPacts"],
    configurations: ["pact.broker", "pact.publish"],
  };
}

function generateMavenUpdates(analysis: AnalysisResult): string {
  const pactVersion = "4.6.5";
  
  return `<?xml version="1.0" encoding="UTF-8"?>
<!--
  Pact Contract Testing Dependencies
  Add these to your pom.xml
  
  Generated by pact-contract-mcp
  Author: Sakthikannan Subramanian
-->
<dependencies>
    <!-- Pact Consumer Testing -->
    <dependency>
        <groupId>au.com.dius.pact.consumer</groupId>
        <artifactId>junit5</artifactId>
        <version>${pactVersion}</version>
        <scope>test</scope>
    </dependency>
    
    <!-- Pact Provider Testing -->
    <dependency>
        <groupId>au.com.dius.pact.provider</groupId>
        <artifactId>junit5</artifactId>
        <version>${pactVersion}</version>
        <scope>test</scope>
    </dependency>
</dependencies>

<!-- Add this plugin to your build/plugins section -->
<plugin>
    <groupId>au.com.dius.pact.provider</groupId>
    <artifactId>maven</artifactId>
    <version>${pactVersion}</version>
    <configuration>
        <pactBrokerUrl>\${env.PACT_BROKER_URL}</pactBrokerUrl>
        <pactBrokerToken>\${env.PACT_BROKER_TOKEN}</pactBrokerToken>
    </configuration>
</plugin>
`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function generateCliCommand(analysis: AnalysisResult): string {
  if (analysis.buildTool === "gradle") {
    return "./gradlew runContractTests";
  } else if (analysis.buildTool === "maven") {
    return "mvn test -Dtest=*PactTest";
  }
  return "Run your Pact tests using your build tool";
}

function generateNextSteps(
  analysis: AnalysisResult,
  contractStructure: ContractStructure
): string[] {
  const steps: string[] = [
    "1. Review the generated Pact test classes and customize the request/response bodies",
    "2. Add appropriate assertions to verify the expected behavior",
    "3. Run the contract tests using: " + generateCliCommand(analysis),
  ];

  if (contractStructure.consumerContracts.length > 0) {
    steps.push(
      "4. Consumer tests will generate pact files in build/pacts directory"
    );
  }

  if (contractStructure.providerContracts.length > 0) {
    steps.push(
      "5. Provider tests will verify against pact files - ensure they exist first"
    );
  }

  steps.push(
    "6. Set up a Pact Broker using 'setup_local_broker' tool for contract sharing",
    "7. Configure remote broker using 'config_remote_broker' for CI/CD integration"
  );

  return steps;
}

// Utility functions
function sanitizeClassName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]/g, "")
    .replace(/^[0-9]/, "_$&");
}

function toCamelCase(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/^[A-Z]/, (chr) => chr.toLowerCase())
    .replace(/[^a-zA-Z0-9]/g, "");
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
