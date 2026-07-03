export function HelpPanel() {
  return (
    <div className="templates-card">
      <span className="label">Como usar</span>

      <div className="templates-list">
        <details open>
          <summary>Fluxo básico</summary>
          <ul>
            <li>Cole seu API Token da Azion na lateral (não é salvo no navegador).</li>
            <li>Escreva o pedido em português no chat e clique em "Gerar plano".</li>
            <li>Revise o plano (título, passos, avisos, preview de DNS quando houver).</li>
            <li>Clique em "Confirmar execução" — o pedido entra na fila e o status atualiza sozinho.</li>
            <li>Expanda "Ver detalhes técnicos" em qualquer mensagem para ver o JSON completo.</li>
          </ul>
        </details>

        <details>
          <summary>O que você pode pedir</summary>
          <ul>
            <li><strong>Firewall:</strong> "Crie um firewall default chamado 'Nome'"</li>
            <li><strong>Application + Workload:</strong> "Crie uma application e workload chamado 'Nome' para dominio.com.br"</li>
            <li><strong>Importar DNS:</strong> "Importe uma zona DNS para dominio.com" + cole o export (Cloudflare CSV/zonefile, Route53 JSON, ou qualquer zonefile BIND)</li>
            <li><strong>Migrar domínios proxied:</strong> depois de importar um DNS com registros "Proxy status" ativo no Cloudflare, peça para migrar o stack completo (cria Connector, Application, Firewall e Workload por host, mais o certificado Let's Encrypt)</li>
          </ul>
        </details>

        <details>
          <summary>Ativo x Desabilitado</summary>
          <ul>
            <li>Por padrão, tudo nasce desabilitado (`active: false`) na Azion.</li>
            <li>"Novos comandos" define o padrão do próximo plano gerado.</li>
            <li>"Este plano" (some depois de confirmar) permite mudar só o plano atual antes de executar.</li>
            <li>Connector e Certificado são sempre criados ativos — não têm efeito colateral sozinhos.</li>
          </ul>
        </details>

        <details>
          <summary>Histórico e auditoria</summary>
          <ul>
            <li>A aba "Histórico" lista execuções passadas (persistidas em SQLite).</li>
            <li>Clique em uma execução para reabrir o resultado completo no chat.</li>
          </ul>
        </details>
      </div>
    </div>
  )
}
