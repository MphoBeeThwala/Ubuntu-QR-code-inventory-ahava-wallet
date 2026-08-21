# Documentation

## API Documentation

- OpenAPI Specification: docs/api/openapi.yaml
- Postman Collection: docs/api/Ubuntu-Pay.postman_collection.json
- API Guide: docs/api/README.md

## Running Documentation

### Swagger UI (Docker)

Run: docker-compose -f docs/api/docker-compose.yml up
Access at: http://localhost:8081

### Redoc (Node.js)

Run: cd docs/api && npm install && npm run serve
Access at: http://localhost:8082

## Standards

- All monetary values: BIGINT cents (never floats)
- All examples: integer cents
- All endpoints: include auth requirements
- All errors: documented
- All rate limits: documented
