import IORedis from "ioredis"

export const redis = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null
})

export const EXECUTION_STREAM = "azion:executions:stream"
export const EXECUTION_STATUS_TTL_SECONDS = 60 * 60

export async function setExecutionStatus(executionId: string, patch: Record<string, unknown>) {
  const key = `execution:${executionId}`
  const currentRaw = await redis.get(key)
  const current = currentRaw ? JSON.parse(currentRaw) : { id: executionId }

  await redis.set(
    key,
    JSON.stringify({
      ...current,
      ...patch,
      updatedAt: new Date().toISOString()
    }),
    "EX",
    EXECUTION_STATUS_TTL_SECONDS
  )
}

export async function enqueueExecution(input: {
  executionId: string
  apiToken: string
  plan: unknown
}) {
  await redis.xadd(
    EXECUTION_STREAM,
    "MAXLEN",
    "~",
    "1000",
    "*",
    "executionId",
    input.executionId,
    "apiToken",
    input.apiToken,
    "plan",
    JSON.stringify(input.plan),
    "attempt",
    "1",
    "queuedAt",
    new Date().toISOString()
  )
}
