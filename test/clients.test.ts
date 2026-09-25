import { expect, test } from "bun:test";
import { detectClient } from "../server/clients";

test.each([
  [{ "user-agent": "claude-cli/2.1.3 (external, cli)" }, "claude-code"],
  [{ "x-claude-code-session-id": "abc" }, "claude-code"],
  [{ "user-agent": "codex_cli_rs/0.50.0 (Mac OS 15.1; arm64)" }, "codex"],
  [{ originator: "codex_cli_rs" }, "codex"],
  [{ "user-agent": "GeminiCLI/0.9.0 (darwin; arm64)" }, "gemini-cli"],
  [{ "user-agent": "opencode/1.0.0" }, "opencode"],
  [{ "x-kilocode-taskid": "t" }, "kilo"],
  [{ "user-agent": "RooCode/3.0" }, "roo"],
  [{ "x-task-id": "t" }, "cline"],
  [{ "user-agent": "mimocode/1.0" }, "mimo"],
  [{ "user-agent": "Zed/1.21.0+stable.362 (macos; aarch64)" }, "zed"],
  [{ "user-agent": "curl/8.0" }, null],
  [{}, null],
])("%o → %s", (headers, client) => {
  expect(detectClient(headers as Record<string, string>)).toBe(client);
});
