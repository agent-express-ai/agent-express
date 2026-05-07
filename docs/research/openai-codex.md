# Codex Architecture Research & Сравнение с Anthropic Managed Agents

> Research-документ по результатам анализа кодовой базы `openai/codex` (commit `70807730f5`, ветка `main`).
> Цель: разобрать архитектуру, понять, какие точки расширения есть для managed-cloud сценария,
> и сравнить стратегию OpenAI с тем, что делает Anthropic в Managed Agents.

## Содержание

1. [Общая карта репозитория](#1-общая-карта-репозитория)
2. [Архитектура `app-server`](#2-архитектура-app-server)
3. [Архитектура `core` и хранение сессий](#3-архитектура-core-и-хранение-сессий)
4. [Что будет, если процесс упадёт](#4-что-будет-если-процесс-упадёт)
5. [Точки расширения для managed cloud](#5-точки-расширения-для-managed-cloud)
6. [Сравнение с Anthropic Managed Agents](#6-сравнение-с-anthropic-managed-agents)
7. [Главные выводы, тренды и инсайды](#7-главные-выводы-тренды-и-инсайды)

---

## 1. Общая карта репозитория

```
codex/
├── codex-cli/   ← npm-обёртка (~50 строк JS, выбирает бинарник по платформе)
├── codex-rs/    ← Cargo workspace (~120 крейтов) — ВСЯ логика
├── sdk/         ← TS и Python SDK, дёргают бинарник codex
└── docs/        ← пользовательская документация
```

`codex-cli/bin/codex.js` просто резолвит `@openai/codex-<platform>` и форвардит аргументы.
SDK тоже не реализуют агентов: TS-SDK (`sdk/typescript/src/exec.ts`) спавнит `codex exec`,
Python-SDK (`sdk/python/src/codex_app_server/client.py`) общается JSON-RPC с `app-server`.

### Карта `codex-rs/` по слоям

**1. Точки входа (бинарники)**
- `cli/` — мультитул, бинарник `codex`. `cli/src/main.rs` — большой `enum Subcommand` с `Exec`,
  `Review`, `Login`, `Mcp`, `McpServer`, `AppServer`, `App`, `Sandbox`, `Debug`, `Resume`, `Fork`,
  `Cloud`, `ExecServer`, `ResponsesApiProxy`, `Apply`, `Plugin`, `Features`. По дефолту запускает TUI.
- `tui/` — интерактивный TUI на Ratatui.
- `exec/` — headless CLI (`codex exec`).
- `mcp-server/` — Codex как MCP-сервер для других агентов.
- `app-server/` — JSON-RPC сервер, центральный бэкенд для UI-поверхностей.
- `exec-server/`, `responses-api-proxy/`, `stdio-to-uds/`, `cloud-tasks/` — вспомогательные сервисы.

**2. Ядро — `core/`**
- `session/` — `Session`, `Turn`, `TurnContext`, multi-agent, review, восстановление rollout.
- `agent/` — `AgentControl`, `Mailbox`, `registry`, статусы агентов.
- `tools/` — `ToolRouter`, `orchestrator`, `parallel`, `runtimes`, `handlers`, `code_mode`.
- `client.rs` — клиент к LLM (OpenAI Responses/Chat API).
- `mcp.rs`, `mcp_tool_call.rs`, `mcp_tool_exposure.rs` — MCP-клиент внутри ядра.
- `skills.rs`, `plugins/` — скилы и плагины.
- `rollout.rs`, `thread_manager.rs`, `codex_thread.rs` — треды и их персистентность.
- `compact.rs` — компакция истории.
- `config/`, `safety.rs`, `exec_policy.rs`, `landlock.rs`, `windows_sandbox.rs`.

**3. Протоколы и контракты**
- `protocol/` — низкоуровневые типы.
- `app-server-protocol/` — JSON-RPC v1+v2 + experimental, кодогенерация TS-типов и JSON-схем.
- `core-api/`, `codex-api/`, `codex-experimental-api-macros/` — стабильные API ядра.

**4. App-server слой (главная архитектурная связка)**
- `app-server/` — крутится либо в процессе TUI/exec, либо как отдельный сервер.
- `app-server-client/` — обёртка для UI-поверхностей: `InProcessAppServerClient` и
  `RemoteAppServerClient` (через сокет/WS).
- `app-server-transport/`, `app-server-test-client/`, `debug-client/`.

**5. Возможности/runtime крейты:** `sandboxing`, `linux-sandbox`, `windows-sandbox-rs`,
`execpolicy(-legacy)`, `apply-patch`, `shell-command`, `process-hardening`, `network-proxy`,
`tools`, `hooks`, `skills`, `plugin`, `code-mode`, `model-provider`/`model-provider-info`/
`models-manager`, `ollama`, `lmstudio`, `chatgpt`, `connectors`, `realtime-webrtc`, `mcp`,
`rmcp-client`, `login`, `keyring-store`, `aws-auth`, `device-key`, `secrets`, `agent-identity`,
`agent-graph-store`, `feedback`, `features`, `analytics`, `otel`, `file-search`, `file-system`,
`git-utils`.

**6. Состояние/память:** `state/`, `thread-store/`, `rollout/`, `rollout-trace/`,
`memories/{read,write,mcp}` — БД сессий, дамп тредов, длинная память.

**7. Утилиты:** `utils/*` (~25 мелких крейтов), `terminal-detection`, `arg0`, `async-utils`,
`ansi-escape`, `uds`, `vendor`, `test-binary-support`.

### Как они общаются

```
                       ┌────────────────────────────┐
   user → npm codex →  │  cli/  (clap, argv router) │
                       └─────────────┬──────────────┘
                                     │ subcommand
            ┌────────────────┬───────┼────────────┬─────────────┐
            ▼                ▼       ▼            ▼             ▼
          tui/            exec/   mcp-server/   app-server/   responses-api-proxy/
            │                │       │            ▲                 ▲
            └─via app-server-client──┘            │                 │
                       (in-process │ remote)      │                 │
                                   │              │                 │
                                   ▼              ▼                 │
                             ┌────────────────────────────┐         │
                             │         core/              │         │
                             │ ThreadManager / Session    │         │
                             │ ToolRouter / Agent control │         │
                             │ ModelClient → OpenAI       ├─────────┘
                             │ McpManager → MCP-серверы   │
                             │ RolloutRecorder → state    │
                             └────────────────────────────┘
                                ▲      ▲      ▲       ▲
                                │      │      │       │
                       sandboxing  execpolicy hooks  skills/plugins
                       apply-patch model-provider login/keyring
                       memories    rollout      protocol (types)
```

**Ключевая идея:** TUI и `exec` **не зовут `core` напрямую** — они идут через
`app-server-client → app-server (JSON-RPC) → core`. Тот же канал использует Python SDK и
IDE-расширения. `app-server-client` умеет работать в in-process режиме (поднимает app-server
тредом в процессе TUI) или remote (через UDS/WS), и переключение прозрачно.

---

## 2. Архитектура `app-server`

App-server — это процесс-«брокер» между UI-поверхностями и `core`. Три роли:

1. **Стабильный wire-API** для VS Code extension, TUI (`--remote`/in-process), `exec`,
   Python SDK, IDE-плагинов. Все говорят с ним одинаковым JSON-RPC 2.0.
2. **Single source of truth** для треда, конфига, MCP-клиентов, login, плагинов, скилов, telemetry.
3. **Долгоживущий runtime**: один процесс может пережить отключение/переподключение клиента,
   держать живой тред с running turn, и снова отдать его клиенту через `thread/resume`.

### Карта крейтов

```
app-server-protocol/    ← типы wire-формата (v1/v2 + experimental), JSON-RPC, schema export
app-server-transport/   ← транспорты (stdio/unix/ws/remote-control), auth, ConnectionId, OutgoingMessage
app-server/             ← сам сервер: MessageProcessor + 20 request_processors + outbound loop
app-server-client/      ← клиент-фасад (in-process + remote ws), используют TUI/exec
app-server-test-client/ ← test-харнес для интеграционных тестов
```

### Внутренности `app-server/`

Точка входа — `run_main_with_transport()` в `lib.rs:387`. Поднимает:

```
run_main_with_transport_options
├─ EnvironmentManager      (для exec-server: бинарь codex и codex-linux-sandbox)
├─ ConfigManager           (загружает Config, поддерживает переоткладку)
├─ AuthManager             (shared, см. login crate)
├─ state_db (sqlite)       (rollouts, threads, goals)
├─ otel provider           (telemetry)
├─ MessageProcessor        (диспетчер JSON-RPC методов)
├─ Outbound router task    (отдельный tokio task для медленных writes)
├─ Transport acceptor      (stdio | unix | ws | off)  + опц. remote-control
└─ shutdown signal handler (graceful drain → force on второй Ctrl-C)
```

### Два tokio-loop'а, не один

В `lib.rs:123-131` явно:

> processor loop: handles incoming JSON-RPC and request dispatch
> outbound loop: performs potentially slow writes to per-connection writers

Их связывает `OutboundControlEvent` (`Opened`/`Closed`/`DisconnectAll`). Между ними — `mpsc`
каналы с `CHANNEL_CAPACITY = 128`. Write на медленный сокет не должен тормозить парсинг.

### MessageProcessor

В `message_processor.rs:155-178` — диспетчер с полем для каждого функционального домена:
`account_processor`, `apps_processor`, `catalog_processor`, `command_exec_processor`,
`process_exec_processor`, `config_processor`, `device_key_processor`,
`external_agent_config_processor`, `feedback_processor`, `fs_processor`, `git_processor`,
`initialize_processor`, `marketplace_processor`, `mcp_processor`, `plugin_processor`,
`search_processor`, `thread_goal_processor`, `thread_processor`, `turn_processor`,
`windows_sandbox_processor`.

`process_request()` — большой `match` по `ClientRequest` (~80+ методов).

### Per-connection state

В `transport.rs:31` — `ConnectionState` и `OutboundConnectionState`:
- `outbound_initialized: AtomicBool` — прошёл ли `initialize`/`initialized` хендшейк.
- `outbound_experimental_api_enabled: AtomicBool` — включил ли клиент опт-ин на experimental методы.
- `opted_out_notification_methods: HashSet<String>` — список методов, на которые этот коннект **не** хочет получать notifications.
- `ConnectionRpcGate` — гейт, не пускает новые handler'ы после закрытия коннекта.

`ConnectionOrigin` (`transport/mod.rs:167`): `Stdio | InProcess | WebSocket | RemoteControl`.
`allows_device_key_requests()` пускает device-key API только для локальных коннектов.

### Транспортный слой

```rust
pub enum AppServerTransport {
    Stdio,
    UnixSocket { socket_path: AbsolutePathBuf },
    WebSocket { bind_address: SocketAddr },
    Off,
}
```

| Транспорт | Где запускается | Статус |
|---|---|---|
| in-process | TUI/exec поднимают app-server тредом у себя | production (основной путь) |
| stdio (`--listen stdio://`) | VS Code extension, IDE-интеграции | production |
| unix socket (`--listen unix://`) | локальный control-plane (`codex app-server proxy`) | production-ish |
| **websocket (`--listen ws://…` + TUI `--remote`)** | удалённый/SSH-форвард доступ | **experimental, не для прод** |

Из `app-server/README.md:37`:
> Websocket transport is currently experimental and unsupported. Do not rely on it for production workloads.

### Auth для ws

В `transport/auth.rs`:
- **capability-token** (`--ws-token-file` или `--ws-token-sha256`) — простой shared secret, проверка `constant_time_eq_32`.
- **signed-bearer-token** (`--ws-shared-secret-file` + опц. `--ws-issuer`/`--ws-audience`) — HMAC-JWT через `jsonwebtoken`, с проверкой clock skew.

Auth выполняется **до** JSON-RPC `initialize`, в HTTP Upgrade handshake, по заголовку
`Authorization: Bearer <token>`.

### Lifecycle одного коннекта

```
Client                                  app-server
  │  TCP/stdio connect                       │
  │ ─────────────────────────────────────▶  │  TransportEvent::ConnectionOpened
  │  initialize { clientInfo, capabilities } │
  │ ─────────────────────────────────────▶  │  InitializeRequestProcessor
  │  ◀───────────────────  initialize.result │
  │  initialized (notification)              │
  │ ─────────────────────────────────────▶  │  → коннект «открыт»
  │                                          │
  │  thread/start / thread/resume / …        │
  │ ─────────────────────────────────────▶  │  ThreadRequestProcessor → core::ThreadManager
  │  ◀──────────────  thread/started (notif) │
  │                                          │
  │  turn/start                              │
  │ ─────────────────────────────────────▶  │  TurnRequestProcessor → core начинает turn
  │  ◀──────────────  turn/started (notif)   │
  │  ◀──────────────  item/started (notif)   │  ─┐
  │  ◀──────  item/agentMessage/delta (notif)│   │ stream
  │  ◀──────────────  item/completed (notif) │  ─┘
  │                                          │
  │            ⟸  server-request:            │  если нужен approval / elicitation,
  │            applyPatch/approval (req)     │  app-server делает запрос **клиенту**
  │  applyPatch/approval.response  ────────▶│  (биdir JSON-RPC)
  │  ◀──────────────  turn/completed (notif) │
```

**Ключевое: bidirectional.** Сервер шлёт клиенту `ServerRequest` (`OutgoingMessage::Request`).
Используется для approvals (`applyPatch/approval`, `exec/approval`, `mcpServer/elicitation`).

### Backpressure и shutdown

- Все каналы bounded. Если ingress переполнен — `-32001 "Server overloaded; retry later."`.
- Notifications могут дропнуться под нагрузкой; server-requests гарантированно либо доставляются, либо фейлятся обратно.
- Shutdown: Ctrl-C / SIGTERM → graceful drain (acceptor продолжает, ждём running turns) → второй Ctrl-C → forced restart.

### Multi-tenancy: отсутствует

Один `codex app-server` = один пользователь. К одному запущенному `codex app-server` можно
подключить несколько UI одновременно (TUI + IDE + Python SDK), но они работают в **общем**
пользовательском контексте. В коде нет: разных identity per-connection, разделения файловой
системы / `CODEX_HOME`, разных ChatGPT/API-логинов одновременно.

---

## 3. Архитектура `core` и хранение сессий

`core` — это **state-машина агента**.

```
ThreadManager (на процесс)
└─ HashMap<ThreadId, Arc<CodexThread>>           ← живые треды в памяти
   │
   ├─ AuthManager, ModelsManager (shared)
   ├─ McpManager, PluginsManager, SkillsManager
   ├─ EnvironmentManager (exec-server)
   └─ ThreadStore (Arc<dyn ThreadStore>)         ← Local | Remote | InMemory
      └─ для Local: rollout-файлы + state_db
```

`CodexThread` — handle через который app-server пишет команды (`Op::UserInput`, `Op::Interrupt`,
`Op::Compact`) и читает события (`Event`/`EventMsg`). Внутри живёт:

```
Session
├─ TurnContext   ← текущая модель/cwd/sandbox/approvals
├─ Turn          ← один цикл «user message → model → tools → assistant message»
├─ Codex (loop)  ← async-задача, читает Op'ы, стримит из ModelClient
├─ AgentControl  ← spawn под-агентов, mailbox (см. agent/)
├─ ToolRouter    ← orchestrator + parallel + handlers + runtimes
├─ ContextManager ← собирает prompt: instructions + history + skills + …
├─ McpManager handle (для tool calls)
├─ LiveThread    ← персистент-handle
└─ RolloutRecorder (через LiveThread)
```

### Хранение сессии — три уровня

В Codex намеренно **тройная** персистентность.

#### Уровень 1: rollout JSONL — single source of truth

Файл `~/.codex/sessions/YYYY/MM/DD/rollout-2025-05-07T17-24-21-<thread-id>.jsonl`
(см. `rollout/src/recorder.rs:1369-1394`).

Это **append-only журнал**. Каждая строка — `RolloutLine { timestamp, item }`, где `item`
(см. `protocol/src/protocol.rs:2786`):

```rust
pub enum RolloutItem {
    SessionMeta(SessionMetaLine),   // первая строка: id, cwd, base_instructions, source, git
    ResponseItem(ResponseItem),     // user/assistant message, reasoning, function call, …
    Compacted(CompactedItem),       // маркер компакции истории
    TurnContext(TurnContextItem),   // снапшот настроек на момент turn'а
    EventMsg(EventMsg),             // прочие события (exec begin/end, approvals, …)
}
```

Свойства:
- **JSONL, append-only.** Никаких update'ов. Реплеишь — получаешь актуальное состояние.
- **Сессия пишется через bounded mpsc-канал** (`recorder.rs:740`, capacity 256) в
  **отдельный tokio task** (`rollout_writer`). Turn'у не надо ждать диск.
- Команды writer'у: `AddItems`, `Persist`, `Flush`, `Shutdown` (`recorder.rs:101-113`).
- **Что фильтруется** — `policy.rs::is_persisted_rollout_item`. В `EventPersistenceMode::Limited`
  большая часть `EventMsg` не пишется; в `Extended` — пишется, но с обрезкой stdout/stderr
  (`PERSISTED_EXEC_AGGREGATED_OUTPUT_MAX_BYTES = 10_000`).
- **Recovery в writer'е.** В `RolloutWriterState` есть `pending_items: Vec<RolloutItem>`. Если
  запись фейлится — handle файла дропается, items остаются в памяти; на следующем `Persist` —
  retry (`write_pending_with_recovery`, две попытки).
- **НЕТ `fsync`.** В `JsonlWriter::write_line` — только `write_all` + `file.flush().await`
  (это tokio flush, не fsync). После `kill -9` или паники последние записи могут пропасть.

#### Уровень 2: SQLite state DB — индекс и метаданные

Файлы `~/.codex/state_<VERSION>.sqlite` + `~/.codex/logs_<VERSION>.sqlite`
(`state/src/runtime.rs:210-228`).

Настройки (`runtime.rs:164-172`):
```rust
SqliteConnectOptions::new()
    .journal_mode(SqliteJournalMode::Wal)        // WAL → переживает kill -9
    .synchronous(SqliteSynchronous::Normal)      // не fsync на каждый коммит, но WAL цел
    .busy_timeout(Duration::from_secs(5))
```

Что лежит:
- `threads.rs` — индекс тредов: id, путь к rollout, cwd, source, model_provider, timestamps, archived flag, имя.
- `goals.rs` — thread goals.
- `agent_jobs.rs` — фоновые задачи агента.
- `memories.rs` — длинная память.
- `device_key.rs` — device keys для auth.
- `remote_control.rs` — состояние удалённого управления.
- `backfill.rs` — состояние backfill: «вычитал ли я все rollout-файлы и обновил индекс».

**State DB — это derived state.** По JSONL-файлам всегда можно перестроить таблицы (это и
делает backfill). DB нужна чтобы быстро отвечать на «дай мне последние 50 тредов из этого cwd».

#### Уровень 3: `ThreadStore` — абстракция

`LiveThread::append_items()` (`thread-store/src/live_thread.rs:107`) дёргает
`Arc<dyn ThreadStore>` (`thread-store/src/store.rs:21`):

```rust
match config.experimental_thread_store {
    Local      => LocalThreadStore { rollout_recorder + state_db },  // основной путь
    Remote     => RemoteThreadStore { http endpoint },                // для облака (gRPC)
    InMemory   => InMemoryThreadStore,                                // ephemeral / тесты
}
```

`LiveThreadInitGuard` (`live_thread.rs:38`) — RAII-обёртка: если init сессии упал на
полпути, `Drop` спавнит `discard()` чтобы убить наполовину созданный rollout.

---

## 4. Что будет, если процесс упадёт

### 1. Корректный shutdown (Ctrl-C, SIGTERM)

`app-server` ловит сигнал, входит в graceful drain. `LiveThread::shutdown()` для каждого
активного треда → `RolloutCmd::Shutdown` → writer дописывает `pending_items`, закрывает файл.

Running turn abort'ится с `TurnAbortReason::Shutdown`. В rollout уйдёт `EventMsg` об abort'е.

**После:** rollout-файл консистентен, state DB обновлена. Resume даст полную историю.

### 2. Внезапная смерть процесса (kill -9, паника)

| Что | Состояние |
|---|---|
| **Rollout JSONL** | целиком до последнего успешного `flush().await` (user-space flush, не fsync). На практике десятки миллисекунд назад. Файл append-only — даже если последняя строка обрезалась, парсер `read_thread_item_from_rollout` пропустит её. |
| **Pending items в памяти writer'а** | **потеряны** (они в `Vec`, не на диске). |
| **State DB** | целиком до последнего commit'а (WAL гарантирует). |
| **Running turn** | состояние модели — потеряно. То, что попало в rollout — выживет; то, что было in-flight — нет. |
| **Side effects** | если sandbox-команда успела изменить файлы — изменения на диске, но Codex про них не помнит. |

**На следующем старте.** `codex resume <thread-id>` →
`Session::reconstruct_history_from_rollout` (`core/src/session/rollout_reconstruction.rs`)
читает JSONL, проигрывает items, применяет компакции и `ThreadRolledBack` маркеры,
восстанавливает `TurnContext`. Получается актуальная история до последней успешно
записанной строки.

Если был unfinished turn — `event_mapping::parse_turn_item` это видит и помечает последний
user-turn как незавершённый. В `tasks/mod.rs:66` есть `InterruptedTurnHistoryMarker`,
который при resume вставляет «прошлый turn был прерван» fragment в developer/contextual user prompt.

### 3. Падение узла (kernel panic, питание)

То же, что #2, **минус то, что не успело долететь до диска**. Никакого RPO=0 Codex не
обещает. Это локальное приложение, не транзакционная БД.

### 4. Кросс-процессные сценарии

- **Несколько `codex` на одной машине.** Каждый держит свои JSONL, но **одну общую state DB**.
  WAL + busy_timeout=5s справляются. Backfill идёт под лизом.
- **Disconnect клиента (TUI/IDE), а app-server жив.** Тред продолжает крутиться. JSONL пишется.
  Клиент переподключается → `thread/resume` → подхватывает по `ThreadId`.
- **Падение `app-server`, клиент жив.** Клиент видит закрытие WS, делает reconnect. На момент
  падения running turn потерян, но история до последней записанной строки + маркер
  «turn interrupted» доступны.

### Граничные случаи

- **Ephemeral треды** (`codex exec --ephemeral`): ничего не пишется. Падение — тред теряется целиком.
- **Forks.** Форк создаёт **новый** rollout-файл, копируя items до точки форка через `replacement_history`.
- **Compaction race.** На диске может оказаться `Compacted` маркер без последующих items.
  Reconstruction проиграет — это безопасно, маркер атомарен (одна JSONL-строка).
- **Truncation.** При откате N user turns в журнал пишется маркер `ThreadRolledBack`, ничего не удаляется.
- **Sub-agents.** `SessionMeta.agent_path/agent_role/agent_nickname` — у дочерних агентов
  свой rollout-файл, но они в общей `ThreadManager`.

### Короткое резюме

- Стейт сессии = **JSONL-журнал событий** + индекс в **WAL-SQLite**, всё в `~/.codex/`.
- Журнал пишется через bounded-канал в фоновом tokio task с retry, **без fsync**.
- `ThreadStore` — абстракция: локально rollout-файлы, в облаке RPC, в тестах in-memory.
- Crash-recovery = «replay JSONL» в `Session::reconstruct_history_from_rollout`.
- Гарантии: «всё, что успели зафлашить» переживает kill -9; «что в полёте» — теряется.
  Незавершённый turn после crash превращается в маркер «interrupted».

---

## 5. Точки расширения для managed cloud

В коде видно: значительная часть архитектуры **проектировалась с расчётом на cloud-backed
deployment**. Готовых extension-points с уже определёнными gRPC-протоколами и черновыми
реализациями несколько.

### Слой 1. Storage — `ThreadStore` (готовый, gRPC)

`thread-store/src/store.rs:21`:

```rust
#[async_trait]
pub trait ThreadStore: Any + Send + Sync {
    async fn create_thread(&self, params: CreateThreadParams) -> ThreadStoreResult<()>;
    async fn append_items(&self, params: AppendThreadItemsParams) -> ThreadStoreResult<()>;
    async fn load_history(&self, ...) -> ThreadStoreResult<StoredThreadHistory>;
    async fn read_thread(&self, params: ReadThreadParams) -> ThreadStoreResult<StoredThread>;
    async fn list_threads(&self, params: ListThreadsParams) -> ThreadStoreResult<ThreadPage>;
    async fn archive_thread(&self, params: ArchiveThreadParams) -> ThreadStoreResult<()>;
    async fn persist_thread / flush_thread / shutdown_thread / discard_thread / ...
}
```

Реализации: `LocalThreadStore`, `InMemoryThreadStore`, **`RemoteThreadStore`**.
В `thread-store/src/remote/` лежит готовый gRPC-протокол (`proto/codex.thread_store.v1.rs`).

Конфиг:
```toml
[experimental_thread_store]
type = "remote"
endpoint = "http://thread-store.internal:50051"
```

В `thread-store/src/remote/mod.rs:33` комментарий честный:
> *«This store is still a work in progress: app-server code should call the generic
> `ThreadStore` methods, and unsupported remote operations will return explicit
> `not_implemented` errors until the remote API catches up.»*

### Слой 2. Per-thread config — `ThreadConfigLoader` (готовый, gRPC)

`config/src/thread_config.rs:90`:

```rust
#[async_trait]
pub trait ThreadConfigLoader: Send + Sync {
    async fn load(&self, ctx: ThreadConfigContext) -> Result<Vec<ThreadConfigSource>, _>;
}
```

Реализации: `NoopThreadConfigLoader`, `StaticThreadConfigLoader`, **`RemoteThreadConfigLoader`**
(gRPC, `proto/codex.thread_config.v1.rs`, 5-секундный таймаут).

В managed-сценарии у пользователя/тенанта свои разрешённые модели, фичи, providers — это
**не файл `config.toml` локально**, это конфиг, который сервер выдаёт по `thread_id`/`user_id`.

`ConfigLayerStack` накладывает её слоями: `defaults < user.toml < project.toml <
session-config-from-loader < cli overrides`.

### Слой 3. Cloud-side requirements — `CloudRequirementsLoader`

`config/src/cloud_requirements.rs:49`. Async-loader, который тянет **enforced** требования
(residency, mandatory exec-policy, разрешённые provider'ы). Вызывается до старта thread'а
в `app-server/src/lib.rs:462`.

Это про политики, которые клиент **не может перезагрузить через config.toml**.

### Слой 4. Auth — `ExternalAuth` + `AuthStorageBackend`

**`ExternalAuth`** (`login/src/auth/manager.rs:163`):
```rust
pub trait ExternalAuth: Send + Sync {
    fn auth_mode(&self) -> AuthMode;
    async fn resolve(&self) -> io::Result<Option<ExternalAuthTokens>>;
    async fn refresh(&self, ctx: ExternalAuthRefreshContext) -> io::Result<ExternalAuthTokens>;
}
```

Встроенные модальности: `AuthMode::ApiKey | Chatgpt | ChatgptAuthTokens | AgentIdentity`.
Последний (JWT-based) — специально под service-to-service.

**`AuthStorageBackend`** (`login/src/auth/storage.rs:97`) — куда складывать кредли
(`FileAuthStorage`, `KeyringAuthStorage`, `AutoAuthStorage`).

В `app-server/src/lib.rs:460` `AuthManager::shared_from_config` создаёт по одной инстанции
на процесс. **Архитектурная граница «один процесс = один пользователь».**

### Слой 5. Model providers — `ModelProvider` + `ModelsEndpointClient` + `ModelsManager`

`model-provider/src/provider.rs:79`:
```rust
pub trait ModelProvider: Debug + Send + Sync {
    fn info(&self) -> &ModelProviderInfo;
    fn capabilities(&self) -> ProviderCapabilities;
    fn auth_manager(&self) -> Option<Arc<AuthManager>>;
    async fn auth(&self) -> Option<CodexAuth>;
    async fn api_provider(&self) -> Result<Provider>;
    async fn runtime_base_url(&self) -> Result<Option<String>>;
    async fn api_auth(&self) -> Result<SharedAuthProvider>;
    fn models_manager(&self, ...) -> SharedModelsManager;
}
```

Уже две реализации: `ConfiguredModelProvider` (OpenAI-compatible) и `AmazonBedrockModelProvider`.

`models-manager/src/manager.rs:31` — `ModelsEndpointClient` (как получаете каталог моделей)
+ `ModelsManager` (стратегии refresh, кеш на диске).

### Слой 6. Egress / proxy — `responses-api-proxy`

Отдельный крейт `responses-api-proxy/`, запускается командой `codex responses-api-proxy`.
Зачем в облаке:
- Централизованный egress (audit, rate limits, billing).
- Замена endpoint'а (`chatgpt_base_url` в config).
- Inject заголовков `x-openai-internal-codex-residency` (`login/src/auth/default_client.rs:38`).

Через `set_default_client_residency_requirement(...)` и `set_default_originator(...)` можно
из кода прописать обязательный originator (для Compliance Logs Platform) и residency-header.

### Слой 7. Transport / API gateway

- `AppServerTransport::WebSocket { bind_address }` + `AppServerWebsocketAuthSettings`.
- `AppServerTransport::UnixSocket` + `codex app-server proxy` — control-plane через UDS.
- **`AppServerTransport::Off`** — не открывать transport вообще. Режим для эмбеда:
  поднимаете app-server `in_process`, ставите `Off`, ходите сами через `InProcessClientHandle`.

**Чего нет:** расширения `AppServerTransport` — это closed `enum`. Кастомный транспорт без
форка не сделаешь, придётся либо положить gateway сверху, либо использовать `Off` + свой
client поверх `in_process.rs`.

### Слой 8. State runtime — `StateRuntime` (sqlite)

`state/src/runtime.rs` хардкодит SQLite в `~/.codex/`. Это **не** trait'ом. То есть state DB
вы **не можете** легко подменить на Postgres/Spanner.

В managed-сценарии при `experimental_thread_store = "remote"` локальный state DB нужен только
для tooling-фич внутри одного процесса — можно открывать на tmpfs.

### Слой 9. MCP / Plugins / Skills

- **MCP servers** (`codex-mcp/`, `rmcp-client/`) — уже extension-механизм.
- **Plugins** (`plugin/`, `core-plugins/`, `marketplace_cmd.rs`) — есть marketplace для
  tool-плагинов с install/uninstall/version pin.
- **Skills** (`skills/`, `core-skills/`) — markdown + frontmatter в `~/.codex/skills/`,
  есть file watcher (`skills_watcher.rs`).

### Слой 10. Telemetry / Analytics / OTel

- `codex_otel` — стандартный OpenTelemetry, любой OTLP-приёмник.
- `AnalyticsEventsClient` + `AppServerRpcTransport` — sink для аналитики, на cloud-стороне
  можно делать свой.

### Слой 11. Sandboxing / exec-server / hooks

- `EnvironmentManager` (`exec-server/`) — пул сред исполнения. Можно поднимать
  `codex exec-server --listen ws://...` отдельно и пулить на отдельных нодах.
- `hooks/` — lifecycle-хуки (pre/post-turn, pre/post-exec).
- `execpolicy` — кастомные правила exec'а.

### Чего **не** будет «бесплатно»

1. **Один процесс = один пользователь.** Все singleton'ы (`AuthManager`, `Config`,
   `EnvironmentManager`, `state DB`, `~/.codex`) per-process.
2. **Изоляция между коннектами в одном app-server отсутствует.**
3. **Нет встроенного scheduler'а / placement.** `cloud-tasks/`, `cloud-tasks-client/`,
   `backend-client/` — это **клиентская** часть для общения с Codex Cloud, не сам оркестратор.
4. **Routing моделей за `ModelProvider`** — на провайдер. «Маршрутизации» в одном треде нет.
5. **WS-transport ещё experimental.** Для production gateway правильнее ставить ваш HTTP/WS-фронт
   перед `--listen off` + in-process embedding или перед `--listen unix://`.

### Сводная карта «куда вставлять своё»

```
                  ┌───────────────── ваш cloud control plane ─────────────────┐
                  │                                                            │
   client ──→ ваш gateway ──→  process pool (1 codex-app-server per user)  ──→ │
                  │              │                                             │
                  │              ├─ ThreadStore::Remote ─────────────────────→ │  ваш storage gRPC
                  │              ├─ ThreadConfigLoader::Remote ──────────────→ │  ваш config gRPC
                  │              ├─ CloudRequirementsLoader ─────────────────→ │  ваш policy gRPC
                  │              ├─ ExternalAuth + AuthStorageBackend ───────→ │  ваш IdP / vault
                  │              ├─ ModelProvider impl ────────────────────────→ │  ваш inference
                  │              ├─ responses-api-proxy ───────────────────────→ │  egress / audit
                  │              ├─ OTel exporter / AnalyticsEventsClient ─────→ │  observability
                  │              ├─ Hooks / execpolicy ────────────────────────→ │  compliance
                  │              ├─ Plugin marketplace endpoint ───────────────→ │  ваш registry
                  │              └─ exec-server pool (codex exec-server) ───────→ │  sandboxed exec
                  │                                                                │
                  └────────────────────────────────────────────────────────────────┘
```

**Самые надёжные точки расширения** (trait + Remote-impl + реально вызывается app-server'ом):
1. `ThreadStore` (storage),
2. `ThreadConfigLoader` (per-thread config),
3. `ModelProvider` / `ModelsEndpointClient` (модели),
4. `ExternalAuth` (auth),
5. `responses-api-proxy` (egress).

Всё остальное либо уже extension-friendly (MCP, plugins, hooks, OTel), либо требует обёртки
сверху (multitenancy, scheduler, routing).

---

## 6. Сравнение с Anthropic Managed Agents

Источник: [https://www.anthropic.com/engineering/managed-agents](https://www.anthropic.com/engineering/managed-agents)

### Сначала примитивы рядом

Оба пришли к одной и той же базовой триаде:

| Anthropic Managed Agents | OpenAI Codex |
|---|---|
| **Session** — append-only event log, durable state outside context window | **Thread / RolloutItem JSONL** + `state.sqlite` индекс |
| **Harness** — цикл, который зовёт LLM и роутит tool calls | **`Session` / `Codex` loop + `ToolRouter`** в `core` |
| **Sandbox** — execution environment, провизионится по требованию | **landlock/seatbelt/windows-sandbox** + `exec-server` пул |
| MCP tools через **dedicated proxy** | MCP через `rmcp-client` + `mcp-server`, в одном процессе |
| `wake(sessionId)`, `getEvents()`, `execute()`, `provision()`, `emitEvent()` | `thread/resume`, `turn/start`, `RolloutRecorder`, реплей JSONL |

**Концептуально это один и тот же агент-platform pattern.** Дальше — принципиальные отличия.

### Различие №1 — направление эволюции

**Anthropic шли cloud-first.** Сначала собрали Claude Code как research harness, поняли что
внутри, и потом **обобщили опыт в платформу**, открыли публичный SDK (`getSession`, `wake`,
`provision`). Managed Agents — **отдельный продуктовый layer** над Claude Code.

**OpenAI идут product-first и снизу вверх.** Codex родился как локальный CLI. Cloud-аспекты в
коде помечены как retrofit:
- `experimental_thread_store = "remote"` (не дефолт),
- `experimental_thread_config_endpoint` (опционально),
- В `thread-store/src/remote/mod.rs:33` — *«work in progress, unsupported remote operations
  will return explicit not_implemented errors until the remote API catches up.»*
- Websocket-транспорт app-server'а — *experimental / unsupported*,
- Multitenancy в одном процессе нет — by-design «один процесс на пользователя».

`RemoteThreadStore` — это **seam, оставленный на будущее**. У Anthropic эквивалент — Session
API — это **главный API платформы**. Один и тот же примитив, диаметрально противоположный
статус.

### Различие №2 — brain/hand decoupling

**Anthropic явно разделили brain (Claude+harness) и hand (sandbox).**
- Harness стал stateless: *«if the container died, the harness caught the failure as a
  tool-call error and passed it back to Claude»*.
- Sandbox — отдельный ресурс, провизионится по требованию через `provision({resources})`.
- Многие brain'ы могут смотреть в одну session, brain'ы могут передавать hands друг другу.
- Numerical claim: **p50 TTFT ↓ 60%, p95 ↓ 90%** — именно из-за on-demand provisioning.

**OpenAI идёт туда же, но архитектура держит brain и hand вместе.**
- `core::Session` живёт в том же процессе, что и `ToolRouter`/sandbox.
- `exec-server/` крейт + `EnvironmentManager` — это шаг в сторону отделения hands.
  Можно запустить `codex exec-server --listen ws://...` отдельно.
- Но **harness — НЕ stateless**. Если падает app-server — running turn теряется.
  Это **reload-from-disk**, не **hot-failover**.

Anthropic сделали failover **по дизайну**, OpenAI сделали recovery **как побочный эффект
persistent журнала**.

### Различие №3 — credential isolation

**Anthropic:** *«The harness is never made aware of any credentials.»* OAuth tokens в secure
vault. Git access token закидывается в sandbox при инициализации, но harness его не видит.
MCP-вызовы — через dedicated proxy.

**OpenAI:** `AuthManager` живёт **в том же процессе, что и `core`/`ToolRouter`**. Один
`Arc<AuthManager>` на app-server. `responses-api-proxy` есть, но он опциональный и больше про
egress audit, чем про изоляцию.

### Различие №4 — кто пишет код агента

**Anthropic:** developer пишет агента, Anthropic хостит. SDK маленький: `getSession`/`wake`/
`emitEvent`/`execute`/`provision`. Это **PaaS-модель** — Heroku/Vercel-подобная для агентов.

**OpenAI:** OpenAI пишет агента (Codex), пользователь его использует. Расширения через
MCP-серверы и плагины, но **архитектура остаётся Codex-first**. Это **product-модель**, как
GitHub Copilot.

### Кто идёт быстрее и правильнее

«Быстрее» зависит от метрики:
- **К managed-cloud platform** Anthropic пришли быстрее. У них уже есть SDK, документация,
  сформулированы примитивы.
- **К зрелому coding-агенту** OpenAI пришли быстрее. Codex CLI/IDE/Web — продукт с миллионами
  пользователей, обернуть в managed — вопрос месяцев.

«Правильнее» — обе стратегии валидны для своих ставок:

| Anthropic | OpenAI |
|---|---|
| Платформа > продукт | Продукт > платформа |
| Brain/hand decoupling = primary | Persistent log + replay = primary |
| Latency и TTFT в посте — first-class metric | В коде есть `session_startup_prewarm`, но как design driver не выписан |
| Generic agents-as-a-service | Coding agent специфично глубоко (sandbox tech, apply-patch, execpolicy) |
| Credential isolation by design | Credential containment через process boundary |

**Anthropic сильнее в:**
- Чистоте abstraction (Session/Harness/Sandbox — три слова и всё ясно).
- Готовности к multi-tenant хостингу.
- Decoupling reasoning ↔ execution → latency-преимущество в облаке.

**OpenAI сильнее в:**
- **Sandbox tech.** `linux-sandbox/` (landlock+seccomp), `windows-sandbox-rs/`, `sandboxing/`
  (seatbelt), `execpolicy/`, `network-proxy/`, `process-hardening/`. У Anthropic в посте
  sandbox описан абстрактно.
- **Coding-specific tooling.** `apply-patch/`, `git-utils/`, `file-search/`, `unified_exec/`,
  `turn_diff_tracker/` — этого Anthropic не показывает.
- **Распределение по surfaces** — TUI, exec, IDE, web, MCP server.

---

## 7. Главные выводы, тренды и инсайды

### 1. Session-as-event-log стал каноничной абстракцией

Оба пришли независимо: Anthropic называет Session, OpenAI — rollout JSONL. Если ты сегодня
строишь агента, писать «историю» иначе, чем append-only events с replay — почти наверняка
ошибка дизайна.

### 2. Brain/hand разделение — следующий шаг для всех

Anthropic делает явно. OpenAI идёт туда через `exec-server` + `EnvironmentManager`. Через
1–2 года этого стоит ожидать у Cursor/Cline/etc. Это **не оптимизация, это требование
multi-tenant сценариев**.

### 3. MCP — реальный индустриальный стандарт

Anthropic его создал, OpenAI глубоко интегрировал (`codex-mcp/`, `rmcp-client/`,
`mcp-server/`, и Codex может **быть и MCP-сервером, и MCP-клиентом**). Если ты пишешь
интеграцию сегодня — пиши под MCP, не под proprietary tool API.

### 4. Latency — новый «дифференциатор»

Anthropic явно мерит TTFT (60% / 90% улучшения). OpenAI — пока нет (по крайней мере, не в
публичных сигналах), хотя в коде есть prewarm. По мере того как агентов становится много и
они работают параллельно, **latency перестаёт быть «технической оптимизацией» и становится
продуктовой ставкой**.

### 5. Credential isolation станет регуляторным минимумом

Anthropic вынесли в дизайн. Codex пока через sandbox + egress proxy. Когда regulations про
AI-агентов догонят (а они догонят), модель Anthropic окажется compliance-ready, у OpenAI
потребуется рефакторинг.

### 6. Расхождение бизнес-моделей

- **Anthropic:** «вы пишете агента, мы хостим» → много вертикальных решений на их инфре.
- **OpenAI:** «мы делаем coding-агента, ты подписываешься» → одна большая product line.

Это две **разные ставки на форму рынка**: marketplace vs vertical product. Похоже, что
**обе ниши большие**.

### 7. Самое любопытное

В обоих случаях самым сложным архитектурным элементом оказалась **НЕ модель**.
- У Anthropic — orchestration (multi-brain/hand, scheduling, isolation).
- У OpenAI — sandbox и tooling depth.

Модель — commodity-слой, который можно дёргать через API. Реальная сложность — в том, что
вокруг неё.

### 8. `RemoteThreadStore` как метафора

Файл `codex-rs/thread-store/src/remote/mod.rs:33` в одной структуре отражает всю разницу
стратегий. У Anthropic эквивалент — `Session` — **главный API**. У OpenAI — **WIP gRPC-скелет
с `not_implemented` методами**. Один и тот же примитив, на одном краю спектра «нашли его и
сделали продуктом», на другом «нашли его и оставили дверь на будущее, занимаясь продуктом».

Если выбираешь, на чьей платформе строиться — **этот один файл многое говорит**.

### 9. Inversion of sandbox

Раньше: harness управляет своим sandbox'ом локально. Теперь: sandbox — стейтлесс ресурс,
harness им провизионит. Это серьёзное архитектурное обращение (см. в Codex код:
`EnvironmentManager`, `exec-server` pool — туда же идут).

### 10. Resume-from-failure

- Anthropic: «harness die, `wake(sessionId)`, replay». **Primary path.**
- OpenAI: «процесс падает, перезапуск, replay из rollout». **Recovery path.**

Концептуально одно, но Anthropic делает это primary path; OpenAI — побочное последствие
durable журнала.

---

## Итоговый взгляд

**Anthropic ставит на платформу для других, OpenAI — на собственный продукт.**

- Anthropic архитектурно правильнее для multi-tenant managed scenario.
- OpenAI глубже как coding agent.

В долгую обе ставки могут выиграть — на разных рынках.

**Если бы я делал «своего coding-агента в облаке»** — взял бы codex-rs как движок и обернул
бы его сам (там реально много готового: trait points, sandbox tech, tooling). Понадобится
поверх него поставить multi-tenant gateway и заполнить `RemoteThreadStore` /
`RemoteThreadConfigLoader` имплементациями.

**Если бы делал «вертикального агента под другую задачу»** — пошёл бы в Managed Agents у
Anthropic, там cleaner abstractions и готовая платформа.
