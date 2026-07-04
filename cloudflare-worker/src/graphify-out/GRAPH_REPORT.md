# Graph Report - cloudflare-worker\src  (2026-07-05)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 27 nodes · 57 edges · 3 communities
- Extraction: 82% EXTRACTED · 18% INFERRED · 0% AMBIGUOUS · INFERRED: 10 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bc4ab725`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_github.ts|github.ts]]
- [[_COMMUNITY_index.ts|index.ts]]
- [[_COMMUNITY_fetch|fetch]]

## God Nodes (most connected - your core abstractions)
1. `fetch()` - 19 edges
2. `exchangeCode()` - 3 edges
3. `getUserInfo()` - 3 edges
4. `getUserRepos()` - 3 edges
5. `readFile()` - 3 edges
6. `writeFile()` - 3 edges
7. `deleteFile()` - 3 edges
8. `listDir()` - 3 edges
9. `getRepoBranches()` - 3 edges
10. `getTree()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `getUserInfo()` --calls--> `fetch()`  [INFERRED]
  github.ts → index.ts
- `getUserEmail()` --calls--> `fetch()`  [INFERRED]
  github.ts → index.ts
- `getUserRepos()` --calls--> `fetch()`  [INFERRED]
  github.ts → index.ts
- `readFile()` --calls--> `fetch()`  [INFERRED]
  github.ts → index.ts
- `writeFile()` --calls--> `fetch()`  [INFERRED]
  github.ts → index.ts

## Import Cycles
- None detected.

## Communities (3 total, 0 thin omitted)

### Community 0 - "github.ts"
Cohesion: 0.18
Nodes (10): Env, FileInfo, getRepoBranches(), getTree(), getUserInfo(), getUserRepos(), listDir(), readFile() (+2 more)

### Community 1 - "index.ts"
Cohesion: 0.28
Nodes (8): writeFile(), authenticate(), generateSessionToken(), generateState(), hexToUint8Array(), isSafePathParam(), parseState(), validateSessionToken()

### Community 2 - "fetch"
Cohesion: 0.33
Nodes (7): deleteFile(), exchangeCode(), getUserEmail(), addCorsHeaders(), corsHeaders(), fetch(), safeJsonParse()

## Knowledge Gaps
- **3 isolated node(s):** `UserInfo`, `Repo`, `FileInfo`
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `fetch()` connect `fetch` to `github.ts`, `index.ts`?**
  _High betweenness centrality (0.233) - this node is a cross-community bridge._
- **Why does `authenticate()` connect `index.ts` to `fetch`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Why does `parseState()` connect `index.ts` to `fetch`?**
  _High betweenness centrality (0.003) - this node is a cross-community bridge._
- **Are the 10 inferred relationships involving `fetch()` (e.g. with `deleteFile()` and `exchangeCode()`) actually correct?**
  _`fetch()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **What connects `UserInfo`, `Repo`, `FileInfo` to the rest of the system?**
  _3 weakly-connected nodes found - possible documentation gaps or missing edges._