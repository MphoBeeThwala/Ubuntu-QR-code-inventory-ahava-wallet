FROM node:20-alpine

WORKDIR /app

# Copy shared packages
COPY packages/ ./packages/

# Copy this service
COPY services/api-gateway/ ./

# Install dependencies
RUN npm install --no-optional

# Build
RUN npm run build

# Expose port
EXPOSE 6000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:6000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start
CMD ["npm", "start"]
