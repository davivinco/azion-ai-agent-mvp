import { NextRequest, NextResponse } from "next/server"
import { redis } from "../../../../lib/queue"

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const raw = await redis.get(`execution:${id}`)

  if (!raw) {
    return NextResponse.json({ error: "execution not found" }, { status: 404 })
  }

  return NextResponse.json(JSON.parse(raw))
}
