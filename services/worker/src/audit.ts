import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const dbPath = process.env.AUDIT_DB_PATH || "/data/audit.sqlite"

function sqlEscape(value: unknown) {
  if (value === null || value === undefined) return "NULL"
  return `'${String(value).replaceAll("'", "''")}'`
}

async function runSql(sql: string) {
  await execFileAsync("sqlite3", [dbPath, sql])
}

export async function initAuditDb() {
  await runSql(`
    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      action TEXT,
      title TEXT,
      client_id TEXT,
      prompt_text TEXT,
      plan_json TEXT,
      result_json TEXT,
      error_text TEXT,
      created_at TEXT,
      started_at TEXT,
      finished_at TEXT,
      updated_at TEXT NOT NULL
    );
  `)

  try {
    await runSql("ALTER TABLE executions ADD COLUMN prompt_text TEXT;")
  } catch {
    // coluna já existe
  }
}

export async function saveExecutionAudit(execution: any) {
  await initAuditDb()

  const plan = execution.plan || {}

  const sql = `
    INSERT INTO executions (
      id,
      status,
      action,
      title,
      client_id,
      prompt_text,
      plan_json,
      result_json,
      error_text,
      created_at,
      started_at,
      finished_at,
      updated_at
    ) VALUES (
      ${sqlEscape(execution.id)},
      ${sqlEscape(execution.status)},
      ${sqlEscape(plan.action)},
      ${sqlEscape(plan.title)},
      ${sqlEscape(plan.clientId)},
      ${sqlEscape(plan.originalPrompt || null)},
      ${sqlEscape(JSON.stringify(plan))},
      ${sqlEscape(execution.result ? JSON.stringify(execution.result) : null)},
      ${sqlEscape(execution.error || null)},
      ${sqlEscape(execution.createdAt || null)},
      ${sqlEscape(execution.startedAt || null)},
      ${sqlEscape(execution.finishedAt || null)},
      ${sqlEscape(execution.updatedAt || new Date().toISOString())}
    )
    ON CONFLICT(id) DO UPDATE SET
      status=excluded.status,
      action=excluded.action,
      title=excluded.title,
      client_id=excluded.client_id,
      prompt_text=excluded.prompt_text,
      plan_json=excluded.plan_json,
      result_json=excluded.result_json,
      error_text=excluded.error_text,
      created_at=excluded.created_at,
      started_at=excluded.started_at,
      finished_at=excluded.finished_at,
      updated_at=excluded.updated_at;
  `

  await runSql(sql)
}
