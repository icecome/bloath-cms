# Graph Report - web\src  (2026-07-05)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 109 nodes · 265 edges · 8 communities
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 4 edges (avg confidence: 0.57)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `bc4ab725`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [[_COMMUNITY_DraftsPage.tsx|DraftsPage.tsx]]
- [[_COMMUNITY_App.tsx|App.tsx]]
- [[_COMMUNITY_api.ts|api.ts]]
- [[_COMMUNITY_CollectionsContext.tsx|CollectionsContext.tsx]]
- [[_COMMUNITY_EditorPage.tsx|EditorPage.tsx]]
- [[_COMMUNITY_ErrorBoundary|ErrorBoundary]]
- [[_COMMUNITY_FrontmatterPanel.tsx|FrontmatterPanel.tsx]]

## God Nodes (most connected - your core abstractions)
1. `useAuth()` - 19 edges
2. `useCollections()` - 13 edges
3. `moveFile()` - 12 edges
4. `useRepo()` - 11 edges
5. `EditorPage()` - 10 edges
6. `scanMdFiles()` - 9 edges
7. `DraftsPage()` - 9 edges
8. `MediaPage()` - 9 edges
9. `apiFetch()` - 8 edges
10. `writeFile()` - 8 edges

## Surprising Connections (you probably didn't know these)
- `MediaPage()` --calls--> `formatDate()`  [INFERRED]
  pages/MediaPage.tsx → components/editor/FrontmatterPanel.tsx
- `ProtectedRoute()` --calls--> `useAuth()`  [EXTRACTED]
  App.tsx → hooks/useAuth.ts
- `DraftsPage()` --calls--> `useCollections()`  [EXTRACTED]
  pages/DraftsPage.tsx → contexts/CollectionsContext.tsx
- `EditorPage()` --calls--> `useCollections()`  [EXTRACTED]
  pages/EditorPage.tsx → contexts/CollectionsContext.tsx
- `MediaPage()` --calls--> `useCollections()`  [EXTRACTED]
  pages/MediaPage.tsx → contexts/CollectionsContext.tsx

## Import Cycles
- None detected.

## Communities (8 total, 0 thin omitted)

### Community 0 - "DraftsPage.tsx"
Cohesion: 0.17
Nodes (15): DirectorySelectorDropdownProps, EmptyStateProps, LoadingState(), Pagination(), PaginationProps, ToastProps, FileItem, RepoInfo (+7 more)

### Community 1 - "App.tsx"
Cohesion: 0.16
Nodes (15): EditorPage, ProtectedRoute(), MainLayout(), loadSavedRepo(), RepoContext, RepoContextType, RepoProvider(), RepoState (+7 more)

### Community 2 - "api.ts"
Cohesion: 0.19
Nodes (15): apiFetch(), ContentItem, FileReadResult, getFiles(), getTree(), RepoInfo, TreeItem, uploadImage() (+7 more)

### Community 3 - "CollectionsContext.tsx"
Cohesion: 0.19
Nodes (13): CollectionConfig, CollectionsContext, CollectionsContextType, CollectionsProvider(), DEFAULT_COLLECTION_CONFIG, DEFAULT_MEDIA_CONFIG, loadCollectionConfig(), loadMediaConfig() (+5 more)

### Community 4 - "EditorPage.tsx"
Cohesion: 0.33
Nodes (8): VditorEditor(), VditorEditorProps, formatTimestamp(), writeFile(), EditorPage(), Frontmatter, generateFrontmatter(), parseFrontmatter()

### Community 5 - "ErrorBoundary"
Cohesion: 0.29
Nodes (3): ErrorBoundary, Props, State

### Community 6 - "FrontmatterPanel.tsx"
Cohesion: 0.33
Nodes (4): formatDate(), Frontmatter, FrontmatterPanel(), FrontmatterPanelProps

## Knowledge Gaps
- **28 isolated node(s):** `EditorPage`, `Frontmatter`, `FrontmatterPanelProps`, `VditorEditorProps`, `DirectorySelectorDropdownProps` (+23 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `useAuth()` connect `App.tsx` to `DraftsPage.tsx`, `api.ts`, `CollectionsContext.tsx`, `EditorPage.tsx`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `useCollections()` connect `CollectionsContext.tsx` to `DraftsPage.tsx`, `api.ts`, `EditorPage.tsx`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **What connects `EditorPage`, `Frontmatter`, `FrontmatterPanelProps` to the rest of the system?**
  _28 weakly-connected nodes found - possible documentation gaps or missing edges._