import { NextRequest, NextResponse } from "next/server"
import crypto from "node:crypto"
import { enqueueExecution, setExecutionStatus } from "../../../lib/queue"

export async function POST(req: NextRequest) {
  const body = await req.json()

  const apiToken = String(body.apiToken || "")
  const plan = body.plan

  if (!apiToken.trim()) {
    return NextResponse.json({ error: "apiToken is required" }, { status: 400 })
  }

  if (!plan?.action) {
    return NextResponse.json({ error: "plan.action is required" }, { status: 400 })
  }

  const executionId = crypto.randomUUID()

  await setExecutionStatus(executionId, {
    id: executionId,
    status: "queued",
    queue: "redis-streams",
    plan,
    createdAt: new Date().toISOString()
  })

  await enqueueExecution({
    executionId,
    apiToken,
    plan
  })

  return NextResponse.json({ executionId })
}
