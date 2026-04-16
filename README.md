# Pact Contract MCP Server

An MCP (Model Context Protocol) server for automating Pact contract test creation and execution for Spring Boot, AWS Lambda, and GCP Cloud Functions projects.

**Author:** Sakthikannan Subramanian

## Overview

This MCP server provides tools to automatically:
- Analyze your repository to detect language, framework, and external dependencies
- Generate contract classifications (Consumer/Provider)
- Scaffold Pact test classes for your services
- Set up a local Pact Broker with Docker
- Configure remote Pact Broker for CI/CD environments

## Features

- **Multi-Framework Support**: Spring Boot, AWS Lambda, GCP Cloud Functions
- **Language Support**: Java and Kotlin
- **Build Tool Support**: Gradle (Groovy & Kotlin DSL) and Maven
- **HTTP Client Detection**: RestTemplate, WebClient, Feign, OkHttp
- **Cloud SDK Detection**: AWS SDK, GCP SDK
- **Automated Test Generation**: Consumer and Provider Pact tests
- **Docker Integration**: Local Pact Broker setup
- **CI/CD Ready**: GitHub Actions workflow generation

## Installation

### Prerequisites

- Node.js 18+
- npm or yarn

### Install Dependencies

```bash
cd pact-contract-mcp
npm install
```

### Build the Project

```bash
npm run build
```

## Usage

### Running the Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

### Available Tools

#### 1. `analyze_repository`

Scans your repository to identify:
- Implementation language (Java/Kotlin)
- Framework (Spring Boot/Lambda/Cloud Functions)
- Build tool (Gradle/Maven)
- HTTP clients (RestTemplate, WebClient, Feign)
- Cloud SDK dependencies (AWS, GCP)
- Service endpoints and REST controllers

**Input:**
```json
{
  "repositoryPath": "/path/to/your/project"
}
```

#### 2. `generate_contract_structure`

Creates a classification of services:
- **Internal Services**: REST controllers, Lambda handlers, Cloud Functions you expose
- **External Services**: Services you consume via Feign clients, REST clients, Cloud SDKs
- **Consumer Contracts**: Contracts where your service is the consumer
- **Provider Contracts**: Contracts where your service is the provider

**Input:**
```json
{
  "repositoryPath": "/path/to/your/project",
  "analysisResult": {} // Optional, from analyze_repository
}
```

#### 3. `scaffold_pact_tests`

Generates complete Pact test scaffolding:
- Creates `src/test/java/.../pact/` directory structure
- Generates Consumer Pact test classes
- Generates Provider Pact test classes
- Creates mock HTTP wrappers for Lambda/Cloud Functions
- Updates `build.gradle` or `pom.xml` with Pact dependencies
- Adds `runContractTests` Gradle task

**Input:**
```json
{
  "repositoryPath": "/path/to/your/project",
  "contractStructure": {} // Optional, from generate_contract_structure
}
```

**After execution, run:**
```bash
# Gradle
./gradlew runContractTests

# Maven
mvn test -Dtest=*PactTest
```

#### 4. `setup_local_broker`

Generates Docker Compose configuration for a local Pact Broker:
- PostgreSQL database for persistence
- Pact Broker with health checks
- Volume mounts for data persistence
- Environment configuration

**Input:**
```json
{
  "repositoryPath": "/path/to/your/project",
  "brokerPort": 9292,
  "postgresPort": 5432
}
```

**Start the broker:**
```bash
docker-compose -f docker-compose.pact.yml up -d
```

**Access the broker:** http://localhost:9292

#### 5. `config_remote_broker`

Configures remote Pact Broker integration:
- Creates `pact.properties` for Java configuration
- Creates Gradle configuration files
- Generates GitHub Actions workflow

**Input:**
```json
{
  "repositoryPath": "/path/to/your/project",
  "configType": "both", // "properties", "gradle", or "both"
  "brokerUrl": "https://your-pact-broker.example.com"
}
```

## Configuring Remote Broker Details

### Environment Variables

Set these environment variables in your CI/CD environment:

```bash
export PACT_BROKER_URL=https://your-pact-broker.example.com
export PACT_BROKER_TOKEN=your-api-token
```

### For Pactflow Users

1. Sign up at [Pactflow](https://pactflow.io)
2. Create an API token: Settings → API Tokens → Create Token
3. Copy your broker URL from the dashboard
4. Set up repository secrets:
   - `PACT_BROKER_URL`: Your Pactflow URL
   - `PACT_BROKER_TOKEN`: Your API token

### For Self-Hosted Pact Broker

1. Update `pact.properties`:
   ```properties
   pactbroker.host=your-broker.example.com
   pactbroker.scheme=https
   pactbroker.auth.token=${PACT_BROKER_TOKEN}
   ```

2. Or set in Gradle:
   ```groovy
   pact {
       broker {
           pactBrokerUrl = 'https://your-broker.example.com'
           pactBrokerToken = System.getenv('PACT_BROKER_TOKEN')
       }
   }
   ```

## Integration with VS Code

Add to your `.vscode/mcp.json`:

```json
{
  "servers": {
    "pact-contract-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/pact-contract-mcp/dist/index.js"]
    }
  }
}
```

## Development

### Project Structure

```
pact-contract-mcp/
├── src/
│   ├── index.ts              # Main MCP server entry point
│   ├── types.ts              # TypeScript type definitions
│   └── tools/
│       ├── analyzeRepository.ts
│       ├── generateContractStructure.ts
│       ├── scaffoldPactTests.ts
│       ├── setupLocalBroker.ts
│       └── configRemoteBroker.ts
├── package.json
├── tsconfig.json
└── README.md
```

### Building

```bash
npm run build    # Compile TypeScript
npm run watch    # Watch mode
npm run clean    # Clean dist folder
```

### Running Tests

```bash
npm test
```

## Troubleshooting

### Common Issues

1. **"Repository path does not exist"**
   - Ensure you provide an absolute path to your project
   - Verify the directory exists and is readable

2. **No dependencies detected**
   - Check that your `build.gradle` or `pom.xml` is in the repository root
   - Verify the file syntax is valid

3. **Generated tests don't compile**
   - Review the generated test files and add proper request/response bodies
   - Ensure all required dependencies are in your build file

### Debug Mode

Set the `DEBUG` environment variable for verbose logging:

```bash
DEBUG=pact-mcp:* npm run dev
```

## Contributing

Contributions are welcome! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Pact Foundation](https://pact.io) for the contract testing framework
- [Model Context Protocol](https://modelcontextprotocol.io) for the MCP specification
