import { execFile } from "node:child_process"
import { promisify } from "node:util"
import Redis from "ioredis"

export const dynamic = "force-dynamic"

const execFileAsync = promisify(execFile)
const dbPath = process.env.AUDIT_DB_PATH || "/data/audit.sqlite"
const redis = new Redis(process.env.REDIS_URL || "redis://redis:6379")

function safeParse(value: string | null) {
  if (!value) return null

  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

async function readFromSqlite() {
  try {
    const query = `
      SELECT
        id,
        status,
        action,
        title,
        client_id AS clientId,
        prompt_text AS originalPrompt,
        created_at AS createdAt,
        updated_at AS updatedAt,
        finished_at AS finishedAt
      FROM executions
      ORDER BY datetime(updated_at) DESC
      LIMIT 12;
    `

    const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, query])
    return JSON.parse(stdout || "[]")
  } catch {
    return []
  }
}

async function readFromRedisFallback() {
  const keys = await redis.keys("execution:*")

  const executions = await Promise.all(
    keys.map(async (key) => safeParse(await redis.get(key)))
  )

  return executions
    .filter(Boolean)
    .filter((item: any) => item?.id)
    .sort((a: any, b: any) => {
      const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime()
      const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime()
      return dateB - dateA
    })
    .slice(0, 12)
    .map((item: any) => ({
      id: item.id,
      status: item.status,
      action: item.plan?.action,
      title: item.plan?.title,
      clientId: item.plan?.clientId,
      originalPrompt: item.plan?.originalPrompt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      finishedAt: item.finishedAt
    }))
}

export async function GET() {
  const sqliteExecutions = await readFromSqlite()

  if (sqliteExecutions.length > 0) {
    return Response.json({ source: "sqlite", executions: sqliteExecutions })
  }

  const redisExecutions = await readFromRedisFallback()
  return Response.json({ source: "redis", executions: redisExecutions })
}
