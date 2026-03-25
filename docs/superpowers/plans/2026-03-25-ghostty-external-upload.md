# Ghostty External Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a macOS Ghostty-triggered clipboard image upload flow that reuses Claudeboard's Remote-SSH upload path and inserts the remote path back into Ghostty through a localhost callback.

**Architecture:** Extract a reusable upload operation from the existing command, add a `UriHandler` plus a localhost-only callback client in the extension, and document a Hammerspoon configuration that opens the `vscode://` URI and receives the callback. Existing VS Code editor and integrated-terminal commands remain unchanged in behavior.

**Tech Stack:** TypeScript, VS Code Extension API, Node HTTP/HTTPS APIs, node:test, Hammerspoon (documentation/example only)

---

### File Map

**Create:**
- `docs/superpowers/specs/2026-03-25-ghostty-external-upload-design.md`
- `src/services/callbackClient.ts`
- `src/services/externalUri.ts`
- `test/callbackClient.test.js`
- `test/externalUri.test.js`
- `examples/hammerspoon/init.lua`

**Modify:**
- `src/commands/uploadImage.ts`
- `src/extension.ts`
- `package.json`
- `README.md`
- `tsconfig.json`

### Task 1: Add a tiny test harness for pure helpers

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `test/externalUri.test.js`
- Create: `test/callbackClient.test.js`

- [ ] **Step 1: Write the failing tests**

Create tests for:

- parsing `/ghostty-upload` URIs and extracting `requestId` + `callback`
- rejecting non-localhost callback URLs
- POSTing success/failure payloads to a localhost HTTP server

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/*.test.js`
Expected: FAIL because helper modules do not exist yet.

- [ ] **Step 3: Write minimal implementation scaffolding**

Add pure helper modules for URI parsing/validation and callback POST logic with the smallest API surface needed by the tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json test/*.test.js src/services/externalUri.ts src/services/callbackClient.ts
git commit -m "test: add external uri and callback client coverage"
```

### Task 2: Reuse upload logic from the existing command

**Files:**
- Modify: `src/commands/uploadImage.ts`

- [ ] **Step 1: Write the failing test**

Add or extend a targeted test seam around the extracted upload function if a pure helper can cover the behavior; otherwise document the compile-only seam and keep the extraction minimal.

- [ ] **Step 2: Run the relevant test or compile step to verify failure**

Run: `npm run compile`
Expected: FAIL until the refactor compiles cleanly.

- [ ] **Step 3: Write minimal implementation**

Extract a reusable upload function that returns the remote path and let the existing editor/terminal commands call it before insertion.

- [ ] **Step 4: Run verification**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/uploadImage.ts
git commit -m "refactor: extract reusable clipboard upload flow"
```

### Task 3: Add the external URI entrypoint

**Files:**
- Modify: `src/extension.ts`
- Create: `src/services/externalUri.ts`
- Create: `src/services/callbackClient.ts`

- [ ] **Step 1: Write the failing tests**

Cover URI parsing and callback validation before wiring them into activation.

- [ ] **Step 2: Run tests to verify failure**

Run: `node --test test/externalUri.test.js test/callbackClient.test.js`
Expected: FAIL before implementation is wired.

- [ ] **Step 3: Write minimal implementation**

Register the `UriHandler`, parse incoming URIs, call the reusable upload function, and POST the result to the localhost callback.

- [ ] **Step 4: Run tests and compile**

Run: `node --test test/externalUri.test.js test/callbackClient.test.js && npm run compile`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/extension.ts src/services/externalUri.ts src/services/callbackClient.ts
git commit -m "feat: add external ghostty uri entrypoint"
```

### Task 4: Document macOS Ghostty usage

**Files:**
- Create: `examples/hammerspoon/init.lua`
- Modify: `README.md`

- [ ] **Step 1: Write the failing documentation checklist**

Checklist:

- README explains prerequisites and setup
- README includes the `vscode://`/callback flow at a high level
- Hammerspoon example binds `Ctrl+Alt+V` for Ghostty only

- [ ] **Step 2: Verify the checklist is currently unmet**

Run: `rg -n "Ghostty|Hammerspoon|Ctrl\\+Alt\\+V" README.md examples/hammerspoon/init.lua`
Expected: Missing files/sections

- [ ] **Step 3: Write minimal documentation and example**

Add the Hammerspoon example and concise README instructions, keeping the scope image-only and macOS-only.

- [ ] **Step 4: Run verification**

Run: `rg -n "Ghostty|Hammerspoon|Ctrl\\+Alt\\+V|vscode://" README.md examples/hammerspoon/init.lua`
Expected: Matches present in both files

- [ ] **Step 5: Commit**

```bash
git add README.md examples/hammerspoon/init.lua
git commit -m "docs: add macos ghostty integration guide"
```

### Task 5: Final verification

**Files:**
- Modify: only as needed from prior tasks

- [ ] **Step 1: Run unit tests**

Run: `node --test test/*.test.js`
Expected: PASS

- [ ] **Step 2: Run compile**

Run: `npm run compile`
Expected: PASS

- [ ] **Step 3: Review docs and requirements**

Confirm:

- existing editor/terminal commands still exist
- external flow is image-only
- callback targets are localhost-only
- README documents macOS Ghostty + Hammerspoon setup

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat: add macos ghostty external upload flow"
```

## Review Notes

- Plan-document reviewer dispatch is intentionally skipped unless the user explicitly asks for another review agent.
