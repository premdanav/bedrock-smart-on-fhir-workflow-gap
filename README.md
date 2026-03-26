# Cerner JWKS POC

This project is a small Node.js and Express proof of concept for calling Cerner FHIR APIs using SMART Backend Services authentication.

The application does three core things:

1. Discovers Cerner's SMART configuration from the FHIR base URL.
2. Builds a signed JWT client assertion using your private key.
3. Exchanges that assertion for an access token and uses the token to call FHIR endpoints.

## Project Structure

```text
cerner-jwks-poc/
├── keys/
│   ├── private.pem
│   └── public.pem
├── src/
│   ├── config/
│   │   └── env.js
│   ├── constants/
│   │   └── cerner.js
│   ├── services/
│   │   ├── smartDiscovery.service.js
│   │   ├── jwtAssertion.service.js
│   │   ├── token.service.js
│   │   └── fhir.service.js
│   ├── routes/
│   │   ├── health.routes.js
│   │   ├── auth.routes.js
│   │   └── fhir.routes.js
│   ├── app.js
│   └── server.js
├── .env
├── .gitignore
└── package.json
```

## How The Application Works

### 1. Application startup

When you start the app with `npm start` or `npm run dev`, the entry point is `src/server.js`.

- `src/server.js` imports the Express app from `src/app.js`
- it imports environment configuration from `src/config/env.js`
- it starts the server on the port defined by `PORT`

At startup, `dotenv` loads environment variables from `.env`, so the app can read Cerner credentials, the FHIR base URL, scope, key ID, and private key path.

### 2. Environment configuration

`src/config/env.js` centralizes all runtime configuration.

It exposes:

- `port`: server port
- `nodeEnv`: environment name
- `cernerClientId`: the OAuth client ID registered with Cerner
- `cernerTenantId`: your Cerner tenant ID
- `cernerFhirBaseUrl`: base URL for FHIR requests
- `cernerScope`: SMART backend scopes to request
- `cernerJwtKid`: key ID placed in the JWT header
- `cernerPrivateKeyPath`: file path to the PEM private key used for signing

This file acts as the single source of truth for runtime configuration, so the rest of the application does not read `process.env` directly.

### 3. Cerner constant generation

`src/constants/cerner.js` builds the SMART discovery URL from the FHIR base URL:

- `smartConfigUrl = <FHIR_BASE_URL>/.well-known/smart-configuration`

This lets the application dynamically discover the correct token endpoint instead of hardcoding it.

### 4. Express app and routing

`src/app.js` creates the Express app and mounts four route groups:

- `/health`
- `/auth`
- `/fhir`
- `/workflow-insights`

It also registers a global error handler. If any route or service throws an error, the error middleware tries to return:

- the downstream HTTP status from Cerner if available
- the downstream response body if available
- otherwise a generic `500` error

This is useful because Cerner token or FHIR errors usually come back through Axios as `error.response`.

### 5. Health endpoint

`src/routes/health.routes.js` exposes:

- `GET /health`

This is a simple readiness check. It returns a JSON payload confirming that the service is running.

### 6. SMART discovery flow

`src/services/smartDiscovery.service.js` is responsible for fetching Cerner's SMART metadata.

When called, it sends an HTTP GET request to:

```text
<CERNER_FHIR_BASE_URL>/.well-known/smart-configuration
```

Cerner responds with a SMART configuration document that typically includes:

- `token_endpoint`
- authorization metadata
- supported grant types
- supported signing algorithms

In this project, the most important field is `token_endpoint`, because the app needs that URL to request an access token.

### 7. JWT client assertion generation

`src/services/jwtAssertion.service.js` generates the signed client assertion JWT required by SMART Backend Services.

This process works like this:

1. Read the private key from the file path in `CERNER_PRIVATE_KEY_PATH`.
2. Import the PEM key using `jose.importPKCS8`.
3. Build a JWT with `jose.SignJWT`.
4. Sign the JWT using the `RS384` algorithm.

The JWT contains:

- header:
  - `alg: RS384`
  - `kid: <CERNER_JWT_KID>`
  - `typ: JWT`
- claims:
  - `iss`: Cerner client ID
  - `sub`: Cerner client ID
  - `aud`: discovered token endpoint
  - `jti`: random UUID for uniqueness
  - `iat`: issued-at time
  - `exp`: expiration time, 5 minutes after issuance

This JWT is not the access token. It is a signed proof that your backend service owns the private key associated with the registered public key.

### 8. Access token flow

`src/services/token.service.js` handles OAuth token retrieval.

Its `getAccessToken()` function works in this order:

1. Check whether a token is already cached in memory.
2. If a cached token exists and is not close to expiring, return it immediately.
3. Otherwise fetch SMART configuration from Cerner.
4. Read `token_endpoint` from the SMART config.
5. Build a signed client assertion JWT.
6. Submit a `client_credentials` token request to the token endpoint.
7. Store the returned access token in memory with an expiry timestamp.
8. Return the token string.

The token request is sent as `application/x-www-form-urlencoded` with:

- `grant_type=client_credentials`
- `scope=<CERNER_SCOPE>`
- `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer`
- `client_assertion=<signed JWT>`

### 9. Token caching

The token service stores two module-level variables:

- `cachedToken`
- `cachedTokenExpiry`

This means the app does not request a new access token for every FHIR request.

Instead, it reuses the token until it is within 30 seconds of expiration. This reduces unnecessary token calls and improves performance.

Important limitation:

- the cache is in memory only
- restarting the Node process clears the cache
- this cache is local to one server instance

For a production deployment with multiple instances, you would likely use a shared token strategy or let each instance maintain its own short-lived cache.

### 10. FHIR service flow

`src/services/fhir.service.js` is responsible for calling Cerner FHIR APIs with the bearer token.

Each FHIR method follows the same pattern:

1. Call `getAccessToken()`
2. Receive a valid bearer token
3. Send an Axios request to the FHIR endpoint
4. Include `Authorization: Bearer <token>`
5. Set `Accept: application/fhir+json`
6. Return the Cerner response body

Implemented methods:

- `getPatientById(patientId)`
  - calls `GET <FHIR_BASE_URL>/Patient/{id}`
- `searchObservationsByPatient(patientId)`
  - calls `GET <FHIR_BASE_URL>/Observation?patient={id}`
- `searchPatients(params)`
  - builds a query string from the incoming search filters
  - calls `GET <FHIR_BASE_URL>/Patient?...`

### 11. Route behavior

#### `GET /auth/debug-token`

This route calls `getAccessToken()` and returns a preview of the generated access token.

Purpose:

- confirms the SMART discovery and token exchange are working
- avoids returning the full token in the response body

Current response behavior:

- `ok: true`
- `tokenPreview: "<first 20 chars>..."`

#### `GET /fhir/patient/:id`

This route fetches one Patient resource by ID.

Flow:

1. route receives `:id`
2. route calls `getPatientById(id)`
3. service obtains token
4. service calls Cerner Patient endpoint
5. JSON FHIR resource is returned to the client

#### `GET /fhir/patient/:id/observations`

This route fetches Observation resources for a patient.

Flow:

1. route receives patient ID
2. route calls `searchObservationsByPatient(id)`
3. service obtains token
4. service requests Observation search with `?patient=<id>`
5. Cerner Bundle response is returned

#### `GET /fhir/patient-search`

This route performs a Patient search using optional query parameters.

Supported incoming query parameters:

- `family`
- `given`
- `birthdate`
- `identifier`
- `phone`
- `email`

Only provided parameters are forwarded to Cerner. Empty values are ignored.

Example:

```http
GET /fhir/patient-search?family=Smith&given=John&birthdate=1990-01-01
```

The route converts those values into a query string and calls the Cerner Patient search endpoint.

## End-To-End Request Lifecycle

Here is the complete flow for a typical FHIR request such as `GET /fhir/patient/123`:

1. Client calls your Express route.
2. Route calls a function in `fhir.service.js`.
3. FHIR service asks `token.service.js` for an access token.
4. Token service checks the in-memory cache.
5. If no valid token exists:
6. Token service calls SMART discovery.
7. SMART discovery returns the Cerner `token_endpoint`.
8. Token service asks `jwtAssertion.service.js` to build a signed client assertion.
9. JWT service reads your private key and signs a JWT.
10. Token service posts the JWT to Cerner's token endpoint.
11. Cerner returns an access token.
12. Token service caches and returns the token.
13. FHIR service calls the requested FHIR endpoint with `Authorization: Bearer <token>`.
14. Cerner returns the FHIR resource or Bundle.
15. Express sends that JSON back to the caller.

## Environment Variables

The app expects the following values in `.env`:

```env
PORT=4000
NODE_ENV=development
CERNER_CLIENT_ID=your-client-id
CERNER_TENANT_ID=your-tenant-id
CERNER_FHIR_BASE_URL=https://fhir-ehr-code.cerner.com/r4/<tenant-id>
CERNER_SCOPE=system/Patient.read system/Observation.read
CERNER_JWT_KID=cerner-poc-key-1
CERNER_PRIVATE_KEY_PATH=./keys/private.pem
AWS_REGION=us-east-1
BEDROCK_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0
BEDROCK_TIMEOUT_MS=12000
BEDROCK_MAX_TOKENS=700
WORKFLOW_TOKEN_SALT=local-demo-salt
```

Notes:

- `CERNER_CLIENT_ID` must match the Cerner application registration
- `CERNER_JWT_KID` should match the key identifier Cerner expects
- `CERNER_PRIVATE_KEY_PATH` must point to the private key corresponding to the public key registered with Cerner
- `CERNER_SCOPE` controls which FHIR operations the token can perform
- `AWS_REGION` and `BEDROCK_MODEL_ID` enable the workflow insights feature's Bedrock review step
- `WORKFLOW_TOKEN_SALT` strengthens the one-way patient token used in workflow responses

## Running The Project

Install dependencies:

```bash
npm install
```

Start in development mode:

```bash
npm run dev
```

Start normally:

```bash
npm start
```

## Example Requests

Health check:

```bash
curl http://localhost:4000/health
```

Debug token:

```bash
curl http://localhost:4000/auth/debug-token
```

Fetch patient by ID:

```bash
curl http://localhost:4000/fhir/patient/12724066
```

Fetch observations for a patient:

```bash
curl http://localhost:4000/fhir/patient/12724066/observations
```

Search patients:

```bash
curl "http://localhost:4000/fhir/patient-search?family=Smith&given=John"
```

Workflow insights:

```bash
curl http://localhost:4000/workflow-insights/12724066
```

## Important Security Notes

- Never commit real private keys to source control.
- Never expose your full access token in logs or API responses.
- `.env` should remain private and should not be committed.
- `keys/*.pem` should be added to `.gitignore` if you will store real keys locally.

## Current Limitations

- no JWKS endpoint is exposed yet from this app
- token cache is in memory only
- no request validation layer exists
- no unit or integration tests are present yet
- Bedrock model support in this POC is limited to Anthropic Claude and Amazon Nova IDs

## Summary

This application is a backend-service-style Cerner integration starter.

Its responsibility is:

- discover Cerner OAuth metadata
- create a signed JWT assertion using your private key
- exchange that assertion for an OAuth access token
- call Cerner FHIR APIs with that token

If the Cerner app registration, key pair, scopes, tenant-specific base URL, and optional Bedrock configuration are correct, the app can act as a machine-to-machine client for structured FHIR access and workflow-gap decision support.

## Clinical Workflow Gap Detector

The project now includes a PHI-minimized workflow review endpoint:

```text
GET /workflow-insights/:patientId
```

It reuses the existing SMART on FHIR token flow, fetches `Patient` and `Observation`, normalizes those resources into a compact internal shape, de-identifies the payload, runs deterministic workflow checks, and then optionally asks Bedrock for additional workflow-gap phrasing using only de-identified signals.

### Resources fetched

- Patient
- Observation

### Safety controls

- raw FHIR bundles are not logged
- prompts and Bedrock request bodies are not logged
- dates sent to Bedrock are reduced to month precision
- age is reduced to an age band
- patient identifiers are converted to a one-way `patient_token`
- Bedrock output is sanitized and framed as decision support only

### Running locally

1. Fill in `.env` with the Cerner values above.
2. Add AWS credentials through environment variables or an attached IAM role if you want Bedrock enabled.
3. Start the server with `npm run dev`.
4. Call `GET /workflow-insights/:patientId`.

If `AWS_REGION` or `BEDROCK_MODEL_ID` is missing, the endpoint still returns deterministic workflow findings and adds a safety note that Bedrock review was unavailable.

### Sample response

```json
{
  "success": true,
  "data": {
    "patient_token": "PT-1234567890",
    "generated_at": "2026-03-26T18:00:00.000Z",
    "result": {
      "workflow_gaps": [
        {
          "title": "Diabetes follow-up may be overdue",
          "priority": "high",
          "evidence": [
            "HbA1c 8.2 % in 2026-01",
            "No encounter found within 90 days after abnormal result"
          ],
          "suggested_review_action": "Provider to review need for follow-up encounter"
        }
      ],
      "notable_trends": [
        "Persistently elevated glycemic marker"
      ],
      "safety_notes": [
        "Decision support only. Requires provider review."
      ]
    }
  }
}
```
