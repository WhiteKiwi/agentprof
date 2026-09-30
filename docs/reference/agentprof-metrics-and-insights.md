# AgentProf — Metrics, Diagnostics & Mascot Direction

> **AgentProf** is a local-first performance profiler for AI coding agents.
> The goal is not to show vanity stats, but to answer:
>
> **Where is the agent slow? Why is it slow? What can I change to make it faster?**

---

# 1. Product Principle

AgentProf should avoid becoming a generic usage dashboard.

Metrics such as total token count, total tool calls, and number of sessions are useful context, but they are not the product.

The core value is:

```text
measurement
    ↓
pattern detection
    ↓
diagnosis
    ↓
actionable improvement
    ↓
before / after verification
```

The product should focus on **measurable bottlenecks and detectable waste**.

---

# 2. Core Profiling Dimensions

```text
1. Time
2. Tokens
3. Tool / Command Activity
4. Failure & Retry
5. Context Churn
6. Validation Strategy
7. Recovery
8. External Tool Latency
9. Skill / Config Effectiveness
10. Historical Regression
```

---

# 3. Time Hotspots

The most important question:

> Where did the time go?

Track time by session, turn, tool, command, command category, MCP server, MCP method, skill, task cluster, project, and model.

Useful metrics:

```text
total duration
active duration
tool duration
model duration
unknown / idle duration

mean
median
p90
p95
max
```

Example:

```text
Active Agent Time     3h 42m

xcodebuild              58m   26%
pytest                   31m   14%
MCP                      22m   10%
search                   18m    8%
file reads               13m    6%
```

Example diagnosis:

```text
TIME HOTSPOT

xcodebuild consumed 26% of active agent time.

Calls      27
Total      58m
Median     1m 21s
P95        4m 12s
Max        7m 48s
```

Possible insight:

```text
The dominant bottleneck is build/validation time,
not model reasoning or repository exploration.
```

---

# 4. Retry Waste

Detect repeated attempts around the same operation.

Example:

```text
npm test foo
→ fail

edit

npm test foo
→ fail

edit

npm test foo
→ fail

edit

npm test foo
→ pass
```

Metrics:

```text
attempts
failed attempts
successful attempt
retry chain duration
failed-attempt duration
retry overhead
```

Example:

```text
RETRY CHAIN

npm test <target>

Attempts         4
Failures         3
Total time       8m 14s
Successful run   2m 03s
Retry overhead   6m 11s
```

Weekly aggregation:

```text
Retry overhead       2h 17m
% active agent time    11.8%
```

This becomes a useful KPI:

> How much time is spent repeating failed operations?

---

# 5. Repeated Error Detection

Normalize error output into fingerprints.

Metrics:

```text
occurrences
sessions affected
total recovery time
average recurrence interval
commands associated
projects affected
```

Example:

```text
REPEATED ERROR

DATABASE_URL missing

Occurrences        7
Sessions           4
Total time lost    23m
```

High-value insight:

```text
The same setup error appeared across multiple sessions.

This is likely persistent missing knowledge rather than
a one-off coding mistake.
```

Potential permanent fixes:

```text
AGENTS.md
CLAUDE.md
project setup docs
bootstrap script
custom Skill
environment validation
```

---

# 6. Context Churn

Detect when the agent repeatedly re-reads or re-searches the same context.

Useful metrics:

```text
unique file reads
total file reads
repeat read count
repeat read ratio

unique searches
total searches
repeated query similarity
```

Example:

```text
File                 Reads
--------------------------------
AuthManager.ts          9
package.json            7
README.md               6
```

Derived metric:

```text
total file reads      91
unique files          38

repeat read ratio     58%
```

Short-window diagnosis:

```text
HIGH CONTEXT CHURN

AuthManager.ts was read 4 times within 9 minutes.
```

Potential insight:

```text
The agent repeatedly rediscovered the same repository context.

Consider documenting the module structure or workflow in:
- AGENTS.md
- CLAUDE.md
- repository map
- custom Skill
```

This can become one of AgentProf's strongest features:

> Find what knowledge should be made persistent.

---

# 7. Search Thrashing

Detect excessive codebase exploration without corresponding progress.

Signals:

```text
high search count
high repeated search similarity
few edits
few successful validations
repeated search → read → search loops
```

Example:

```text
43 searches
61 file reads
4 files edited
```

Diagnosis:

```text
EXCESSIVE EXPLORATION

14m spent exploring the codebase.

Similar task sessions:
19 searches
27 reads
```

Potential causes:

```text
unclear repository architecture
poor navigation hints
missing module map
weak task context
agent lost previous context
```

---

# 8. Validation Waste

Detect whether the agent validates too broadly or too frequently.

Example:

```text
edit 2 lines
↓
full xcodebuild   3m

edit 1 line
↓
full xcodebuild   3m

edit 4 lines
↓
full xcodebuild   3m
```

Track:

```text
edit → validation cycles
full builds
incremental builds
targeted tests
full test suite runs
time per validation
changed lines before validation
```

Example:

```text
VALIDATION HOTSPOT

11 edits
9 full builds

Build time        31m
Edit time          4m

87% of validation cycles used a full build.
```

Actionable insight:

```text
The agent is validating small changes with expensive full builds.

Potential improvement:
- targeted tests
- targeted build commands
- fast validation scripts
- document preferred validation workflow in AGENTS.md / Skill
```

---

# 9. Recovery Time

Failure count alone is not enough.

Measure:

```text
first failure
    ↓
successful recovery
```

Aggregate by error fingerprint, command, tool, project, task type, and skill.

Example:

```text
Median Recovery Time

TypeScript       2m 12s
pytest           4m 31s
xcodebuild      11m 18s
Docker          17m 42s
```

Useful insight:

```text
Docker-related failures take 4× longer to recover from
than ordinary test failures.
```

That directly identifies where better tooling or documentation is needed.

---

# 10. Tool / MCP Latency

Measure external tool latency independently from agent reasoning.

Track:

```text
call timestamp
result timestamp
latency
success
server
method
```

Example:

```text
MCP Server        Calls    Total     Median    P95
--------------------------------------------------
GitHub              182      21m       2.8s   14.3s
Context7             92      11m       2.1s    8.0s
Proxyman             63      26m       8.2s   51.0s
```

Method-level:

```text
github/search_code       p95 18s
github/get_file          p95  2s
github/list_issues       p95  4s
```

Important diagnosis:

```text
17% of active session time was spent waiting for MCP responses.

The bottleneck is external tooling rather than the model.
```

---

# 11. Token Hotspots

Total token usage is not enough.

Track token usage by phase:

```text
initial exploration
implementation
debugging
validation
final response
```

Example:

```text
Initial exploration      72k
Implementation           31k
Test debugging          118k
Final verification       19k
```

Diagnosis:

```text
Test debugging consumed 49% of session context.
```

Other useful attribution:

```text
tokens by turn
tokens by task phase
tokens around repeated reads
tokens around retry loops
tokens before/after Skill usage
cached vs uncached tokens
```

---

# 12. Edit → Validation Cycle

A useful fundamental unit:

```text
EDIT
  ↓
VALIDATE
  ↓
PASS / FAIL
```

Track each cycle:

```text
files changed
lines changed
validation command
validation duration
pass/fail
retry count
```

Derived metrics:

```text
first-pass validation rate
median validation duration
failed validation cycles
full-build ratio
```

Example:

```text
First-pass validation rate: 42%
```

---

# 13. Detected Waste

AgentProf should avoid claiming that all non-editing time is waste.

Instead, expose:

> **Detected Waste**

Only count patterns with concrete evidence.

Possible components:

```text
failed retry time
repeated same-error time
redundant validation time
repeated context lookup time
repeated search time
known duplicated tool calls
```

Example:

```text
Total active time      4h 32m

Detected Waste         1h 14m

├─ failed retries         31m
├─ repeated errors        18m
├─ repeated reads         11m
├─ redundant builds        9m
└─ repeated searches       5m
```

This can become AgentProf's headline metric.

Important wording:

```text
Detected Waste
```

not:

```text
Wasted Time
```

because some repeated work may still be necessary.

---

# 14. Compound Diagnoses

## Excessive Exploration

Signals:

```text
high search count
+
high repeated reads
+
low edit count
```

Likely improvement:

```text
repository map
navigation Skill
AGENTS.md architecture section
```

## Validation Thrashing

Signals:

```text
high build/test time
+
small edits
+
many full validations
```

Likely improvement:

```text
targeted validation commands
fast test scripts
better incremental workflow
```

## Missing Persistent Knowledge

Signals:

```text
same error fingerprint
+
multiple sessions
+
long recovery time
```

Likely improvement:

```text
AGENTS.md
Skill
bootstrap script
project docs
```

## External Tool Bottleneck

Signals:

```text
high MCP latency
+
low local command latency
+
high wait share
```

Likely improvement:

```text
reduce MCP calls
batch requests
switch method
cache results
replace remote operation with local operation
```

## Context Instability

Signals:

```text
repeated read
+
repeated search
+
same files revisited
+
long sessions
```

Potential improvement:

```text
shorter sessions
better persistent instructions
better architecture summary
sub-agent specialization
```

---

# 15. Skill Effectiveness

Do not measure Skills by invocation count.

Measure whether they change behavior.

Example:

```text
Task type: iOS build debugging

                     Skill       No Skill
------------------------------------------------
Median duration       12m           19m
Search calls           14            31
Repeated reads          3            12
Retries                1.2           4.3
Recovery time           3m           11m
Tokens                 38k           61k
```

Important:

```text
correlation != causation
```

Good UI wording:

```text
Sessions using ios-debugging showed:
- 37% lower median duration
- 55% fewer searches
- 72% lower recovery time
```

---

# 16. AGENTS.md / CLAUDE.md Effectiveness

Record configuration change points.

Example:

```text
2026-09-15
AGENTS.md changed
```

Compare windows:

```text
14 days before
vs
14 days after
```

Metrics:

```text
session duration
search count
repeat reads
retry overhead
recovery time
token usage
```

Example insight:

```text
After the repository architecture section was added:

Repeated file reads     -34%
Search calls            -28%
Median session time     -16%
```

This turns agent instructions into measurable infrastructure.

---

# 17. Historical Regression Detection

Store aggregate history.

Example:

```text
Median session duration

Week 1     12.4m
Week 2     12.9m
Week 3     18.7m
```

Detect:

```text
PERFORMANCE REGRESSION

Median session duration increased 45% this week.

Primary changes:
- xcodebuild time +72%
- MCP latency +18%
- retry overhead unchanged
```

This replaces vague impressions like:

```text
"The model feels slower lately."
```

with measurable evidence.

---

# 18. MVP Metrics

Recommended MVP:

```text
1. Active Time
2. Time by tool / command / category
3. Tool latency p50 / p95
4. Failed executions
5. Retry overhead
6. Repeated error time
7. Recovery time
8. Repeated read/search ratio
9. Edit → validation cycles
10. Token attribution
```

---

# 19. MVP Automatic Diagnoses

Start with six:

```text
🔥 Slow Tool
🔁 Retry Loop
❌ Repeated Error
🔎 Exploration Thrashing
🏗 Validation Thrashing
🧠 Context Churn
```

Later:

```text
🌐 MCP Bottleneck
📉 Performance Regression
📚 Missing Persistent Knowledge
🧩 Skill Effectiveness
```

---

# 20. Dashboard Priority

The first page should answer three questions immediately.

## A. Where did my time go?

```text
Time Breakdown
```

## B. Where am I wasting time?

```text
Detected Waste
```

## C. What should I fix first?

```text
Top Insights
```

Suggested top section:

```text
AgentProf
Last 7 days

Active Time        18h 42m
Tokens             8.4M
Detected Waste      3h 11m
Sessions                83

Top Bottleneck
xcodebuild — 14.2% of active time

Top Waste
Retry loops — 1h 03m

Top Persistent Problem
DATABASE_URL missing — 8 sessions
```

---

# 21. Product Positioning

Avoid positioning AgentProf as:

```text
AI usage dashboard
token tracker
LLM observability platform
```

Better:

> **Performance profiler for AI coding agents.**

Mental model:

```text
Chrome DevTools Performance
+
profiler
+
lint-style diagnostics
```

for Claude Code, Codex, and other coding agents.

---

# 22. Mascot Direction

A mascot should work as:

```text
GitHub avatar
CLI/logo mark
HTML report icon
app icon
README illustration
```

Desired style:

```text
modern
monochrome
simple line art
no text inside icon
recognizable at 32px
```

---

# 23. Candidate: Salamander / Newt

A salamander is a strong fit.

Possible associations:

```text
heat
temperature
survival
sensitivity to environment
regeneration
adaptation
```

AgentProf is effectively finding:

```text
hot paths
hotspots
slow zones
performance problems
```

So a salamander can become a visual metaphor for:

> **finding hot spots in an agent session**

It is also much less common than owl, fox, robot, ant, or dog mascots.

## Visual directions

### A. Heat-seeking salamander

Minimal side-view silhouette with a long curved tail.

### B. Salamander + flame

Avoid a literal cartoon flame. Instead, let the tail subtly resemble a flame.

### C. Salamander trace

Form the body from one continuous line that resembles a timeline or performance trace.

## Pros

```text
distinctive
memorable
friendly
great silhouette
works in monochrome
good story around heat/hotspots
```

## Cons

```text
does not immediately communicate profiling
needs branding/story to connect concept
can look too cute if illustrated poorly
```

## Score

```text
Distinctiveness        ★★★★★
Icon potential         ★★★★★
Meaning fit            ★★★★☆
Developer-tool feel    ★★★★☆
```

---

# 24. Candidate: Ant

Ants map naturally to agents:

```text
workers
tasks
parallel execution
coordination
efficiency
```

This is especially relevant if AgentProf later analyzes:

```text
sub-agents
multi-agent orchestration
parallel work
```

## Visual directions

### A. Inspector ant

Minimal ant silhouette with an emphasized head.

### B. Ant + timeline

An ant walking across a profiling timeline.

### C. Three-node ant

Represent the ant body as three profiler nodes:

```text
○ — ○ — ○
```

## Pros

```text
strong agent/worker metaphor
easy to understand
good for multi-agent story
```

## Cons

```text
less unique
many developer tools already use insects
can imply distributed systems more than profiling
six legs/antennae become messy at small icon sizes
```

## Score

```text
Distinctiveness        ★★★☆☆
Icon potential         ★★★☆☆
Meaning fit            ★★★★☆
Developer-tool feel    ★★★★☆
```

---

# 25. Other Candidates

## Gecko

Associations:

```text
fast
agile
observant
```

Strong silhouette, but weaker profiling story and strong existing commercial associations.

## Mole

Metaphor:

```text
digging below the surface
finding hidden bottlenecks
```

Very distinctive, but less technical.

## Bloodhound

Metaphor:

```text
follow the trace
find where the time disappeared
```

Strong diagnosis metaphor, but dog mascots are common and harder to simplify.

---

# 26. Recommended Mascot

## #1 Salamander

Recommended.

Why:

```text
AgentProf
→ profiling
→ hot paths
→ hotspots
→ heat
→ salamander
```

The story is subtle but coherent.

It is unusual enough to become recognizable independently of the word AgentProf.

Recommended visual:

```text
simple side-view salamander
long curved tail
single continuous line
slightly angular/sharp rather than cute
monochrome
no text
```

Most important idea:

> Make the salamander's body/tail resemble a performance trace.

The tail could subtly evoke:

```text
timeline
waveform
flame graph
```

without making the metaphor literal.

---

## #2 Ant

Choose the ant instead if AgentProf's long-term positioning becomes primarily:

```text
multi-agent orchestration profiler
```

rather than:

```text
coding-agent performance profiler
```

The ant is stronger for workers, sub-agents, parallel execution, and coordination, but weaker as a unique standalone brand.

---

# 27. Recommendation

```text
Product      AgentProf
Repository   agentprof
Mascot       Salamander
```

Brand idea:

> **AgentProf — find the hot spots in your coding agent.**

Recommended first visual exploration:

```text
1. side-view salamander silhouette
2. continuous-line salamander
3. salamander whose tail resembles a performance trace
4. salamander curled into a circular profiler icon
5. geometric salamander head + curved tail
```

Keep all concepts:

```text
monochrome
no text
simple line
centered
recognizable at favicon size
```
