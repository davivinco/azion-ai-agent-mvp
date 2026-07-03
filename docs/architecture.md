# Architecture

```text
Browser
  ↓
Next.js Web/API
  ↓
Planner atual: rules-based
  ↓
Plano JSON validável
  ↓
Redis Streams Queue
  ↓
Worker
  ↓
Tool Executor / MCP Server
  ↓
Azion API v4
```

## LLM position

The LLM should sit in the `/api/plan` step.

Current MVP:

```text
/api/plan → apps/web/lib/planner.ts → deterministic JSON plan
```

Target version:

```text
/api/plan → LLM → JSON schema validation → dry-run plan
```

The LLM never calls Azion directly. It only produces a structured plan. The backend and MCP server remain responsible for validation and execution.

## Why not one process?

For local MVP, Docker Compose gives one stack but isolates:

- `web`: UI and API.
- `worker`: asynchronous execution.
- `mcp`: tool boundary.
- `redis`: stream queue and execution status.

## Default inactive policy

The planner and executor both force `active=false` unless the user explicitly requests an active resource.

Exception:

- Firewall Function Instances omit the `active` field because Azion API doesn't allow creating them with `active=false`.

## Network List resolution

Firewall rules that reference the old template Network List ID `2` are remapped at execution time.

Mapping:

```text
2 → Azion IP Tor Exit Nodes
```

Execution flow:

```text
GET /workspace/network_lists
  ↓
find name == "Azion IP Tor Exit Nodes"
  ↓
replace criterion.argument before POST /firewalls/{id}/request_rules
```

## Token handling

For the sandbox/VPN MVP, the token is allowed to travel inside the Redis Stream message payload.

Future hardening:

- Encrypt token with app secret.
- Store encrypted token with TTL.
- Send only `execution_id` to the stream.
- Acknowledge and delete stream messages after execution.

## Application template

- Application creates a default HTTP Connector to `httpbingo.org`.
- Workload receives a user-provided domain or a random `.com.br` domain.
- The executor tries to create a deployment to associate Application and Workload.

## Queue implementation

This MVP uses Redis directly through Redis Streams instead of BullMQ.

```text
XADD azion:executions:stream ...
  ↓
XREADGROUP by worker
  ↓
call mcp-server
  ↓
update execution:<id> status
  ↓
XACK + XDEL
```

Default stream names:

```text
Stream: azion:executions:stream
Group: azion-ai-agent-workers
Consumer: worker-<pid>
```

Optional envs:

```text
EXECUTION_STREAM
EXECUTION_GROUP
EXECUTION_CONSUMER
MAX_ATTEMPTS
```
