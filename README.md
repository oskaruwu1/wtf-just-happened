# wtf-just-happened (`wtf`)

> A transparent Pseudo-Terminal (PTY) wrapper for developer commands. When commands succeed, it stays completely invisible. When commands crash, it captures diagnostics, scrubs secrets, saves a local snapshot, and opens an interactive terminal menu with a copy-ready diagnostic Markdown report for LLMs (ChatGPT, Claude) and GitHub Issues.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Vitest](https://img.shields.io/badge/tested%20with-vitest-yellow.svg)](https://vitest.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Core Philosophy: Zero-Friction Transparency

- **Success (`exitCode === 0`):** `wtf` remains 100% invisible. Standard I/O flows normally, and `wtf` exits with code `0`.
- **Failure (`exitCode !== 0`):** Automatically captures the trailing 64KB terminal output, gathers system/Git/network context in parallel, scrubs sensitive secrets, stores an auto-pruned diagnostic bundle in `~/.wtf/crashes/`, and presents an interactive TUI to copy a formatted Markdown report or re-run the command.

---

## Installation & Usage

### Binary Aliases
The package exposes both `wtf` and `wtf-just-happened`:

```bash
# Wrap any build, test, or deployment command
wtf npm run build
wtf docker compose up
wtf cargo test
wtf pnpm test:e2e
```

### Subcommands & Flags

```bash
# Re-open the interactive menu for the most recent crash
wtf last

# Simulate a crash with fake secrets and stack trace to test the TUI
wtf --demo

# View help and usage options
wtf --help

# View CLI version
wtf --version
```

---

## Architecture & Features

```text
wtf-just-happened/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── README.md
├── src/
│   ├── cli.ts                  # Entry point, subcommands (`last`, `--demo`, `--help`), exit-code propagation
│   ├── core/
│   │   ├── pty-runner.ts       # PTY wrapper (node-pty with graceful fallback to child_process.spawn)
│   │   ├── ring-buffer.ts      # Fixed 64KB byte-bounded circular buffer + ANSI stripping
│   │   └── collector.ts        # Parallel Promise.allSettled context collector (200ms strict timeout)
│   ├── security/
│   │   └── redactor.ts         # Two-pass secret scrubber (env keys + regex/entropy patterns)
│   ├── formatters/
│   │   ├── markdown.ts         # Markdown diagnostic report generator (GitHub Issue & LLM optimized)
│   │   └── terminal-ui.ts      # Post-crash @clack/prompts interactive menu
│   └── utils/
│       └── storage.ts          # Saves/loads JSON crash bundles in ~/.wtf/crashes/ (auto-prunes > 20)
├── tests/
│   ├── ring-buffer.test.ts     # 64KB byte eviction and ANSI stripping unit tests
│   ├── redactor.test.ts        # AWS keys, JWTs, Bearer tokens, DB URIs redaction tests
│   └── cli.integration.test.ts # Silent exit 0 vs failing exit code propagation tests
└── playground/
    ├── package.json            # Playground test scripts (fail:build, fail:port)
    ├── broken-build.js         # Realistic build error with mock secrets & stack trace
    └── port-conflict.js        # Server collision simulating EADDRINUSE
```

### 1. Robust PTY Runner (`src/core/pty-runner.ts`)
- Spawns using `node-pty` for real terminal I/O (handling raw mode stdin forwarding and terminal resize events).
- Graceful fallback to `child_process.spawn` if native PTY bindings are unavailable in constrained or container environments.
- Windows binary resolution preventing `DEP0190` warnings and Windows batch file security restrictions.

### 2. 64KB Bounded Ring Buffer (`src/core/ring-buffer.ts`)
- Keeps memory usage strictly bounded to 64KB of trailing log data.
- Dual-mode output: `getRaw()` preserves ANSI colors for re-displaying, while `getClean()` strips ANSI escape codes for clean Markdown logs.

### 3. Parallel Context Collector (`src/core/collector.ts`)
- Strict **200ms per-check timeout** prevents hanging on slow network or filesystem operations.
- Gathers system diagnostics (OS platform, release, arch, Node version, memory, CPU count).
- Gathers Git state (branch, commit hash, dirty tree summary).
- Active port detection: parses ports mentioned in terminal errors and probes candidate ports (e.g., 3000, 5000, 8080) for `EADDRINUSE` conflicts.

### 4. Two-Pass Secret Redactor (`src/security/redactor.ts`)
- **Pass 1:** Inspects environment variables for sensitive keys (`API_KEY`, `TOKEN`, `SECRET`, `PASSWORD`, etc.) and scrubs exact values.
- **Pass 2:** Regex patterns for:
  - AWS Access Keys (`AKIA...`)
  - JWT tokens (`eyJ...`)
  - Bearer tokens (`Authorization: Bearer ...`)
  - Database URI passwords (`postgres://user:password@host`, `mongodb://`, `mysql://`, `redis://`)
  - Private Keys (`-----BEGIN ... PRIVATE KEY-----`)
  - GitHub and Slack tokens

### 5. Interactive Post-Crash Terminal Menu (`src/formatters/terminal-ui.ts`)
- Powered by `@clack/prompts` and `picocolors`.
- Menu options:
  - **Copy Markdown Report:** Copies LLM-optimized diagnostic prompt to system clipboard using `clipboardy`.
  - **View Redacted Terminal Output:** Inspects trailing logs with secrets masked.
  - **Print Full Markdown Report:** Dumps formatted report to console.
  - **View Environment & System Context:** Displays system specs and safe environment variables.
  - **Re-run Command:** Retries command execution immediately.
  - **Exit:** Exits cleanly propagating the original exit code.
- Automatically falls back to a concise stderr summary in non-interactive CI environments.

### 6. Local Storage & Auto-Pruning (`src/utils/storage.ts`)
- Snapshots saved to `~/.wtf/crashes/crash-<timestamp>.json`.
- Automatic retention policy: auto-prunes older files to keep at most 20 recent crashes.

---

## Interactive Playground Sandbox

Test the complete end-to-end failure capture with a single command:

```bash
npm run try:playground
```

This runs `playground/broken-build.js`, which outputs colorful build logs containing fake credentials (`postgres://admin:supersecret123@localhost:5432/prod` and AWS key `AKIAIOSFODNN7EXAMPLE`) and crashes with a realistic stack trace.

You can also test port conflict detection:
```bash
node dist/cli.js npm --prefix playground run fail:port
```

---

## Testing

Run unit and integration tests with Vitest:

```bash
npm test
```
