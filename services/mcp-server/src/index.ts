import express from "express"
import { dryRun, execute } from "./tools.js"

const app = express()
app.use(express.json({ limit: "2mb" }))

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "azion-ai-agent-mcp-server" })
})

app.get("/tools/list", (_req, res) => {
  res.json({
    tools: [
      "import_dns",
      "create_application_and_workload",
      "create_default_firewall"
    ]
  })
})

app.post("/tools/dry-run", async (req, res) => {
  try {
    const result = await dryRun(req.body.plan)
    res.json({ ok: true, result })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})

app.post("/tools/execute", async (req, res) => {
  try {
    const { plan, apiToken } = req.body

    if (!apiToken) {
      return res.status(400).json({ ok: false, error: "apiToken is required" })
    }

    const result = await execute(plan, apiToken)
    res.json({ ok: true, result })
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})

const port = Number(process.env.PORT || 3333)
app.listen(port, () => {
  console.log(`Azion AI Agent tool server listening on ${port}`)
})
