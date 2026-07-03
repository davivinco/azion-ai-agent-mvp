# Azion AI Agent — MVP

Ferramenta interna de ChatOps para o time de Solutions Architect da Azion. Você escreve um pedido em português natural, o agente monta um **plano** (JSON validável, revisável antes de executar), e — só depois que você confirmar — ele executa de verdade contra a API v4 da Azion, via fila.

> Padrão de segurança do MVP: todo recurso (Application, Firewall, Workload, Rules) nasce **desativado** (`active: false`), a menos que você peça explicitamente para criar ativo. Connector e Certificado são exceções e nascem sempre ativos, pois não têm efeito colateral sozinhos.

## O que ele sabe fazer hoje

| Comando (exemplos) | Ação interna | O que é criado |
|---|---|---|
| `Crie um firewall default chamado "Firewall Template"` | `create_default_firewall` | Firewall + Function Instances + WAF (criado por conta) + Request Rules |
| `Crie uma application e workload chamado "Loja Teste" para loja.com.br` | `create_application_and_workload` | Application + Cache Settings + Connector + Workload + Request/Response Rules |
| `Importe uma zona DNS para exemplo.com` + dados colados | `import_dns` | Zona DNS + registros, traduzidos do formato de origem para a Azion |
| `Migre o stack completo para os domínios proxied` + dados colados | `migrate_proxied_domains` | Por host proxied: Connector (IP de origem real) + Application + Firewall (com WAF) + Workload + certificado Let's Encrypt (DNS-01) + registro DNS regular + registro `_acme-challenge` |

O planejador (rules-based ou LLM, ver abaixo) decide a ação a partir do texto livre — não existem botões/formulários separados por recurso.

### Importação de DNS multi-provider

Cole o export de zona de qualquer provedor no chat. O parser (`services/mcp-server/src/dns-parser.ts`) detecta automaticamente o formato:

- **Cloudflare** — CSV com colunas (`Type,Name,Content,Proxy status,TTL,...`) ou export em zone-file/BIND (com `; cf_tags=cf-proxied:true/false` como comentário).
- **Route53** — JSON (`ResourceRecordSets` / `ChangeBatch`).
- **Zone-file genérico** — qualquer export estilo BIND (Akamai, GoCache, etc.), respeitando a sintaxe RFC1035 de comentários (`;` até o fim da linha, exceto dentro de aspas).

O preview (antes da execução) mostra: zona detectada, formato identificado, registros traduzidos, e avisos sobre linhas não reconhecidas.

### Migração de domínios "proxied" (Cloudflare → Azion)

Quando a importação de DNS identifica registros com `Proxy status` ativo no Cloudflare, o agente avisa e sugere a próxima ação. Ao confirmar a migração, para cada IP de origem único ele cria, com o mesmo nome do host (Application/Firewall/Connector/Workload):

1. Firewall dedicado (com WAF próprio da conta e Request Rules).
2. Registro `_acme-challenge.<domínio>` → CNAME `<domínio>.letsencrypt.azion.com` na zona, **antes** de solicitar o certificado (ordem exigida pelo desafio DNS-01, [ver guia oficial](https://www.azion.com/pt-br/documentacao/produtos/guias/como-gerar-um-certificado-lets-encrypt/#opcao-2-prepare-a-entrada-de-dns-com-um-provedor-de-dns-externo)).
3. Solicitação do certificado Let's Encrypt.
4. Application + Connector (apontando para o IP de origem real) + Workload, já vinculando o Firewall e o certificado via Deployment.

A emissão do certificado é assíncrona — acompanhe o status (`pending` → `active`) no console da Azion.

## Como usar

1. Rode a aplicação (local ou via deploy, veja abaixo) e abra `http://localhost:3000`.
2. Cole seu **API Token** da Azion na barra lateral (não é salvo no navegador; trafega só até a execução terminar).
3. Opcionalmente informe o **Client ID** (útil para auditoria multi-conta).
4. Escolha o toggle **"Novos comandos"**: `Criar desabilitado` (padrão) ou `Criar ativado`, define o estado dos recursos do próximo plano.
5. Escreva o pedido em português (ou clique em um dos "Exemplos de prompts") e clique em **Gerar plano**.
6. Revise o plano: título, passos, avisos e — quando aplicável — o preview dos registros DNS/domínios detectados.
7. Se quiser mudar o estado ativo/desabilitado só deste plano, use o toggle **"Este plano"** antes de confirmar.
8. Clique em **Confirmar execução**. O pedido entra na fila (Redis Streams); o status muda de `Na fila` → `Executando` → `Concluído`/`Falhou` em tempo real.
9. Expanda **"Ver detalhes técnicos"** em qualquer mensagem para ver o JSON completo do plano/resultado (útil para depurar erros da API da Azion).
10. Use a aba **Histórico** na lateral para reabrir execuções passadas (ficam persistidas em SQLite).

## Arquitetura

```text
Prompt do usuário (chat)
  ↓
POST /api/plan            → planner (rules-based ou LLM) gera um Plan JSON
  ↓
usuário revisa e confirma
  ↓
POST /api/execute          → grava status inicial e publica na fila
  ↓
Redis Streams
  ↓
worker (services/worker)   → consome a fila, chama o mcp-server, grava auditoria
  ↓
mcp-server (services/mcp-server) → valida (dryRun) e executa (execute) contra a Azion API v4
  ↓
Azion API v4
```

```text
azion-ai-agent-mvp/
├── apps/web              # Next.js: UI de chat + API routes (/api/plan, /api/execute, /api/executions, /api/dns/preview, /api/audit)
├── services/mcp-server    # Executor das tools: dryRun/execute por ação, parser de DNS, client HTTP para a Azion API
├── services/worker        # Consumidor da fila Redis Streams, chama o mcp-server e persiste auditoria em SQLite
├── packages/templates     # Templates de referência extraídos da sandbox (firewall/application-base)
├── docs/                  # Notas de arquitetura e do planner LLM
└── docker-compose.yml
```

### Onde o LLM entra

O endpoint `POST /api/plan` roda em um dos dois modos (`AGENT_PLANNER_MODE`):

- `rules` (padrão): regras determinísticas em `apps/web/app/api/plan/route.ts` — detecta a ação por palavras-chave no texto (ex.: menciona "firewall", "dns"/"zona", "proxied" + "lets encrypt"/"stack completo").
- `llm`: `apps/web/lib/llm-planner.ts` chama um endpoint de chat completions (compatível OpenAI) para gerar o Plan JSON, com o plano rules-based como fallback caso a chamada falhe ou retorne uma ação fora da lista permitida.

Em ambos os modos, o plano final passa pelo mesmo fluxo de revisão/confirmação/fila — o usuário nunca perde a chance de revisar antes de executar.

## Rodando

### Com Docker (produção/staging)

```bash
cp .env.example .env   # preencha LLM_API_KEY
docker compose up -d --build
```

Acesse `http://localhost:3000`.

### Localmente, sem Docker (desenvolvimento)

```bash
npm --prefix apps/web run dev            # porta 3000
npm --prefix services/mcp-server run dev # porta 3333
```

Sem Redis rodando localmente, a geração de plano e o preview de DNS funcionam normalmente, mas a fila de execução (`/api/execute`) não avança — suba o Redis (`docker run -p 6379:6379 valkey/valkey:7-alpine`) ou use o `docker compose up -d --build` completo para testar o fluxo de execução ponta a ponta.

### Variáveis de ambiente

| Variável | Onde | Descrição |
|---|---|---|
| `LLM_API_KEY` | `.env` (raiz) | Chave do endpoint de LLM usado quando `AGENT_PLANNER_MODE=llm`. Nunca commitar — `.env` já está no `.gitignore`. |
| `AGENT_PLANNER_MODE` | `docker-compose.yml` (serviço `web`) | `rules` ou `llm`. |
| `LLM_MODEL`, `LLM_BASE_URL`, `LLM_CHAT_PATH` | `docker-compose.yml` | Configuração do endpoint de LLM. |
| `AZION_API_BASE_URL` | `docker-compose.yml` (serviço `mcp`) | Base da API v4 da Azion. |
| `REDIS_URL` | `docker-compose.yml` | Conexão do Redis Streams. |

## Deploy contínuo

Todo push em `main` dispara `.github/workflows/deploy.yml`, que conecta via SSH na instância SaveinCloud e roda `git fetch` + `git reset --hard origin/main` + `docker compose up -d --build` em `/opt/azion-ai-agent-mvp`. Requer os secrets do repositório `SSH_HOST`, `SSH_USER`, `SSH_PORT` e `SSH_PRIVATE_KEY`.

## Segurança

Pensado para uso em rede interna/VPN. Mesmo assim:

- O API Token da Azion só existe no navegador e no payload da mensagem da fila — nunca é persistido em disco.
- O worker confirma (`XACK`) e remove (`XDEL`) a mensagem da fila assim que a execução termina.
- Nunca cole tokens (Azion, GitHub, etc.) em lugares que ficam registrados/versionados — se isso acontecer por engano, revogue o token imediatamente.
- Para produção real, prefira criptografar o token no backend e trafegar apenas um `execution_id` pela fila.

## Limitações conhecidas

- O WAF do template de Firewall é sempre criado novo por conta (não é compartilhado entre contas/clientes).
- As Network Lists usadas nas regras de rate-limit do template de Firewall ainda referenciam IDs fixos da conta de origem da sandbox — ao criar em outra conta, podem exigir remapeamento manual (mesma classe de problema que já foi corrigida para o WAF).
- A criação de zona DNS é idempotente (reaproveita zona existente pelo domínio), mas a exclusão de zonas/registros DNS não é feita pelo agente — use o console da Azion.
- O registro `_acme-challenge` é sempre criado manualmente pelo agente; zonas já hospedadas na Edge DNS da Azion podem completar o desafio DNS-01 automaticamente segundo a documentação — ainda não validamos se isso torna o passo manual redundante.
