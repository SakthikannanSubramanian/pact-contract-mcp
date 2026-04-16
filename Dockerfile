# Use Node.js LTS version
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port (Railway/Render will set PORT env variable)
EXPOSE ${PORT:-3001}

# Start server in HTTP mode
CMD ["node", "dist/index.js", "--http", "--port", "${PORT:-3001}"]
