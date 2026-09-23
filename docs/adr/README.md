# Architecture Decision Records

| #                                          | Title                                                        | Status               |
| ------------------------------------------ | ------------------------------------------------------------ | -------------------- |
| [0001](0001-four-entity-domain-model.md)   | Four-entity domain model                                     | Accepted at GATE 1   |
| [0002](0002-issue-fingerprint.md)          | Issue fingerprint tuple and versioning                       | Accepted at GATE 1   |
| [0003](0003-identity-key-precedence.md)    | Identity-key precedence order and merge policy               | Accepted at GATE 1   |
| [0004](0004-risk-scoring-function.md)      | Risk scoring function and default weights                    | Accepted at GATE 1   |
| [0005](0005-read-only-principle.md)        | The read-only principle and its enforcement                  | Accepted             |
| [0006](0006-api-conventions.md)            | API pagination and error-format conventions                  | Accepted at GATE 1   |
| [0007](0007-schema-conventions.md)         | Database schema conventions                                  | Accepted at GATE 1   |
| [0008](0008-worker-capabilities.md)        | Worker container capability grant (`NET_RAW`)                | Superseded at Step 4 |
| [0009](0009-technology-stack.md)           | Technology stack for apps/api, apps/worker, and the monorepo | Accepted             |
| [0010](0010-api-v1-change-process.md)      | API v1 freeze and change process                             | Accepted at GATE 2   |
| [0011](0011-frontend-application-stack.md) | Frontend application stack (routing, data fetching, i18n)    | Accepted             |

0001–0006 are the six ADRs `1.4` requires before GATE 1 sign-off; all are now
accepted, with their flagged open questions resolved and recorded in each
ADR's own text. 0007–0009 were written in the course of Step 1 work and are
referenced from the code and schema they justify (`docs/database-schema.md`,
`deploy/compose/docker-compose.yml`). 0010 is Step 2's GATE 2 change-process
ADR, referenced from `packages/contracts/src/openapi.yaml`.
