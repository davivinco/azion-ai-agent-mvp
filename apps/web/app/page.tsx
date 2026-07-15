"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ExecutionHistory } from "./components/ExecutionHistory"
import { TemplatesPanel } from "./components/TemplatesPanel"
import { HelpPanel } from "./components/HelpPanel"
import { PlannerBadge } from "./components/PlannerBadge"
import { ActiveToggle } from "./components/ActiveToggle"
import { ResourceSummary } from "./components/ResourceSummary"
import { PlanSummary, type PlanView } from "./components/PlanSummary"
import { buildPlanView } from "./lib/planMessage"

type Plan = {
  action: string
  title: string
  clientId: string
  active: boolean
  parameters: Record<string, unknown>
  steps: string[]
  warnings: string[]
  originalPrompt?: string
}

type ChatMessage = {
  id: string
  role: "user" | "assistant" | "system"
  title?: string
  content: string
  json?: unknown
  planView?: PlanView | null
}

const actionLabels: Record<string, string> = {
  create_default_firewall: "Firewall",
  create_application_and_workload: "Application + Workload",
  import_dns: "Importação de DNS",
  migrate_proxied_domains: "Migração de domínios proxied"
}

type PromptExample = {
  label: string
  hint?: string
  text: string
  autoRun: boolean
}

const promptExamples: PromptExample[] = [
  {
    label: "Criar template de segurança (Firewall + WAF)",
    text: 'Crie um firewall default chamado "Firewall Template"',
    autoRun: true
  },
  {
    label: "Criar template de segurança já ativo",
    text: 'Crie um firewall default chamado "Firewall Template" ativo',
    autoRun: true
  },
  {
    label: "Criar Application + Workload para um domínio",
    text: 'Crie uma application e workload chamado "Loja Teste" para loja-teste.com.br',
    autoRun: true
  },
  {
    label: "Importar zona DNS de outro provedor",
    hint: "Preenche o comando — cole o export do provedor antes de gerar o plano",
    text: "Importe essa zona DNS para a Azion:\n\n<cole aqui o export do seu provedor: Cloudflare (CSV ou zone file), Route53 (JSON) ou zone file BIND>",
    autoRun: false
  },
  {
    label: "Migrar domínios proxied da Cloudflare (stack completo)",
    hint: "Preenche o comando — cole o export da Cloudflare antes de gerar o plano",
    text: "Importe essas entradas DNS na Azion e migre o stack completo (connector, application, firewall, workload e certificado Let's Encrypt) para os domínios proxied:\n\n<cole aqui o export da Cloudflare com os registros Proxied>",
    autoRun: false
  }
]


function tryParseJsonStrings(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return tryParseJsonStrings(JSON.parse(trimmed))
      } catch {
        return value
      }
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map(tryParseJsonStrings)
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, tryParseJsonStrings(val)])
    )
  }

  return value
}

function makeId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID()
  }

  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function statusLabel(execution: any) {
  if (!execution?.status) return "Aguardando execução"
  if (execution.status === "completed") return "Concluído"
  if (execution.status === "failed") return "Falhou"
  if (execution.status === "running") return "Executando"
  return "Na fila"
}


function parseExecutionError(error: unknown) {
  if (!error) return "Erro não informado."

  try {
    const parsed = typeof error === "string" ? JSON.parse(error) : error as any
    const first = parsed?.response?.errors?.[0]
    if (first) {
      return [
        `Path: ${parsed.path || "não informado"}`,
        `Erro: ${first.title || "erro desconhecido"}`,
        first.detail ? `Detalhe: ${first.detail}` : null
      ].filter(Boolean).join("\n")
    }
  } catch {}

  return String(error)
}

function buildExecutionSummary(execution: any) {
  if (!execution) return ""

  if (execution.status === "failed") {
    return `A execução falhou.\n\n${parseExecutionError(execution.error)}`
  }

  const headerByAction: Record<string, string> = {
    create_default_firewall: "Firewall criado com sucesso.",
    create_application_and_workload: "Application e Workload processados com sucesso.",
    import_dns: "Zona DNS criada com sucesso."
  }

  return headerByAction[execution.plan?.action] || "Execução finalizada com sucesso."
}

export default function HomePage() {
  const [apiToken, setApiToken] = useState("")
  const [clientId, setClientId] = useState("")
  const [message, setMessage] = useState('Crie um firewall default chamado "Firewall Template"')
  const [activeOverride, setActiveOverride] = useState(false)
  const [sidebarTab, setSidebarTab] = useState<"templates" | "history" | "help">("templates")
  const [plan, setPlan] = useState<Plan | null>(null)
  const [executionId, setExecutionId] = useState<string | null>(null)
  const [execution, setExecution] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      title: "Azion AI Agent",
      content:
        "Olá! Eu gero um plano antes de executar qualquer mudança. Por padrão, Applications, Firewalls, Workloads e Rules nascem desativados, a menos que você peça explicitamente para criar ativo."
    }
  ])

  const canExecute = useMemo(() => Boolean(apiToken && plan) && !executionId, [apiToken, plan, executionId])

  const chatWindowRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const node = chatWindowRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
  }, [messages])

  async function openAuditExecution(id: string) {
    setExecutionId(id)

    try {
      const res = await fetch(`/api/audit/executions/${id}`)

      if (!res.ok) {
        setMessages((current) => [
          ...current,
          {
            id: makeId(),
            role: "assistant",
            title: "Histórico não encontrado",
            content: "Não encontrei essa execução no SQLite nem no Redis."
          }
        ])
        return
      }

      const data = await res.json()

      const normalized = {
        ...data,
        plan: data.plan || {
          action: data.action,
          title: data.title,
          clientId: data.clientId,
          originalPrompt: data.originalPrompt
        }
      }

      setExecution(normalized)

      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          title: `Histórico: ${normalized.plan?.title || normalized.title || id}`,
          content: buildExecutionSummary(normalized),
          json: normalized
        }
      ])
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          title: "Erro ao abrir histórico",
          content: error instanceof Error ? error.message : String(error)
        }
      ])
    }
  }

  async function generatePlan(customMessage?: string) {
    const currentMessage = customMessage || message
    if (!currentMessage.trim()) return

    setLoading(true)
    setExecutionId(null)
    setExecution(null)
    setPlan(null)

    setMessages((current) => [
      ...current,
      {
        id: makeId(),
        role: "user",
        content: currentMessage
      }
    ])

    const res = await fetch("/api/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: currentMessage, clientId, activeOverride })
    })

    const data = await res.json()
    const planWithPrompt = {
      ...data.plan,
      planner: data.plan?.planner || data.planner || "rules",
      originalPrompt: currentMessage
    }

    setPlan(planWithPrompt)
    const planMessage = await buildPlanView(planWithPrompt)
    setMessages((current) => [
      ...current,
      {
        id: makeId(),
        role: "assistant",
        title: planWithPrompt?.title || "Plano gerado",
        content: planMessage.content,
        json: planWithPrompt,
        planView: planMessage.view
      }
    ])
    setLoading(false)
  }

  async function executePlan() {
    if (!plan) return

    if (!apiToken.trim()) {
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: "assistant",
          title: "API Token necessário",
          content: "Para executar o plano, informe o API Token na lateral. O plano pode ser gerado sem token, mas a execução precisa dele."
        }
      ])
      return
    }

    setLoading(true)

    setMessages((current) => [
      ...current,
      {
        id: makeId(),
        role: "system",
        content: "Execução enviada para a fila Redis Streams."
      }
    ])

    const res = await fetch("/api/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiToken, plan })
    })

    const data = await res.json()
    setExecutionId(data.executionId)
    setLoading(false)
  }

  useEffect(() => {
    if (!executionId) return

    const timer = setInterval(async () => {
      const res = await fetch(`/api/executions/${executionId}`)
      const data = await res.json()
      setExecution(data)
    }, 1400)

    return () => clearInterval(timer)
  }, [executionId])

  useEffect(() => {
    if (!execution || !executionId) return
    if (!["completed", "failed"].includes(execution.status)) return

    setMessages((current) => {
      if (current.some((item) => item.id === `execution-${executionId}-${execution.status}`)) return current

      return [
        ...current,
        {
          id: `execution-${executionId}-${execution.status}`,
          role: "assistant",
          title: `Execução ${statusLabel(execution)}`,
          content: buildExecutionSummary(execution),
          json: execution
        }
      ]
    })
  }, [execution, executionId])

  return (
    <main className="page">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="azion-mark">A</div>
          <div>
            <strong>Azion AI Agent</strong>
            <span>Internal ChatOps</span>
          </div>
        </div>

        <div className="config-card">
          <label className="label">Client ID</label>
          <input className="input" placeholder="Opcional / conta do cliente" value={clientId} onChange={(e) => setClientId(e.target.value)} />

          <label className="label">API Token</label>
          <input
            className="input"
            type="password"
            placeholder="Cole o token aqui"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
          />

          <p className="hint">Token não é salvo no navegador; no MVP ele segue na mensagem da fila até a execução terminar.</p>
        </div>

        <div className="examples-card">
          <span className="label">Comece por aqui</span>
          {promptExamples.map((example) => (
            <button
              key={example.label}
              className="prompt-chip"
              onClick={() => {
                setMessage(example.text)
                if (example.autoRun) {
                  generatePlan(example.text)
                } else {
                  setPlan(null)
                  setExecution(null)
                  setExecutionId(null)
                }
              }}
              disabled={loading}
            >
              {example.label}
              {example.hint ? <small className="prompt-chip-hint">{example.hint}</small> : null}
            </button>
          ))}
        </div>

        <div className="sidebar-tabs">
          <button
            type="button"
            className={`sidebar-tab ${sidebarTab === "templates" ? "selected" : ""}`}
            onClick={() => setSidebarTab("templates")}
          >
            Templates
          </button>
          <button
            type="button"
            className={`sidebar-tab ${sidebarTab === "history" ? "selected" : ""}`}
            onClick={() => setSidebarTab("history")}
          >
            Histórico
          </button>
          <button
            type="button"
            className={`sidebar-tab ${sidebarTab === "help" ? "selected" : ""}`}
            onClick={() => setSidebarTab("help")}
          >
            Ajuda
          </button>
        </div>

        {sidebarTab === "templates" ? (
          <TemplatesPanel />
        ) : sidebarTab === "history" ? (
          <ExecutionHistory onSelect={openAuditExecution} />
        ) : (
          <HelpPanel />
        )}
      </aside>

      <section className="chat-shell">
        <header className="chat-header">
          <span className="chat-header-crumb">Criação assistida de recursos Azion — plano, revisão e execução</span>
          <div className="header-pills">
            <span className="badge">Sandbox</span>
            <PlannerBadge planner={(plan as any)?.planner || "llm"} />
          </div>
        </header>

        <div className="chat-window" ref={chatWindowRef}>
          {messages.map((item) => (
            <article key={item.id} className={`message ${item.role}`}>
              <div className="avatar">{item.role === "user" ? "D" : item.role === "system" ? "•" : "A"}</div>
              <div className="bubble">
                {item.title ? <strong>{item.title}</strong> : null}
                <p className="message-text">{item.content}</p>
                {item.planView ? <PlanSummary view={item.planView} /> : null}
                {(item.json as any)?.status !== "failed" ? (
                  <ResourceSummary result={(item.json as any)?.result} />
                ) : null}
                {item.json ? (
                  <details className="technical-details">
                    <summary>Ver detalhes técnicos</summary>
                    <pre>{JSON.stringify(tryParseJsonStrings(item.json), null, 2)}</pre>
                  </details>
                ) : null}
              </div>
            </article>
          ))}
        </div>

        {plan ? (
          <section className="execution-panel">
            <div className="execution-panel-inner">
              <div className="execution-panel-left">
                <span className="execution-action-name">{actionLabels[plan.action] || plan.action}</span>
                <PlannerBadge planner={(plan as any).planner} />
                {executionId ? (
                  <span className="status" title={executionId}>ID {executionId.slice(0, 8)}</span>
                ) : null}
                {execution ? <span className={`status ${execution.status}`}>{statusLabel(execution)}</span> : null}
                {!apiToken.trim() ? <span className="status warning">Token obrigatório</span> : null}
              </div>
              <div className="execution-panel-right">
                {executionId ? (
                  <span className="status">{plan.active ? "Criado ativo" : "Criado desabilitado"}</span>
                ) : (
                  <div className="toggle-group">
                    <span className="toggle-label">Este plano</span>
                    <ActiveToggle
                      active={Boolean(plan.active)}
                      onChange={(next) => setPlan((current) => (current ? { ...current, active: next } : current))}
                      disabled={loading}
                    />
                  </div>
                )}
                <button className="btn" onClick={executePlan} disabled={!canExecute || loading}>
                  {!apiToken.trim() ? "Informe o API Token" : executionId ? "Execução enviada" : "Confirmar execução"}
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault()
            generatePlan()
          }}
        >
          <div className="composer-box">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder='Descreva o que criar — ex: Crie um firewall default chamado "Firewall Template"'
            />
            <div className="composer-footer">
              {(!plan || executionId) ? (
                <div className="toggle-group">
                  <span className="toggle-label">Novos comandos</span>
                  <ActiveToggle active={activeOverride} onChange={setActiveOverride} disabled={loading} />
                </div>
              ) : (
                <span className="composer-note">Ajuste ativo/desabilitado deste plano no painel acima</span>
              )}
              <button className="btn" disabled={loading || !message.trim()}>
                Gerar plano
              </button>
            </div>
          </div>
        </form>
      </section>
    </main>
  )
}
