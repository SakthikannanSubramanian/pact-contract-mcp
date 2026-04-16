# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies after build to reduce image size
RUN npm prune --production

# Expose port (Railway/Render will set PORT env variable)
EXPOSE ${PORT:-3001}

# Start server in HTTP mode
CMD ["node", "dist/index.js", "--http", "--port", "${PORT:-3001}"]
