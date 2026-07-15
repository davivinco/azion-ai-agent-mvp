export type PlanPreviewRecord = {
  type: string
  name: string
  rdata: string[]
  ttl: number
}

export type PlanProxiedGroup = {
  host: string
  originIp: string
  domains: string[]
  certificateDomains: string[]
  acmeRecords: { name: string, rdata: string[] }[]
}

export type PlanView = {
  steps: string[]
  warnings: string[]
  zone?: { domain: string, providerLabel?: string }
  records?: PlanPreviewRecord[]
  skipped?: number
  notes?: string[]
  groups?: PlanProxiedGroup[]
}

const MAX_VISIBLE_RECORDS = 12

function RecordsTable({ records }: { records: PlanPreviewRecord[] }) {
  const visible = records.slice(0, MAX_VISIBLE_RECORDS)
  const hidden = records.length - visible.length

  return (
    <div>
      <table className="plan-records-table">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Nome</th>
            <th>Valor</th>
            <th>TTL</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((record, index) => (
            <tr key={`${record.type}-${record.name}-${index}`}>
              <td><span className="plan-record-type">{record.type}</span></td>
              <td className="plan-mono">{record.name}</td>
              <td className="plan-mono plan-record-value">{record.rdata.join(" ")}</td>
              <td className="plan-record-ttl">{record.ttl}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 ? <span className="plan-records-more">+ {hidden} registro(s) não exibido(s) aqui — todos serão importados.</span> : null}
    </div>
  )
}

function GroupBlock({ group }: { group: PlanProxiedGroup }) {
  return (
    <div className="plan-group">
      <span className="plan-group-title">{group.host}</span>
      <div className="plan-group-row">
        <span className="plan-group-label">IP de origem</span>
        <span className="plan-mono">{group.originIp}</span>
      </div>
      <div className="plan-group-row">
        <span className="plan-group-label">Domínios</span>
        <span className="plan-mono">{group.domains.join(", ")}</span>
      </div>
      <div className="plan-group-row">
        <span className="plan-group-label">Certificado Let's Encrypt</span>
        <span className="plan-mono">{group.certificateDomains.join(", ")}</span>
      </div>
      {group.acmeRecords.map((record) => (
        <div className="plan-group-row" key={record.name}>
          <span className="plan-group-label">Registro ACME</span>
          <span className="plan-mono plan-record-value">{record.name} → CNAME {record.rdata.join(" ")}</span>
        </div>
      ))}
    </div>
  )
}

export function PlanSummary({ view }: { view: PlanView }) {
  const notes = [...(view.notes || []), ...(view.warnings || [])]
  const hasContent = view.steps.length > 0
    || (view.records?.length || 0) > 0
    || (view.groups?.length || 0) > 0
    || notes.length > 0
    || Boolean(view.zone)

  if (!hasContent) return null

  return (
    <div className="plan-summary">
      {view.zone ? (
        <div className="plan-zone-row">
          <span className="plan-zone-item"><span className="plan-group-label">Zona</span> <span className="plan-mono">{view.zone.domain}</span></span>
          {view.zone.providerLabel ? (
            <span className="plan-zone-item"><span className="plan-group-label">Formato</span> {view.zone.providerLabel}</span>
          ) : null}
        </div>
      ) : null}

      {view.records && view.records.length > 0 ? (
        <div>
          <span className="plan-section-title">Registros DNS a criar ({view.records.length})</span>
          <RecordsTable records={view.records} />
        </div>
      ) : null}

      {view.groups && view.groups.length > 0 ? (
        <div>
          <span className="plan-section-title">Stacks por host proxied ({view.groups.length})</span>
          {view.groups.map((group) => (
            <GroupBlock key={group.host} group={group} />
          ))}
        </div>
      ) : null}

      {view.steps.length > 0 ? (
        <div>
          <span className="plan-section-title">Etapas da execução</span>
          <ol className="plan-steps">
            {view.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <div>
          <span className="plan-section-title">Avisos</span>
          <ul className="plan-notes">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.skipped ? (
        <span className="plan-skipped">{view.skipped} linha(s) não reconhecida(s) e ignorada(s).</span>
      ) : null}
    </div>
  )
}
