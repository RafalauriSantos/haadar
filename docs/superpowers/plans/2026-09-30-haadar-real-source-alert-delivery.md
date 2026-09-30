# Checklist 2 — First Real Source & Alert Delivery

**Status:** em execução; Marcos 1 e 2 concluídos e verificados.
**Data:** 30/09/2026.
**Base inspecionada:** commit `6849bc1` e SPEC-001 aprovada.
**Objetivo:** descobrir uma vaga de uma fonte pública real, persistir sua evidência, avaliá-la, entregar um alerta no destino escolhido e demonstrar recuperação de falhas com consumo controlado.
**Execução:** sequencial, um marco verificado e commitado antes do próximo. Testes locais, integração Cloudflare e entrega ao destinatário são evidências diferentes.

## 1. Estado de partida e correção do registro anterior

A primeira checklist foi marcada como concluída com evidência insuficiente para alguns requisitos. Seus commits permanecem como história real; esta fase retoma esses requisitos sem presumir que já funcionam em produção.

| Evidência no código atual | Consequência | Marco responsável |
|---|---|---|
| `src/index.ts` fornece uso zero ao coordenador | Budget Guard não considera consumo acumulado | 4 |
| Coordenador retorna tarefas novamente em chamadas repetidas | Unicidade SQL não impede republicação na Queue | 2 |
| Handler `queue` ignora `ConsumerResult` | Retry solicitado pelo consumidor pode ser confirmado como sucesso | 3 |
| Deduplicação do consumidor usa Set por batch | Não comprova idempotência entre entregas/processos | 2–3 |
| Consumidor só persiste observations/diagnostics | Gate, Early Signal, decisão e outbox não integram a execução | 7 |
| `emptyHealthSummary()` retorna valores fixos | Não há diagnóstico operacional derivado do banco | 9 |
| Enrichment é uma função comum | Não constitui um Cloudflare Workflow durável | 8 |
| Adapter atual produz `jobs.example` | Evidência anterior é sintética, não vaga coletada | 5–6 |
| Testes SQL inspecionam strings com fakes | Constraints e concorrência precisam de execução em D1 local | 1–2 |

Um dry-run não comprova execução de Cron, entrega de Queue, custo zero, envio de alerta nem operação contínua. O ensaio anterior com Queue local e D1 remoto continua válido somente para esse escopo.

## 2. Direção e limites desta fase

- Preservar Cloudflare, backend-only, rodadas de 90 minutos e Free-First da SPEC-001.
- Começar por um ATS público com resposta estruturada. Greenhouse é a proposta inicial, condicionada à validação da documentação e de um board público no Marco 5; RSS é alternativa se houver incompatibilidade documentada.
- Usar um adapter por ATS e um registro de boards. Não criar um coletor por empresa.
- Preferir Telegram como primeiro canal, sujeito à escolha do destino pelo usuário. Não reutilizar credenciais ou destinatários de outro projeto por inferência.
- Não habilitar IA paga nem depender de IA para alertar. O caminho determinístico deve ser suficiente.
- Fixtures permanecem nos testes; nunca contam como oportunidade real ou evidência de cobertura.
- Não editar `0001_initial.sql` já aplicada remotamente. Usar novas migrations incrementais, sem apagar os dados existentes.
- Revalidar limites dos serviços antes do deploy e verificar consumo compartilhado da conta. Não presumir que toda a quota gratuita está disponível para Haadar.
- Registrar escolhas e evidências no repositório sem segredos, IDs privados de destinatário ou conteúdo pessoal.

## 3. Regras para fechar cada marco

1. Escrever o cenário de falha/comportamento esperado antes da implementação.
2. Implementar o menor conjunto coeso que atende ao cenário.
3. Executar testes focados e a suíte completa após a integração, além do typecheck.
4. Revisar o diff, atualizar apenas os itens comprovados e registrar limitações.
5. Commit e push após verificação; em falha, corrigir antes de avançar.

Comandos existentes: `npm run typecheck`, `npm test`, `git diff --check`.
Scripts a introduzir no Marco 1: `npm run test:integration` e `npm run check` (typecheck e testes com interrupção no primeiro erro).
Nunca encadear deploy após verificações que falharam. Contagem de testes não substitui cobertura dos requisitos abaixo.

## Marco 1 — Testes de integração e ambientes isolados

**Arquivos:** `package.json`, lockfile, `vitest.config.ts`, `tests/integration/`, `tests/helpers/`, `wrangler.toml`, runbook.
**Depende de:** nenhuma tarefa de código desta fase.

- [x] Fixar versões compatíveis das ferramentas e revisar as vulnerabilidades reportadas; registrar resolução ou impacto e impedimentos para deploy.
- [x] Configurar testes com runtime Workers e D1 local real. Executar migrations em banco descartável por suíte.
- [x] Separar desenvolvimento, staging e produção; remover acesso remoto implícito no desenvolvimento padrão.
- [x] Introduzir scripts de verificação que parem em falhas e não façam deploy automaticamente.
- [x] Executar testes de constraints, foreign keys e rollback, sem substituir o banco por um gravador de SQL.
- [x] Documentar qual comando usa banco local e qual usa recursos remotos.

**Aceite:** testes não requerem token Cloudflare e não escrevem no D1 de produção; uma violação real de constraint faz o teste falhar.
**Commit:** `test: add isolated Workers and D1 integration harness`.

## Marco 2 — Identidade, proveniência e publicação recuperável

**Arquivos:** novas migrations `0002_discovery_reliability.sql`, `src/storage/d1.ts`, `src/domain/{types,ids}.ts`, `src/discovery/round-coordinator.ts`, `tests/integration/discovery.test.ts`.

- [x] Definir slots UTC de 90 minutos com âncora 00:00; validar datas inválidas, virada de dia e equivalência de fusos.
- [x] Tornar a serialização de partes da chave não ambígua, inclusive quando o separador aparece no conteúdo.
- [x] Retornar o round persistido em `createOrGetRound`, preservando revisão do portfólio e orçamento da primeira admissão.
- [x] Persistir snapshot imutável do portfólio e planos de tarefas na mesma unidade transacional de criação do round.
- [x] Criar publicação pendente/claim com lease para tarefas: falha após commit e antes de enviar deve ser recuperável; envio seguido de crash pode redeliver sem duplicar efeitos.
- [x] Separar vaga canônica de ocorrências por fonte/query/round; preservar todas as atribuições sem multiplicar oportunidades.
- [x] Resolver conflitos por ID de fonte, URL e fingerprint com retorno de identidade persistida. Similaridade incerta gera evidência de possível duplicata, não fusão silenciosa.
- [x] Migrar observations existentes preservando IDs usados pelas decisões e marcar origem sintética para excluir das métricas reais.

**Testes:** duas admissões simultâneas do mesmo slot; outra revisão no retry; falha entre persistência e envio; mesma vaga por duas queries; URL alterada com mesmo ID; duas vagas parecidas mas distintas; reaplicação de migrations sem perda.
**Aceite:** um round lógico por slot, publicação recuperável e rastreabilidade de cada discovery no banco.
**Commit:** `fix: persist discovery identity and recoverable task publication`.

## Marco 3 — Queue, retries e conclusão de rounds

**Arquivos:** `src/index.ts`, `src/queue/{consumer,messages}.ts`, `src/storage/tasks.ts`, `tests/integration/queue.test.ts`, `wrangler.toml`.

- [x] Validar schema e tamanho das mensagens antes de executar; mensagens inválidas têm motivo terminal.
- [x] Usar claim persistido com lease; task concluída não executa novamente após reinício ou outro batch.
- [x] Encaminhar resultado para `message.ack()` ou `message.retry()` individualmente; usar tentativas reais da Queue, sem confiar em `body.attempt` congelado.
- [x] Classificar `permanent`, `blocked` e `schema_changed` como terminais; `retryable` e `throttled` respeitam limite e backoff com jitter.
- [x] Não confirmar sucesso quando a persistência falha; registrar falha sem expor resposta remota ou credenciais.
- [x] Configurar tamanho/concurrency de batch, retries e rota de trabalho esgotado compatíveis com orçamento.
- [x] Persistir status de tasks e agregar round em completed/partial/deferred; reconciliar leases expirados e impedir round eternamente running.
- [x] Provar recuperação quando Queue expira mensagem: tarefas persistidas continuam recuperáveis dentro da política de staleness.

**Testes:** duplicate delivery em batches separados, concorrência, crash após insert, 429, erro permanente, tentativas esgotadas e batch misto.
**Aceite:** falha de uma task não perde as outras; retries são observáveis e rounds alcançam estado terminal.
**Commit:** `fix: honor queue retries and persist task lifecycle`.

## Marco 4 — Budget Guard ligado ao consumo

**Arquivos:** `src/config.ts`, `src/budget/budget-guard.ts`, `src/observability/usage-ledger.ts`, `src/discovery/round-coordinator.ts`, nova migration de reservas, testes de orçamento.

- [ ] Ler consumo e reservas do dia UTC antes da admissão; eliminar usage fixo em zero no scheduler.
- [ ] Reservar custo estimado de forma atômica antes de enviar tarefas; ajustar após execução sem contar duas vezes o mesmo evento.
- [ ] Contar Queue write/read/delete/retries, D1 rows e custos do próprio controle; distinguir estimativa de medição disponível.
- [ ] Fazer orçamento por custo marginal e capacidade restante, não apenas por estado no início do round.
- [ ] Configurar thresholds sem sobreposição, reserva de emergência e teto por round/source; uso inválido ou desconhecido degrada conservadoramente.
- [ ] Reduzir EXPERIMENTAL já em CONSERVATIVE, parar enrichment em ESSENTIAL e impedir nova admissão em EMERGENCY.
- [ ] Desacoplar cota esgotada de IA da coleta essencial quando os recursos essenciais têm capacidade.
- [ ] Documentar consumo de outros projetos da conta e margem operacional para analytics atrasados.

**Testes:** concorrência disputando última reserva, repetição de evento, reset UTC, números inválidos, aumento de batch e esgotamento isolado de IA.
**Aceite:** tarefa não cabe no orçamento não é publicada; estado e motivo são persistidos.
**Commit:** `feat: enforce persisted discovery budgets`.

## Marco 5 — Contrato da primeira fonte pública

**Arquivos:** `docs/sources/first-source.md`, `src/portfolio/sources.ts`, `src/portfolio/query-portfolio.ts`, `src/adapters/adapter.ts`.

- [ ] Consultar documentação oficial do ATS e registrar URL, data, campos, paginação e política de acesso.
- [ ] Selecionar um board público verificável e pequeno para o piloto; documentar limites de cobertura desse recorte.
- [ ] Definir hosts permitidos, timeout, limite de bytes, páginas, registros e requests por task antes de qualquer coleta.
- [ ] Modelar board/source e queries aplicáveis; ATS que lista board inteiro é buscado uma vez e atribuído a várias queries localmente.
- [ ] Definir famílias BROAD/ROLE/STACK/CONTEXT/COMPANY/EXPERIMENTAL sem obrigar stack no título.
- [ ] Registrar como title, descrição, URL, localidade, modelo de trabalho e timestamps serão mapeados; não converter updated_at em published_at.
- [ ] Registrar perfil de relevância configurável: função, senioridade, localidade/remoto e exclusões. Não assumir dados ausentes.

**Aceite:** documento identifica uma fonte real acessível, contrato e orçamento; seleção é reproduzível e não depende de login/scraping proibido.
**Commit:** `docs: define first public ATS source contract`.

## Marco 6 — Adapter real e normalização

**Arquivos previstos para Greenhouse:** `src/adapters/greenhouse.ts`, `src/adapters/http.ts`, `src/normalization/vacancy.ts`, `tests/adapters/greenhouse.test.ts`, fixtures públicas minimizadas.

- [ ] Implementar fetch com timeout, limite durante leitura do corpo, allowlist e validação de redirects.
- [ ] Validar resposta e classificar 429/Retry-After, 5xx, 401/403, HTML inesperado, JSON inválido e schema alterado.
- [ ] Implementar paginação/checkpoint quando a fonte exigir, com teto e indicação explícita de coleta parcial.
- [ ] Normalizar texto, URLs e IDs estáveis; manter observedAt real e publication time somente quando fornecido com semântica conhecida.
- [ ] Calcular fingerprint versionado e preservar evidência/proveniência mínima antes de decisões.
- [ ] Substituir FixtureAdapter no registro de produção; fixtures só são ativadas em ambiente de teste explícito.
- [ ] Executar uma coleta limitada da fonte real e registrar contagens e um exemplo público verificável sem enviar alerta ainda.

**Testes:** resposta vazia, campo ausente, payload grande, timeout, redirects não permitidos, repetição da coleta e mudanças de URL/descrição.
**Aceite:** uma vaga real verificável chega ao D1; segunda coleta preserva identidade e adiciona atribuição quando necessário.
**Commit:** `feat: collect real vacancies from first ATS`.

## Marco 7 — Decisões persistidas e Early Signal integrado

**Arquivos:** `src/decision/pipeline.ts`, módulos de decisão existentes, `src/queue/consumer.ts`, `src/storage/decisions.ts`, testes de integração, migration incremental de evidências.

- [ ] Conectar o consumidor ao pipeline somente depois da persistência confirmada.
- [ ] Persistir gate, versões, evidências, score e decisão ligados à vaga/observation.
- [ ] Separar aderência ao perfil da query que descobriu a vaga; query ampla não deve rejeitar oportunidade boa por ausência literal de termos.
- [ ] Corrigir freshness: presença de publishedAt não significa vaga recente; testar idade com relógio injetado e timestamps futuros/inválidos.
- [ ] Emitir Early Signal provisório somente para candidata que passe critério explícito, sem esperar todo o round.
- [ ] Gravar decisão e intenção de notificação atomicamente; unicidade por vaga/canal/destinatário impede alertas indevidos cross-query.
- [ ] Final Decision referencia o Early Signal; atualização do alerta existente é preferida a novo envio. Descarte posterior preserva histórico e motivo.
- [ ] Provar fluxo até outbox com IA e Workflow indisponíveis.

**Testes:** exclusão, perfil aderente sem stack no título, vaga antiga com data, missing timestamp, reprocessamento com regra diferente, redelivery após decisão.
**Aceite:** toda intenção de alerta tem evidência persistida e motivo; Early Signal não espera enrichment.
**Commit:** `feat: connect persisted decisions and early alert intents`.

## Marco 8 — Workflow durável e IA opcional

**Arquivos:** `src/workflows/enrichment.ts`, `src/ai/enrichment.ts`, `wrangler.toml`, testes Workers/Workflow e migrations de provenance.

- [ ] Implementar Workflow Cloudflare real, com binding, entrypoint e etapas persistidas; nome de arquivo não comprova durabilidade.
- [ ] Iniciar somente candidatas aprovadas pelo gate e budget, com identidade determinística da instância.
- [ ] Reservar steps/estado e limitar retries/retention; retomada não repete efeitos de notificação.
- [ ] Limitar input/output e validar campos/tipos/faixas de uma resposta estruturada; qualquer objeto não é schema válido.
- [ ] Selecionar modelo apenas após comprovar elegibilidade Free na documentação vigente; manter desligado por configuração no piloto inicial.
- [ ] Persistir modelo, versão de prompt, validação e fallback sem conteúdo sensível.
- [ ] Simular ausência, 429, timeout e resposta malformada; Final Decision determinística continua disponível.

**Aceite:** teste de retomada demonstra estado durável; todas as falhas opcionais preservam o caminho determinístico.
**Commit:** `feat: add durable selective enrichment workflow`.

## Marco 9 — Saúde operacional, métricas e retenção

**Arquivos:** `src/observability/{events,usage-ledger,health}.ts`, `src/maintenance/retention.ts`, `docs/runbooks/free-tier-operations.md`, testes de integração.

- [ ] Implementar resumo consultando D1: último round terminal, cobertura 24h, budget, falhas, backlog e outbox.
- [ ] Diferenciar liveness pública de diagnóstico autenticado; não expor dados operacionais pessoais em `/health`.
- [ ] Medir brutas/únicas/exclusivas por query/fonte, elegíveis, sinais, alertas confirmados e latências com denominadores claros.
- [ ] Registrar applications somente quando informado pelo usuário/fluxo autorizado; não inferir candidatura a partir de clique.
- [ ] Usar logs com allowlist de campos e limites de tamanho, removendo URLs de bot/tokens e erros remotos brutos.
- [ ] Proteger first-seen, identidade e evidências de alertas por relações explícitas no schema; não depender apenas de presença de decisão.
- [ ] Executar retenção em lotes limitados; testar preservação de alertas e simular dry-run antes de execução remota.
- [ ] Documentar indisponibilidade D1, Queue esgotada, origem bloqueada e envio ambíguo.

**Aceite:** cada campo do resumo corresponde a consulta real; retenção tem teste de integridade e nenhuma métrica sintética mistura-se às reais.
**Commit:** `feat: expose verified operational health and retention`.

## Marco 10 — Canal real e entrega recuperável

**Arquivos previstos para Telegram:** `src/notifications/{telegram,dispatcher,outbox}.ts`, migration incremental de entrega, testes e `docs/runbooks/alert-delivery.md`.

- [ ] Confirmar canal, bot e destinatário para o piloto. Registrar somente nomes dos secrets; provisionar valores pelo mecanismo seguro da Cloudflare.
- [ ] Definir cartão com título, empresa, localização, origem, link e indicação de provisional/final; limitar tamanho e escapar formatação.
- [ ] Introduzir estados pending/sending/sent/retryable/failed/unknown, lease, tentativas, próxima tentativa e ID de mensagem do provedor.
- [ ] Implementar dispatcher com claim atômico e orçamento; integração pode ocorrer no Worker/Workflow sem fila por etapa.
- [ ] Validar sucesso pela resposta do provedor e persistir o message ID; mapear 429, destino inválido e falha transitória.
- [ ] Tratar timeout após possível aceitação como unknown. Sem idempotency key no provedor, não prometer exactly-once nem reenviar cegamente.
- [ ] Atualizar mensagem de Early Signal na conclusão quando o canal permitir; manter registro de tentativa e resultado.
- [ ] Fazer um envio controlado ao destino aprovado e confirmar recebimento. Teste automatizado usa provedor simulado.

**Testes:** concorrência de dispatchers, crash antes/depois do envio, 429, 403, timeout ambíguo e repetição do mesmo alerta.
**Aceite:** mensagem real recebida e rastreável ao D1; retry não duplica mensagem já confirmada; ambiguidade é visível.
**Commit:** `feat: deliver vacancy alerts through first channel`.

## Marco 11 — Ensaio completo em produção

**Arquivos:** configuração por ambiente, `docs/validation/phase-2-production.md`, runbooks e checklist.

- [ ] Verificar plano da conta, quotas compartilhadas, limites atuais e secrets antes de ativar coleta.
- [ ] Testar migrations sobre cópia local representativa e aplicar as novas migrations no ambiente alvo; não recriar banco existente.
- [ ] Publicar somente após `npm run check` aprovado e revisão do diff; registrar SHA e versão Cloudflare.
- [ ] Executar round controlado por mecanismo administrativo autenticado com idempotência e limite de uso, ou aguardar Cron real. Não criar endpoint público de disparo.
- [ ] Confirmar produtor e consumidor remotos, task terminal, vaga real, decisão persistida, outbox enviada e recebimento.
- [ ] Repetir o mesmo slot/task e comprovar não duplicação; observar falha transitória controlada em ambiente isolado.
- [ ] Registrar evidência de execução remota da Queue; Queue local com D1 remoto não substitui esta etapa.
- [ ] Observar pelo menos duas rodadas agendadas consecutivas e 24 horas de uso: 16 slots esperados, incluindo skips justificados. Não marcar a janela concluída antes de transcorrida.
- [ ] Conferir uso real disponível e estimativas, alertas de quota, margem e inexistência de dependência paga; registrar limitações da visibilidade de faturamento.
- [ ] Registrar resultado de amostra manual de relevância e vagas perdidas conhecidas, sem inventar recall.

**Aceite:** evidências datadas ligam versão publicada, rounds, tasks, vagas e mensagens. Encerramento exige janela de observação cumprida, não apenas teste pontual.
**Commit:** `test: verify real discovery and alert delivery in production`.

## Marco 12 — Encerramento e baseline comparável

**Arquivos:** `README.md`, ambas as checklists, relatório de validação, `docs/decisions/phase-2-decisions.md`.

- [ ] Reconciliar os itens marcados na checklist inicial com as provas desta fase; preservar a nota de que a validação anterior foi parcial.
- [ ] Documentar fonte, boards cobertos, canal, limites operacionais e funcionalidades ainda opcionais/desligadas.
- [ ] Definir comparação com Job Finder na mesma janela e recorte de fontes, distinguindo cobertura diferente de defeito.
- [ ] Conferir cada critério da SPEC contra teste, consulta ou log específico; pendência sem evidência continua aberta.
- [ ] Confirmar commit/push, estado limpo e ausência de credenciais ou dados privados no diff.

**Aceite:** README descreve somente comportamentos comprovados; nenhum item é fechado apenas por existir função ou teste superficial.
**Commit:** `docs: close verified real-source delivery milestone`.

## Checklist de saída

- [ ] Migrations e recuperação verificadas em D1 real local.
- [ ] Round/republication e Queue redelivery seguros entre processos.
- [ ] Budget baseado em uso/reservas persistidos e reconciliado com quota da conta.
- [ ] Uma fonte ATS real com coleta limitada e contrato documentado.
- [ ] Proveniência cross-query e identidade canônica preservadas.
- [ ] Pipeline persist-first conectado a decisões e Early Signal.
- [ ] Workflow durável verificado; IA opcional falha sem bloquear core.
- [ ] Alerta real entregue ao destino aprovado e identificado no banco.
- [ ] Saúde/retention verificadas com dados reais.
- [ ] Ensaio integral com Queue remota e duas rodadas consecutivas.
- [ ] Janela de 24 horas concluída com métricas e quotas revisadas.
- [ ] Histórico incremental publicado e documentação reconciliada.

## Escolhas necessárias durante a execução

O planejamento pode ser revisado sem credenciais. Antes dos respectivos marcos: selecionar board/perfil de vagas no Marco 5 e confirmar canal/destinatário no Marco 10. Não bloquear testes locais por essas escolhas, nem preencher dados privados por suposição. Esta checklist não autoriza envio a terceiros não identificados.
