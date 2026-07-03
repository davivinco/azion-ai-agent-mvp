import { execFile } from "node:child_process"
import { promisify } from "node:util"
import Redis from "ioredis"

export const dynamic = "force-dynamic"

const execFileAsync = promisify(execFile)
const dbPath = process.env.AUDIT_DB_PATH || "/data/audit.sqlite"
const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379")

function sqlEscape(value: string) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function safeJson(value: string | null) {
  if (!value) return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function readFromSqlite(id: string) {
  const query = `
    SELECT
      id,
      status,
      action,
      title,
      client_id AS clientId,
      prompt_text AS originalPrompt,
      plan_json AS planJson,
      result_json AS resultJson,
      error_text AS errorText,
      created_at AS createdAt,
      started_at AS startedAt,
      finished_at AS finishedAt,
      updated_at AS updatedAt
    FROM executions
    WHERE id = ${sqlEscape(id)}
    LIMIT 1;
  `

  try {
    const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, query])
    const rows = JSON.parse(stdout || "[]")
    const row = rows[0]

    if (!row) return null

    return {
      id: row.id,
      status: row.status,
      action: row.action,
      title: row.title,
      clientId: row.clientId,
      originalPrompt: row.originalPrompt,
      plan: safeJson(row.planJson),
      result: safeJson(row.resultJson),
      error: row.errorText,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      updatedAt: row.updatedAt,
      source: "sqlite"
    }
  } catch {
    return null
  }
}

async function readFromRedis(id: string) {
  const raw = await redis.get(`execution:${id}`)
  const parsed = safeJson(raw)

  if (!parsed) return null

  return {
    ...parsed,
    source: "redis"
  }
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const id = params.id

  const sqliteExecution = await readFromSqlite(id)
  if (sqliteExecution) {
    return Response.json(sqliteExecution)
  }

  const redisExecution = await readFromRedis(id)
  if (redisExecution) {
    return Response.json(redisExecution)
  }

  return Response.json(
    {
      error: "Execution not found",
      id,
      checked: ["sqlite", "redis"]
    },
    { status: 404 }
  )
}
