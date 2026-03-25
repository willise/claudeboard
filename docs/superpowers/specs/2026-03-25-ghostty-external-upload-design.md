# Ghostty External Upload Design

**Date:** 2026-03-25

**Goal:** Extend Claudeboard so a macOS user can press `Ctrl+Alt+V` in Ghostty, invoke the extension through a `vscode://` URI, upload the current clipboard image to the active Remote-SSH workspace, and insert the remote file path back into Ghostty.

## Current State

- The extension can already read a local clipboard image on the UI side.
- The extension can already write the uploaded image into the remote workspace under `.claude/claude-code-chat-images/`.
- The extension can already insert the resulting remote path into a VS Code editor or integrated terminal.
- There is no external entrypoint for Ghostty or any other terminal outside VS Code.

## Constraints

- Keep existing editor and integrated-terminal shortcuts working.
- Keep the current image-only clipboard scope.
- Target macOS Ghostty with `Ctrl+Alt+V`.
- Avoid a Node.js runtime dependency on the local machine.
- Do not require the extension to manage arbitrary outbound URLs; localhost callbacks only.

## Chosen Approach

Use a `UriHandler` inside the VS Code extension plus a Hammerspoon workflow on macOS:

1. Hammerspoon registers `Ctrl+Alt+V` when Ghostty is focused.
2. Hammerspoon starts a short-lived localhost callback server.
3. Hammerspoon opens a `vscode://dkodr.claudeboard/ghostty-upload?...` URI.
4. The extension handles the URI, reuses the existing clipboard-upload flow, and obtains the remote image path.
5. The extension POSTs the result back to Hammerspoon's localhost callback.
6. Hammerspoon inserts the remote path into the focused Ghostty terminal.

## Extension Changes

### Reusable upload path

Refactor the current upload command so there is a reusable function that:

- validates there is a Remote-SSH connection,
- reads the clipboard image,
- uploads the image into the remote workspace,
- returns the remote path without inserting it anywhere.

Existing editor and terminal commands will call this reusable function and then do their own insertion step.

### URI entrypoint

Register a single `UriHandler` during activation. The handler accepts:

- `path = /ghostty-upload`
- `requestId`
- `callback`

The handler will:

1. validate the callback target is localhost,
2. run the reusable upload flow,
3. POST either success or failure to the callback endpoint.

### Callback client service

Add a small service responsible only for POSTing JSON back to the Hammerspoon callback endpoint. It will enforce localhost-only targets and keep HTTP details out of the command logic.

## Hammerspoon Flow

The repository will ship an example Hammerspoon config that:

- binds `Ctrl+Alt+V`,
- only triggers when the frontmost app is Ghostty,
- starts a short-lived localhost server,
- opens the `vscode://` URI,
- waits for the callback,
- inserts the remote path into Ghostty on success,
- shows a macOS notification on failure.

## Error Handling

- If VS Code does not respond before timeout, show a macOS notification.
- If there is no Remote-SSH connection, return an error through the callback and do not type anything into Ghostty.
- If there is no image in the clipboard, return an error through the callback and do not type anything into Ghostty.
- If Ghostty loses focus before insertion, notify the user and avoid typing into another app.

## Testing Strategy

- Add unit tests for URI query parsing and localhost callback validation.
- Add unit tests for the callback client request behavior using a local HTTP server.
- Keep the upload-path refactor small and cover the newly extracted pure helpers first.
- Verify the extension still compiles and that existing commands keep their behavior.

## Notes

- A spec-review subagent was not dispatched because subagent use was not explicitly permitted when the design was written.
