# P3 synthetic fixture oracle

Every ID, path, command, value and content in `claude-real-shapes.jsonl` is invented. The fixture uses source-observed structural shapes. It does not certify a Claude Code version. `claude-p3-expected.json` fixes the hand calculations before adapter tests run.

One API message ID has three distinct UUID/content records and usage snapshots 6, 8 and 10. Both tool calls survive that shared API ID. Source ordinal selects the last provisional snapshot. The external `trustedFinalContext` additionally validates synthetic final selection; raw annotations and stop reason alone do not supply finality.

The two completed calls have paired invocation latency of 3,000 ms each. Sidechain MCP latency is 2,000 ms. A fabricated process-exit phrase in output is inert. Bash and Agent acknowledgements remain pending, each with a 1,000 ms source observation. Turn durations 9,000 ms and 0 have unknown scope and no interval. Direct tool runtime is absent. Cache creation TTL buckets and fabricated thinking details add no tokens.

P0 `claude-message.jsonl`, `claude-fork.jsonl` and `expected.json` remain unchanged. Their duration and finality assertions use precise external fixture context as documented in `docs/CLAUDE-PARSER.md`.
