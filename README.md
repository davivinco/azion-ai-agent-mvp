# Azion AI Agent — MVP

MVP interno para operar recursos da Azion por chat usando:

- Next.js para front e API routes.
- Layout de chat no estilo assistente, com identidade visual inspirada na Azion.
- Worker com Redis Streams direto.
- Valkey/Redis para fila e status.
- Serviço `mcp-server` como executor de tools.
- Templates extraídos da sandbox:
  - Firewall `44495`
  - Application `1756827464`

> Status padrão definido: tudo é criado como `active: false`, a menos que o usuário peça explicitamente para criar ativo.

## Rodando

```bash
docker compose up -d --build
```

Acesse:

```text
http://localhost:3000
```

## Fluxo

1. Usuário informa API Token no front.
2. Usuário escreve comando no chat.
3. O backend gera um plano.
4. O usuário confirma.
5. O job entra na fila Redis Streams.
6. O worker chama o executor de tools.
7. O status aparece no chat.

## Comandos de exemplo

```text
Crie um firewall default chamado "Firewall Template"
```

```text
Crie um firewall default chamado "Firewall Template" ativo
```

```text
Crie uma application e workload chamado "Loja Teste" para loja.example.com
```

```text
Importar DNS para example.com com A @ 1.2.3.4
```

## Onde o LLM entra

Nesta versão MVP, o LLM ainda **não está executando a interpretação**. O endpoint `POST /api/plan` usa um planner determinístico em `apps/web/lib/planner.ts`.

A arquitetura já está pronta para receber o LLM no lugar do planner atual:

```text
Prompt do usuário
  ↓
/api/plan
  ↓
LLM gera JSON estruturado
  ↓
backend valida schema
  ↓
usuário confirma
  ↓
fila Redis Streams
  ↓
worker
  ↓
mcp-server
  ↓
Azion API v4
```

Mais detalhes estão em `docs/llm-integration.md`.

## Network Lists

O template de Firewall não usa mais o ID fixo da Network List de TOR.

Durante a execução, o `mcp-server` consulta:

```text
GET /workspace/network_lists
```

E procura a Network List pelo nome exato:

```text
Azion IP Tor Exit Nodes
```

Depois ele substitui o ID antigo do template antes de criar as Rules Engine.

## Limitações atuais

Este MVP já tem o esqueleto da infraestrutura e as tools principais, mas ainda precisa de validação mais ampla antes de produção.

Pontos importantes:

- O export de origem da Application retornou 404 em `/origins`, então o MVP trata origem como Connector v4.
- A Application não depende mais do Connector `520`: o executor cria um Connector HTTP novo apontando para `httpbingo.org`.
- Quando o usuário não informa domínio, o plano gera um domínio aleatório no formato `xxxxxxxxxx.com.br` para o Workload.
- A Network List de TOR é resolvida por nome: `Azion IP Tor Exit Nodes`.
- O template ainda referencia WAF `14289` e Function base `51884`; em outra conta, esses IDs podem exigir mapeamento por nome depois.

## Defaults do template de Application

```text
Connector HTTP: httpbingo.org
Workload domain: aleatório .com.br quando não informado
Application active: false por padrão
Connector active: false por padrão
Workload active: false por padrão
Rules active: false por padrão
```

## Estrutura

```text
azion-ai-agent-mvp/
├── apps/web
├── services/mcp-server
├── services/worker
├── packages/templates
└── docker-compose.yml
```

## Segurança

Este MVP foi pensado para rede interna/VPN. Mesmo assim:

- O token é informado no front e enviado para o backend no momento da execução.
- O token entra no payload da mensagem do Redis Stream.
- O worker executa, confirma com `XACK` e remove a mensagem com `XDEL`.
- Para produção, prefira criptografar o token no backend e colocar apenas `execution_id` na mensagem.

## Fix aplicado - Firewall Function Instance

A API da Azion não permite criar Function Instance de Edge Firewall com `active=false`.
Por isso, o MVP cria o Firewall e as Request Rules respeitando o padrão `active=false`, mas omite o campo `active` no payload da Function Instance.

Sem esse ajuste, a criação parava antes de criar as Rules Engine com erro `29002 - Cant Deactivate Function Instance`.
