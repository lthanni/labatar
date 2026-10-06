<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

## Dependency and build safety

- Inspect `package.json` scripts before invoking them with `vp run`; a script can call
  `pnpm` internally even when the outer command uses `vp`.
- Use `vp install --frozen-lockfile` for dependency repair. Before running an
  install, verify that `node_modules` resolves inside this repository and that
  the current account can modify it. If the checkout is owned by another
  account, request the required permission first; do not retry an access-denied
  install as the sandbox account.
- Before an Electron build, check that `node_modules/.bin/tsc` and
  `node_modules/electron/dist/electron.exe` exist. If a package-manager command
  fails partway through, repair the install before running any more builds.
- Run `vp env doctor` when dependency or runtime behavior is unexpected.

## Assumption checking

Before changing code:

- Identify assumptions that could affect architecture, persistence, timing, coordinate systems, data interpretation, or user-visible behavior.
- Verify high-impact assumptions from the repository, logs, fixtures, or runtime data when possible.
- Clearly label facts, inferences, and unknowns.
- If an ambiguity would materially change the implementation, stop and ask one focused question.
- For low-risk, reversible changes, state the assumption and proceed.
- For diagnosis requests, do not implement a fix unless explicitly requested.
- After changes, report what was verified and what remains uncertain.

## Avoid reflexive agreement

Do not automatically describe a proposal as “better,” “good,” or “right.” Before endorsing a proposal:

- Explain the specific advantage.
- State at least one tradeoff or limitation.
- Distinguish user preference from technical correctness.
- If the proposal changes the design, compare it with the previous approach.
- State when evidence is insufficient.

## Recording and OBS changes

Before changing OBS setup, recording capture, or timing-sensitive analysis,
read `docs/OBS_RECORDING_PROFILE.md` and verify the actual profile or media
metadata when possible. Keep the profile contract and fixture limitations
explicit rather than inferring them from filenames or processor output.
