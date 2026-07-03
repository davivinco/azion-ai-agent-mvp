import IORedis from "ioredis"
import { initAuditDb, saveExecutionAudit } from "./audit.js"

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379"
const mcpServerUrl = process.env.MCP_SERVER_URL || "http://localhost:3333"

const STREAM_KEY = process.env.EXECUTION_STREAM || "azion:executions:stream"
const GROUP_NAME = process.env.EXECUTION_GROUP || "azion-ai-agent-workers"
const CONSUMER_NAME = process.env.EXECUTION_CONSUMER || `worker-${process.pid}`
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || "1")
const STATUS_TTL_SECONDS = 60 * 60

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null
})

type StreamFieldMap = Record<string, string>

function fieldsToObject(fields: string[]): StreamFieldMap {
  const output: StreamFieldMap = {}

  for (let index = 0; index < fields.length; index += 2) {
    output[fields[index]] = fields[index + 1]
  }

  return output
}

async function ensureConsumerGroup() {
  try {
    await redis.xgroup("CREATE", STREAM_KEY, GROUP_NAME, "$", "MKSTREAM")
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes("BUSYGROUP")) {
      throw error
    }
  }
}

async function setExecution(executionId: string, patch: Record<string, unknown>) {
  const key = `execution:${executionId}`
  const currentRaw = await redis.get(key)
  const current = currentRaw ? JSON.parse(currentRaw) : { id: executionId }

  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  }

  await redis.set(
    key,
    JSON.stringify(next),
    "EX",
    STATUS_TTL_SECONDS
  )

  return next
}

async function ackAndDelete(messageId: string) {
  await redis.xack(STREAM_KEY, GROUP_NAME, messageId)
  await redis.xdel(STREAM_KEY, messageId)
}

async function requeue(fields: StreamFieldMap, nextAttempt: number) {
  await redis.xadd(
    STREAM_KEY,
    "MAXLEN",
    "~",
    "1000",
    "*",
    "executionId",
    fields.executionId,
    "apiToken",
    fields.apiToken,
    "plan",
    fields.plan,
    "attempt",
    String(nextAttempt),
    "queuedAt",
    new Date().toISOString()
  )
}

async function executeMessage(messageId: string, fields: StreamFieldMap) {
  const executionId = fields.executionId
  const apiToken = fields.apiToken
  const plan = JSON.parse(fields.plan || "{}")
  const attempt = Number(fields.attempt || "1")

  await setExecution(executionId, {
    status: "running",
    attempt,
    startedAt: new Date().toISOString()
  })

  try {
    const response = await fetch(`${mcpServerUrl}/tools/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ apiToken, plan })
    })

    const data = await response.json()

    if (!response.ok || data.ok === false) {
      throw new Error(data.error || JSON.stringify(data))
    }

    const completedExecution = await setExecution(executionId, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      result: data.result
    })

    await saveExecutionAudit(completedExecution)

    await ackAndDelete(messageId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (attempt < MAX_ATTEMPTS) {
      await setExecution(executionId, {
        status: "queued",
        attempt,
        retrying: true,
        lastError: message
      })

      await requeue(fields, attempt + 1)
      await ackAndDelete(messageId)
      return
    }

    const failedExecution = await setExecution(executionId, {
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: message
    })

    await saveExecutionAudit(failedExecution)

    await ackAndDelete(messageId)
  }
}

async function loop() {
  await initAuditDb()
  await ensureConsumerGroup()
  console.log(`Azion AI Agent worker started with Redis Streams: ${STREAM_KEY}`)

  while (true) {
    const response = await redis.xreadgroup(
      "GROUP",
      GROUP_NAME,
      CONSUMER_NAME,
      "COUNT",
      "1",
      "BLOCK",
      "5000",
      "STREAMS",
      STREAM_KEY,
      ">"
    )

    if (!response) continue

    for (const [, messages] of response as unknown as [string, [string, string[]][]][]) {
      for (const [messageId, fields] of messages) {
        await executeMessage(messageId, fieldsToObject(fields))
      }
    }
  }
}

loop().catch((error) => {
  console.error("Worker crashed", error)
  process.exit(1)
})
