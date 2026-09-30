# AgentTrace — AI Coding Agent Profiler

> Claude Code / Codex 세션 로그를 분석해 **어디서 시간이 새는지**, **어떤 명령·도구·스킬이 느린지**, **무엇을 바꾸면 더 빨라질지** 보여주는 로컬 퍼스트 프로파일러.

---

## 1. Problem

AI 코딩 에이전트를 오래 쓰다 보면 다음 질문에 답하기 어렵다.

- 왜 이 작업은 40분이나 걸렸나?
- `xcodebuild`, `npm test`, `pytest`, `rg`, MCP 호출 중 뭐가 시간을 가장 많이 먹나?
- 같은 실패를 몇 번 반복했나?
- 어떤 Skill / AGENTS.md / CLAUDE.md 지침이 실제로 효과가 있나?
- 브라우저/MCP/검색/빌드 중 병목은 어디인가?
- 지난주보다 이번 주가 빨라졌나?
- 특정 설정을 추가한 뒤 세션 시간이 실제로 줄었나?
- 토큰은 줄었는데 wall-clock time은 늘어난 이유가 뭔가?

기존 도구가 주로 **토큰/비용/세션 목록**을 보여준다면, AgentTrace는 **성능 프로파일링 + 원인 분석 + 개선 제안**에 집중한다.

---

# 2. Core Concept

```text
Claude Code / Codex session files
            │
            ▼
       Parser Layer
            │
            ▼
   Normalized Event Model
            │
      ┌─────┴─────┐
      ▼           ▼
 Aggregator    Analyzer
      │           │
      └─────┬─────┘
            ▼
      SQLite / DuckDB
            │
       ┌────┴────┐
       ▼         ▼
      CLI     HTML Report
```

핵심은 서로 다른 에이전트의 로그를 아래 공통 이벤트 모델로 정규화하는 것.

```text
Session
 ├─ Turn
 │   ├─ ToolCall
 │   │   ├─ ShellCommand
 │   │   ├─ FileRead
 │   │   ├─ FileEdit
 │   │   ├─ MCP
 │   │   ├─ Browser
 │   │   └─ Skill
 │   └─ ModelResponse
 └─ Metadata
```

---

# 3. Supported Sources

## Claude Code

예상 입력:

```text
~/.claude/projects/**/**/*.jsonl
```

추출 후보:

- session id
- timestamp
- user / assistant turn
- tool_use / tool_result
- Bash command
- file read/write/edit
- skill 관련 파일 접근
- MCP 호출
- token usage
- errors
- exit codes
- sub-agent / task 호출
- working directory / project

---

## Codex

예상 입력:

```text
~/.codex/sessions/**/rollout-*.jsonl
```

추출 후보:

- session id
- timestamp
- command execution
- tool call / tool result
- token usage
- model
- reasoning / response event
- custom tools
- MCP
- skill usage
- cwd / repository
- errors

---

# 4. Normalized Data Model

```ts
type Session = {
  id: string
  agent: "claude-code" | "codex"
  project?: string
  startedAt: Date
  endedAt: Date
  durationMs: number

  model?: string

  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number

  turns: Turn[]
}
```

```ts
type Event = {
  id: string
  sessionId: string

  timestamp: Date
  endTimestamp?: Date
  durationMs?: number

  type:
    | "model"
    | "shell"
    | "file_read"
    | "file_write"
    | "file_edit"
    | "search"
    | "mcp"
    | "browser"
    | "skill"
    | "subagent"
    | "other"

  name?: string
  rawName?: string

  success?: boolean
  exitCode?: number
  errorFingerprint?: string

  metadata: Record<string, unknown>
}
```

---

# 5. Command Normalization

명령어 전체 문자열을 그대로 집계하면 같은 명령이 수백 종류로 쪼개진다.

예:

```bash
rg "UserService" Sources/
rg "PaymentService" Sources/
rg "Foo" Tests/
```

다음처럼 단계적으로 normalize.

```text
raw:
rg "UserService" Sources/

command:
rg

pattern:
rg <query> <path>

category:
search
```

예:

```text
npm test foo.test.ts
npm test bar.test.ts
```

↓

```text
npm test <target>
```

또는

```text
xcodebuild \
  -scheme Foo \
  -destination ...
```

↓

```text
xcodebuild <scheme>
```

### Built-in classifier

```text
search
  rg
  grep
  find
  fd

build
  xcodebuild
  swift build
  npm run build
  cargo build
  gradle

test
  npm test
  pytest
  cargo test
  swift test
  xcodebuild test

git
  git status
  git diff
  git log
  git commit

package
  npm
  pnpm
  yarn
  pip
  cargo

system
  ls
  pwd
  cat
  sed
```

사용자가 custom rule 추가 가능:

```yaml
commands:
  - match: "./scripts/ios-test"
    category: test
    name: ios-test
```

---

# 6. Metrics

## Session

```text
total duration
active duration
agent wait duration
tool duration
model duration

tool calls
command count
failed commands
retry count
repeated reads

input/output tokens
tokens per minute
tokens per task
```

---

## Command

```text
calls
total duration
mean
median
p90
p95
max

success rate
failure rate
retry rate
```

---

## Tool / MCP

```text
calls
total duration
median latency
p95 latency
success rate

% of total session time
```

예:

```text
Tool                     Calls   Total      p50      p95
--------------------------------------------------------
Shell                    2,193   8h21m     2.1s     48s
File Read                1,832   42m       0.3s      2s
GitHub MCP                 241   47m       5.3s     32s
Browser                    103   51m      13.1s     91s
```

---

# 7. Skill Analytics

Skill 효과를 추적한다.

탐지 방식:

```text
explicit skill invocation

SKILL.md read

known skill directory access

session metadata

tool / prompt marker
```

Skill 사용 전후 비교:

```text
Task cluster: iOS build failure

                     Skill Used    No Skill
------------------------------------------------
sessions                  31          24
median duration           8.2m        14.7m
tool calls                22          39
failed commands           2.1         5.8
tokens                    41k         67k
```

주의:

> correlation ≠ causation

그래서 UI에서는

```text
"Skill 사용 세션에서 median duration 44% lower"
```

까지만 말하고,

```text
"이 Skill 때문에 44% 빨라졌다"
```

라고 단정하지 않는다.

---

# 8. Waste Detection

AgentTrace의 핵심 차별점.

## Retry Loop

```text
command
↓ fail

edit
↓
same command
↓ same fail

edit
↓
same command
```

탐지:

```text
same command pattern
same error fingerprint
short time window
```

출력:

```text
Repeated failure loop

npm test <target>

attempts: 7
time spent: 11m 42s

same error:
Missing DATABASE_URL
```

---

## Repeated File Reads

```text
read A
read B
read A
read C
read A
```

출력:

```text
Repeated context lookup

src/auth/session.ts

read 11 times
total context lookup: 4m 21s
```

가능한 suggestion:

```text
Repository architecture may not be obvious.

Consider adding this module to:
AGENTS.md
CLAUDE.md
custom skill
```

---

## Search Thrashing

```text
rg
rg
find
rg
grep
rg
```

동일 주제를 반복 검색하는 패턴.

metric:

```text
search calls / successful edit
```

---

## Build Thrashing

```text
full build
edit 1 file
full build
edit
full build
```

탐지 후:

```text
18 full builds occurred within 30 minutes.

Potential improvement:
targeted tests / incremental build commands
```

---

## Tool Ping-Pong

```text
Read
Search
Read
Search
Read
Search
```

실제 코드 변경 없이 inspection만 반복되는 구간.

---

## Long Dead Zones

이벤트 간 긴 gap:

```text
tool_result 10:31

next event 10:39
```

구분:

```text
agent/model thinking
tool waiting
external process
user waiting
unknown
```

가능한 한 정확히 분리하고, 불가능하면 `unknown wall time`으로 남긴다.

---

# 9. Insight Engine

처음부터 LLM을 쓰지 않아도 대부분 rule 기반으로 가능.

```ts
interface InsightRule {
  id: string
  detect(ctx): Insight[]
}
```

예:

```text
slow-command
retry-loop
repeated-error
repeated-file-read
search-thrashing
build-thrashing
high-mcp-latency
skill-correlation
regression
token-spike
long-session
```

출력:

```text
INSIGHT

xcodebuild consumed 14.2% of all agent time this week.

27 calls
19 appear to be full rebuilds.

Possible improvement:

Create targeted build/test commands and document them in AGENTS.md.

Potentially avoidable time:
~53m/week
```

---

# 10. Insight Severity

```text
INFO
NOTICE
WARNING
HOTSPOT
```

예:

```text
HOTSPOT

npm test
2h 18m / week
143 calls
43 failures
```

---

# 11. Task Clustering

같은 종류 작업끼리 비교해야 의미가 있다.

MVP:

```text
repo
session title / first prompt
commands used
files touched
```

기준 heuristic clustering.

나중에는 embeddings / local model로:

```text
iOS build debugging
frontend UI implementation
API endpoint implementation
test repair
dependency upgrade
code review
```

같은 task class 생성.

그러면:

```text
Median duration by task

iOS debugging            18m
Frontend feature         13m
Backend feature           9m
Dependency upgrade       31m
```

가능.

---

# 12. Historical Storage

## SQLite first

```text
~/.agenttrace/agenttrace.db
```

장점:

- 설치 간단
- single binary 가능
- incremental scan 가능
- trend query 쉬움
- HTML 생성 쉬움

예상 tables:

```sql
sessions
events
commands
skills
session_skills
insights
daily_stats
projects
```

---

## Incremental Scan

매번 전체 로그 재분석하지 않는다.

```text
source_file
file_size
mtime
last_offset
hash
```

저장.

```bash
agenttrace scan
```

실행 시 새 데이터만 읽기.

---

# 13. Trend Analytics

DB를 두는 가장 큰 이유.

```text
Week 1     17.3 min/session
Week 2     14.8 min/session
Week 3     11.2 min/session
```

HTML:

```text
Median Session Time

20m ┤●
18m ┤
16m ┤   ●
14m ┤
12m ┤       ●
10m ┤
   └────────────────
      W1  W2  W3
```

추적할 것:

```text
session duration
task duration
tool calls/session
failed commands/session
retry loops/session
tokens/session
build time/session
search calls/session
skill adoption
MCP latency
```

---

# 14. Before / After Comparison

특정 날짜를 기준으로 비교.

```bash
agenttrace compare \
  --before 2026-09-20 \
  --after 2026-09-20
```

예:

```text
After adding ios-debug skill

                    Before      After
--------------------------------------
median session       21.4m      14.2m
xcodebuild calls       8.3        4.1
failed builds          3.2        1.4
tokens                 71k        48k
```

또는 git commit/tag 기반:

```bash
agenttrace compare --since-config-change
```

나중에는:

```text
AGENTS.md changed
Skill installed
MCP installed
model changed
```

이벤트도 기록.

---

# 15. HTML Report

CLI 실행:

```bash
agenttrace report
```

출력:

```text
./agenttrace-report/index.html
```

또는 single-file:

```bash
agenttrace report --single
```

↓

```text
agenttrace.html
```

JS/CSS/chart 모두 inline.

이러면:

```bash
open agenttrace.html
```

하나로 끝.

---

# 16. Dashboard Layout

## Overview

```text
AgentTrace

Last 7 days

┌───────────────┐
│ 83 Sessions   │
└───────────────┘

┌───────────────┐
│ 18h 42m       │
│ Agent Time    │
└───────────────┘

┌───────────────┐
│ 4,821         │
│ Tool Calls    │
└───────────────┘

┌───────────────┐
│ 6h 12m        │
│ Hotspot Time  │
└───────────────┘
```

---

## Time Breakdown

Donut / stacked bar:

```text
Build      27%
Test       21%
Search     14%
MCP         9%
Read        8%
Other      21%
```

---

## Slowest Commands

```text
Command          Calls     Total      p50     p95
------------------------------------------------
xcodebuild          27      1h44m     3m2s    7m1s
npm test           143      2h18m      42s    1m58s
cargo test          61        58m      39s    1m33s
```

---

## Hotspots

카드 형태:

```text
🔥 Full rebuild loop

19 full xcodebuild calls
53m potentially avoidable

View sessions →
```

---

## Session Explorer

```text
Session #184

09:31 user prompt

09:32 search       3s
09:32 read         1s
09:33 edit         4s
09:34 xcodebuild  3m12s
09:38 edit        18s
09:39 xcodebuild  3m07s
...
```

Flame chart 형태도 좋음:

```text
MODEL █████████
SEARCH ██
READ   ███
EDIT   ██
BUILD  █████████████████
TEST   ███████████
```

---

# 17. HTML Visual Style

방향:

```text
GitHub Insights
+
Chrome DevTools Performance
+
Linear
```

느낌.

다크모드 기본.

색상은 의미 기준:

```text
model
tool
build
test
search
error
idle
```

지원:

```text
dark/light
responsive
offline
no backend
```

차트:

```text
ECharts
Plotly
Chart.js
```

중 하나.

single HTML을 중요하게 보면 `ECharts + inline bundle` 또는 직접 SVG 생성도 고려.

---

# 18. CLI

```bash
agenttrace
```

기본:

```text
agenttrace scan
agenttrace report
agenttrace open
agenttrace stats
agenttrace insights
agenttrace sessions
agenttrace compare
```

---

## scan

```bash
agenttrace scan

Found:
Claude Code   182 sessions
Codex          94 sessions

New:
17 sessions

Indexed:
1,842 events
```

---

## stats

```bash
agenttrace stats --last 7d
```

---

## report

```bash
agenttrace report --last 30d

Generated:
./agenttrace.html
```

---

## inspect

```bash
agenttrace session <id>
```

---

## compare

```bash
agenttrace compare \
  --from 2026-09-01 \
  --to 2026-09-30
```

---

# 19. Repo-aware Analytics

세션별 repo 자동 감지:

```text
~/Code/foo
~/Code/bar
```

그 후:

```bash
agenttrace stats --repo foo
```

HTML에서는:

```text
All Projects

foo
bar
c6s
obsdog
```

프로젝트별 병목 비교 가능.

---

# 20. Agent Comparison

같은 repo에서 Claude / Codex를 함께 사용한다면:

```text
                    Claude       Codex
----------------------------------------
sessions              82           71
median duration       12m          14m
tool calls            31           28
failed commands        2.4          1.8
search calls           8.1          5.4
tokens                47k          52k
```

단,

```text
different task mix
different model
different session complexity
```

때문에 단순 winner 판정은 하지 않는다.

---

# 21. Model Comparison

```text
Model A
Model B
```

기준:

```text
median task duration
tokens
tool calls
retry rate
failure recovery time
```

같은 task cluster끼리만 비교하면 의미가 커진다.

---

# 22. MCP Profiling

특히 MCP 병목을 잡는 기능이 유용.

```text
MCP server         Calls      Total       p95
------------------------------------------------
GitHub               241      47m         32s
Context7             112      14m          8s
Proxyman              63      26m         51s
```

method별:

```text
github/get_file
github/search_code
context7/query
```

출력 가능.

---

# 23. Sub-agent Profiling

오케스트레이터 → sub-agent 구조도 분석.

```text
Parent Session

├─ Research Agent       7m
├─ iOS Agent           18m
├─ Server Agent        11m
└─ Final Integration    6m
```

metric:

```text
delegation overhead
parallelism
duplicate exploration
cross-agent repeated reads
```

나중에:

```text
Research agent saved ~12 repeated searches
```

같은 분석도 가능.

---

# 24. Cost Analytics

가격 정보를 별도 config로 관리.

```yaml
models:
  model-a:
    input: ...
    output: ...
```

그러면:

```text
Cost / Session
Cost / Task
Cost / Successful Task
Cost / Minute Saved
```

등 계산 가능.

단 MVP 핵심은 cost보다 **time**.

---

# 25. Privacy

중요.

기본적으로:

```text
100% local
no upload
no telemetry
```

DB에는 원문 prompt / source code를 저장하지 않는 옵션 제공.

default:

```text
store_raw_prompt = false
store_raw_tool_output = false
```

저장:

```text
command pattern
duration
exit code
hash/fingerprint
metadata
```

민감정보 redaction:

```text
API_KEY
TOKEN
PASSWORD
Authorization
env values
```

---

# 26. Configuration

```text
~/.agenttrace/config.toml
```

예:

```toml
[privacy]
store_prompts = false
store_tool_output = false

[scan]
claude = true
codex = true

[report]
theme = "dark"
range = "30d"
```

---

# 27. Plugin / Parser Architecture

다른 agent 추가 가능하게.

```ts
interface SessionParser {
  detect(path): boolean
  parse(path): Session
}
```

builtin:

```text
ClaudeCodeParser
CodexParser
```

향후:

```text
Gemini CLI
Cursor
Windsurf
OpenCode
Aider
OpenHands
```

---

# 28. Export

```bash
agenttrace export --format json
agenttrace export --format csv
agenttrace export --format parquet
```

데이터 분석용.

---

# 29. CI / Team Mode — Later

처음에는 local-first.

나중에:

```text
agenttrace report --json
```

CI artifact로 업로드.

팀 단위로:

```text
median agent task time
tool latency
retry rate
```

집계 가능.

원본 prompt/code 없이 aggregate만 공유 가능하게.

---

# 30. MVP

## v0.1

지원:

```text
Claude Code
Codex
```

기능:

```text
session scan
SQLite
command/tool duration
command normalization
error / retry detection
HTML report
trend charts
```

CLI:

```text
agenttrace scan
agenttrace report
agenttrace open
```

---

## v0.2

```text
Skill detection
MCP profiling
session explorer
project filtering
before/after comparison
```

---

## v0.3

```text
insight engine
waste detection
task clustering
sub-agent analysis
model comparison
```

---

# 31. Recommended Stack

## Option A — TypeScript

추천.

```text
Node.js
TypeScript
SQLite
Drizzle / better-sqlite3
Commander / Clipanion
Vite
React
ECharts
```

장점:

```text
HTML UI 만들기 편함
JSONL parser 편함
빠른 개발
```

배포:

```text
npm
brew
standalone binary
```

---

## Option B — Rust

```text
Rust
rusqlite
serde_json
askama / embedded HTML
```

장점:

```text
single binary
빠른 scan
배포 편함
```

단 UI 개발 속도는 TS보다 느릴 수 있음.

### 추천

초기:

```text
TypeScript
```

성공하면 parser/scanner만 Rust로 옮겨도 됨.

---

# 32. Proposed Repository

```text
agenttrace/
├─ src/
│  ├─ cli/
│  ├─ parsers/
│  │  ├─ claude.ts
│  │  └─ codex.ts
│  ├─ normalize/
│  ├─ analyzer/
│  │  ├─ commands.ts
│  │  ├─ retries.ts
│  │  ├─ skills.ts
│  │  └─ insights.ts
│  ├─ db/
│  └─ report/
│
├─ web/
│  ├─ components/
│  ├─ charts/
│  └─ pages/
│
├─ fixtures/
│  ├─ claude/
│  └─ codex/
│
└─ docs/
```

---

# 33. The Killer Features

MVP 이후 차별화 포인트는 아래 5개.

## 1. Where did my time go?

```text
전체 wall-clock 시간을 카테고리별로 정확하게 분해.
```

---

## 2. Waste Detector

```text
retry loop
same error
repeated search
full rebuild
repeated reads
```

---

## 3. Before / After

```text
Skill 추가 전후
AGENTS.md 수정 전후
MCP 도입 전후
model 변경 전후
```

실제 효과 측정.

---

## 4. Trend

```text
"지난 한 달간 평균 세션 시간이 31% 감소"
```

---

## 5. Actionable Insights

단순:

```text
xcodebuild가 느립니다
```

가 아니라:

```text
이번 주 xcodebuild full build 19회

53분 사용

대부분 1~2개 파일 수정 직후 발생

→ targeted test/build 명령을 Skill 또는 AGENTS.md에 넣는 것을 고려
```

까지.

---

# 34. Possible Taglines

```text
Profile your AI coding agent.

See where your agent spends its time.

Find out why your coding agent is slow.

Performance profiling for AI coding agents.

Chrome DevTools for Claude Code and Codex.

Stop guessing where your agent time goes.
```

가장 직관적인 건:

> **Chrome DevTools for AI coding agents.**

또는:

> **Find out where your coding agent spends its time.**

---

# 35. Naming

현재 추천:

```text
agenttrace
agentprof
agentlens
sessiontrace
slowagent
```

개인적으로 제품 확장성을 생각하면:

```text
AgentTrace
```

가 가장 적합.

CLI:

```bash
agenttrace scan
agenttrace report
agenttrace insights
```

패키지/레포:

```text
github.com/<org>/agenttrace
npm install -g agenttrace
brew install agenttrace
```

---

# 36. First Milestone

가장 먼저 아래 하나만 성공시키면 된다.

```bash
agenttrace scan
agenttrace report
```

그리고 HTML에:

```text
1. Sessions
2. Total Time
3. Time by Tool
4. Slowest Commands
5. Failed / Retried Commands
6. Daily Trend
7. Session Timeline
```

이 7개만 예쁘게 보여준다.

이게 잘 동작한 뒤:

```text
Skills
MCP
Insights
Before/After
Task Clustering
```

을 붙이는 게 좋다.

---

# Final Product Definition

**AgentTrace is a local-first performance profiler for AI coding agents.**

Claude Code와 Codex의 세션 로그를 읽어:

```text
무엇을 했는지
얼마나 걸렸는지
어디서 반복했는지
무엇이 병목인지
시간이 어떻게 변하고 있는지
어떤 설정이 실제로 효과가 있는지
```

를 분석하고,

```text
agenttrace.html
```

하나로 보여준다.

목표는 단순한 usage dashboard가 아니라:

> **"AI coding agent를 어떻게 더 빠르고 효율적으로 만들 것인가?"**

를 데이터로 답해주는 도구.
