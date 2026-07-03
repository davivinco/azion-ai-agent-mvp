"use client"

import { useEffect, useState } from "react"

type ExecutionItem = {
  id: string
  status: string
  action?: string
  title?: string
  originalPrompt?: string
  createdAt?: string
  updatedAt?: string
  finishedAt?: string
}

export function ExecutionHistory({ onSelect }: { onSelect: (id: string) => void }) {
  const [items, setItems] = useState<ExecutionItem[]>([])
  const [loading, setLoading] = useState(false)

  async function refresh() {
    try {
      setLoading(true)
      const res = await fetch("/api/executions")
      const data = await res.json()
      setItems(data.executions || [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()

    const timer = setInterval(refresh, 7000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="history-card">
      <div className="history-header">
        <span className="label">Últimas execuções</span>
        <button className="mini-btn" onClick={refresh} type="button">
          {loading ? "..." : "Atualizar"}
        </button>
      </div>

      {items.length === 0 ? (
        <p className="empty-history">Nenhuma execução encontrada.</p>
      ) : (
        items.map((item) => (
          <button
            key={item.id}
            className={`history-item ${item.status}`}
            type="button"
            onClick={() => onSelect(item.id)}
          >
            <strong>{item.title || item.action || "Execução"}</strong>
            <span>{item.status} · {item.id.slice(0, 8)}</span>
            {item.originalPrompt ? <small>{item.originalPrompt}</small> : null}
          </button>
        ))
      )}
    </div>
  )
}
