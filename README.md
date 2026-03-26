# Clinical Workflow Gap Detector

This backend is a Node.js + Express proof of concept that connects to Cerner with SMART Backend Services, reads structured FHIR data, and optionally uses AWS Bedrock to generate provider-facing workflow review output.

The current simplified version focuses on:

- `Patient`
- `Observation`

It is designed for demo use and showcases how to:

- fetch structured clinical data from Cerner
- normalize it into a compact internal format
- de-identify/minimize it before any Bedrock call
- run deterministic workflow checks
- optionally use Bedrock for additional workflow-review phrasing
- expose a small dashboard from the backend

## What The App Does

The app provides:

- Cerner SMART backend authentication
- FHIR read endpoints for Patient and Observation
- `GET /workflow-insights/:patientId`
- a simple frontend dashboard served from `/`

The workflow endpoint returns decision-support output only. It is not diagnosis, treatment, or prescribing logic.

## Current Flow

```text
Cerner SMART auth
-> Patient + Observation fetch
-> FHIR normalization
-> de-identification
-> deterministic workflow rules
-> optional Bedrock call
-> structured provider-review response
```

## Project Structure

```text
backend/
├── keys/
├── src/
│   ├── app.js
│   ├── server.js
│   ├── config/
│   │   └── env.js
│   ├── constants/
│   │   └── cerner.js
│   ├── controllers/
│   │   └── workflow.controller.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── fhir.routes.js
│   │   ├── health.routes.js
│   │   └── workflow.routes.js
│   ├── services/
│   │   ├── bedrock.service.js
│   │   ├── deIdentification.service.js
│   │   ├── fhir.service.js
│   │   ├── fhirNormalizer.service.js
│   │   ├── jwtAssertion.service.js
│   │   ├── smartDiscovery.service.js
│   │   ├── token.service.js
│   │   ├── workflow.service.js
│   │   └── workflowRules.service.js
│   └── utils/
│       ├── errors.js
│       ├── logger.js
│       └── workflowPromptBuilder.js
├── .env
├── .env.example
├── package.json
└── README.md

frontend/
├── index.html
├── styles.css
└── app.js
```

## Environment Variables

Create `backend/.env` with:

```env
PORT=4000
NODE_ENV=development
LOG_LEVEL=info

CERNER_CLIENT_ID=your-client-id
CERNER_TENANT_ID=your-tenant-id
CERNER_FHIR_BASE_URL=https://fhir-ehr-code.cerner.com/r4/<tenant-id>
CERNER_SCOPE=system/Patient.read system/Observation.read
CERNER_JWT_KID=your-key-id
CERNER_PRIVATE_KEY_PATH=./keys/private.pem
FHIR_REQUEST_TIMEOUT_MS=10000

AWS_REGION=
BEDROCK_MODEL_ID=
BEDROCK_TIMEOUT_MS=12000
BEDROCK_MAX_TOKENS=700
BEDROCK_DEBUG_LOG_RESPONSE=false
BEDROCK_DEBUG_LOG_RAW_RESPONSE=false

WORKFLOW_TOKEN_SALT=local-demo-salt
```

Notes:

- `CERNER_SCOPE` is intentionally simplified to `Patient.read` and `Observation.read`
- leave `AWS_REGION` and `BEDROCK_MODEL_ID` empty if you want deterministic-only mode
- Bedrock uses normal AWS SDK credential resolution, so credentials must come from env vars, AWS CLI config, or an IAM role

## Running Locally

Install dependencies:

```bash
cd backend
npm install
```

Start the backend:

```bash
npm run dev
```

Open the dashboard:

```text
http://localhost:4000
```

## API Endpoints

Health check:

```bash
curl http://localhost:4000/health
```

Debug token:

```bash
curl http://localhost:4000/auth/debug-token
```

Fetch patient:

```bash
curl http://localhost:4000/fhir/patient/12724066
```

Fetch patient observations:

```bash
curl http://localhost:4000/fhir/patient/12724066/observations
```

Workflow insights:

```bash
curl http://localhost:4000/workflow-insights/12724066
```

## Workflow Insights Response

Example response:

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
            "High HbA1c result found in recent observation history"
          ],
          "suggested_review_action": "Provider to review whether follow-up is needed"
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

## Bedrock Behavior

Bedrock is optional in this app.

If Bedrock is configured:

- the backend builds a de-identified prompt
- sends only minimized structured signals
- parses the model output
- merges it with deterministic workflow findings

If Bedrock is not configured or fails:

- the endpoint still returns a valid response
- deterministic workflow findings remain available
- the app falls back safely

## Frontend Dashboard

The backend serves the frontend files from the sibling `frontend/` folder.

The dashboard lets you:

- enter a patient ID
- call the workflow endpoint
- view workflow gaps
- view notable trends
- view safety notes

It is intentionally lightweight and meant for showcasing the backend behavior.

## Important Safety Notes

- raw FHIR bundles should not be logged
- prompts and Bedrock request bodies should not be logged
- direct patient identifiers should not be sent to Bedrock
- output is framed as decision support only
- provider review is always required

## Current Limitations

- no automated unit or integration test suite yet
- token cache is in memory only
- the simplified workflow mode currently depends only on Patient + Observation
- Bedrock model support is currently limited to Anthropic and Amazon Nova model formats
- frontend is a lightweight demo, not a production UI

## Why This POC Exists

This app demonstrates a practical hybrid pattern:

- structured clinical data stays the source of truth
- deterministic rules catch obvious workflow gaps
- Bedrock can help turn safe structured signals into clearer review output
- the system avoids sending raw charts or direct identifiers to the model

That makes it useful as a demo for workflow intelligence, PHI minimization, and Bedrock-assisted provider support.
