export const dynamic = "force-dynamic"

const mcpServerUrl = process.env.MCP_SERVER_URL || "http://localhost:3333"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const plan = body?.plan

    if (!plan?.action) {
      return Response.json({ error: "plan is required" }, { status: 400 })
    }

    const res = await fetch(`${mcpServerUrl}/tools/dry-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan })
    })

    const data = await res.json()

    if (!res.ok || data.ok === false) {
      return Response.json({ error: data.error || "dns_preview_failed" }, { status: 502 })
    }

    return Response.json({ result: data.result })
  } catch (error) {
    return Response.json({
      error: "dns_preview_failed",
      detail: error instanceof Error ? error.message : String(error)
    }, { status: 500 })
  }
}
