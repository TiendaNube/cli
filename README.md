# @tiendanube/cli

An Official CLI to automate theme development and interact with **Nuvemshop / Tiendanube** backend.

[![npm version](https://img.shields.io/npm/v/@tiendanube/cli.svg)](https://www.npmjs.com/package/@tiendanube/cli)

Both `nuvemshop` and `tiendanube` run the same CLI. Examples below use `nuvemshop`; substitute `tiendanube` freely.

## Table of contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
  - [Authentication](#authentication)
  - [Theme, FTP](#theme-ftp)
  - [End-to-end example: FTP workflow](#end-to-end-example-ftp-workflow)
  - [Theme, Fork (Public API)](#theme-fork-public-api)
  - [End-to-end example: Fork workflow](#end-to-end-example-fork-workflow)
  - [Skills](#skills)
- [Agent Skills](#agent-skills)
- [OS compatibility](#os-compatibility)
- [Anonymous usage data](#anonymous-usage-data)
- [Official documentation](#official-documentation)
- [Uninstallation](#uninstallation)
- [Legal](#legal)

## Requirements

- **Node.js** 24.22.1 or newer.

## Installation

```bash
npm install -g @tiendanube/cli
```

Verify (either binary):

```bash
nuvemshop --help
nuvemshop --version
tiendanube --help
tiendanube --version
```

Run without a global install:

```bash
npx --package=@tiendanube/cli nuvemshop --help
npx --package=@tiendanube/cli tiendanube --help
```

(Use `npx @tiendanube/cli` instead of `nuvemshop` in the examples below when using `npx`.)

## Quick start

1. Create a folder for your theme and open a terminal there.
2. **Sign in** for the sync mode you need (see [CLI Official Documentation](https://nuvemshop.dev/themes/developer-tools/cli/getting-started) to choose):
   - **FTP:** run `nuvemshop auth ftp` (FTP credentials and store URL).
   - **Fork (Public API):** run `nuvemshop auth login` (sign in via the browser and paste the token).

   The credential is saved once for your user on this machine, under an alias, and the current folder is linked to it (pass `--no-link` to skip that). In another folder, run `nuvemshop auth link --alias <alias>` instead — no browser, no password; a folder that is not linked at all uses the default credential, the first one you stored. One alias can hold **both** credentials for the same store. That is useful even for a classic theme, since the theme management commands (`theme list`, `theme create`, `theme publish`, `theme delete`) exist only in the Fork family.
3. **Download the theme** (required before `push` or `watch`, so the local folder mirrors the remote state):
   - **FTP:** `tiendanube theme ftp pull`.
   - **Fork:** find the theme id with `tiendanube theme list`, then run `tiendanube theme pull --theme-id <id>`. The id is saved as the default in `.nuvem`, so later commands do not need `--theme-id` again. If you do not have a theme yet, create one first with `tiendanube theme create --base-theme "ipanema" --title "<title>"` and use the id it prints.
4. Edit files locally.
5. Push or watch your changes:
   - **FTP:** `nuvemshop theme ftp push` or `nuvemshop theme ftp watch`.
   - **Fork:** `nuvemshop theme push` or `nuvemshop theme watch`.

For a full examples, see [End-to-end example: Fork workflow](#end-to-end-example-fork-workflow) and  [End-to-end example: FTP workflow](#end-to-end-example-ftp-workflow).


## Commands

### Authentication

Credentials belong to your user on this machine, not to a folder. Each store gets an **alias**, and a theme folder's `.nuvem` only names the alias it uses, so a second folder for the same store needs no new sign-in.

| Command | Description |
|---------|-------------|
| `auth login` | Sign in to a store via the browser (or `--token` for CI) and store its Public API credential |
| `auth ftp` | Store the FTP credentials of a classic theme, tested before they are saved |
| `auth link` | Link the current folder to a stored credential |
| `auth default` | Choose the stored credential used in folders that are not linked to one |
| `auth list` | List stored credentials and check that each one still works |
| `auth remove` | Delete a stored credential |

**Picking a credential.** Every theme command accepts **`--alias <alias>`** to use a stored credential for that run, whichever folder you are in. Without it, the CLI uses, in order: `--token` (Public API commands only; nothing is read or saved), `--alias`, the `NUVEMSHOP_CLI_ALIAS` (or `TIENDANUBE_CLI_ALIAS`) environment variable, the alias the folder is linked to, a credential stored inside `.nuvem` by an older CLI version, and finally the **default credential**. The first credential you store becomes the default, and `auth default` changes it; it is used only in a folder that names no credential of its own, and it never writes a `.nuvem` there. Passing `--token` together with `--alias` is an error — pass only one; `--token` with the environment variable set is fine, and `--token` wins. When the store or the FTP server refuses a stored credential, the error names its alias and the command that signs in again.

**Where it lives.** One file per user, next to the [usage data setting](#anonymous-usage-data), written with permissions for your user only:

| OS | Location |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/tiendanube-cli/credentials.json`, or `~/.config/tiendanube-cli/credentials.json` |
| macOS | `~/.config/tiendanube-cli/credentials.json` |
| Windows | `%APPDATA%\tiendanube-cli\credentials.json` |

It holds your stores' access tokens and FTP passwords in plain text: do not share it, and do not copy it into a project. A folder set up by an older CLI version, with the credential inside `.nuvem`, keeps working; the first command you run there moves the credential into this file and leaves only the alias in `.nuvem`.

#### `auth login`

**Default:** opens your browser (macOS, Linux, or Windows). Sign in, then **paste the token** the page shows when prompted. The CLI checks the token against the Public API, stores it, and links the current folder.

**Optional:** **`--alias <alias>`** (name for the credential; by default it is derived from the store's domain, e.g. `my-store` for `my-store.lojavirtualnuvem.com.br`), **`--token <token>`** (the same string you would paste after the browser step; **skips the browser and the prompt**, typical for scripts or CI — it must be the **full** value from the page, not only the raw API access token), **`--no-link`** (store the credential without linking the current folder), **`-v`** (verbose HTTP).

Signing in again to a store that is already stored refreshes its token and keeps its alias. When an FTP-only credential has the same storefront URL, the Public API credential joins it. Nothing is saved when the token does not work. The CLI never asks about the alias or the folder: the current folder is always linked, unless you pass `--no-link`.

```bash
nuvemshop auth login --token "<token-from-authorize-page>"
```

#### `auth ftp`

**Required:** `--ftp-server`, `--ftp-username`, `--ftp-password`, `--store-url` (prompted for when missing, the password hidden)

**Optional:** `--alias <alias>` (by default derived from the store URL), `--no-link` (store the credential without linking the current folder), `-v` (verbose FTP)

```bash
nuvemshop auth ftp \
  --ftp-server ftp.nuvemshop.com.br \
  --ftp-username my_username \
  --ftp-password my_password \
  --store-url https://mystore.lojavirtualnuvem.com.br/
```

> **Tip:** Find your FTP credentials in the [FTP Workflow Official Documentation](https://nuvemshop.dev/themes/developer-tools/cli/ftp-workflow).

The connection is tested first, and nothing is saved when it fails. When a stored credential already has the same storefront URL, the FTP credentials join it, so one alias serves both the Public API and FTP commands.

#### `auth link`

**Required:** `--alias <alias>` (prompted for when missing)

**Optional:** `-v` (verbose)

Writes the alias into the folder's `.nuvem`, so both the Public API and the FTP commands work there with whatever credentials the alias holds. Each stored credential is checked first; one that no longer works, or cannot be checked, is reported as a warning with the command that renews it, and the folder is linked anyway. It never signs in and never asks for a secret. A folder that held a credential of its own stops holding it.

```bash
mkdir second-theme && cd second-theme
nuvemshop auth link --alias my-store
```

#### `auth default`

**Required:** `--alias <alias>` (prompted for when missing)

Makes that stored credential the default: the one used in any folder that is not linked to a credential and holds none of its own, when no `--alias` or environment variable is given. It never touches a folder.

```bash
nuvemshop auth default --alias my-store
```

#### `auth list`

**Optional:** `--json` (machine-readable output), `--no-verify` (do not contact the servers)

Prints a table of every stored credential: its alias, the storefront host and store id, which credentials it holds (`API`, `FTP`, or both) and whether each one still works — `ok`, `rejected` (the server refused it; the command prints how to sign in again), or `unreachable` (the server could not be asked) — and when it was last used. All checks run at once. A `>` marks the alias the current folder uses, `(default)` marks the default credential, and a line below the table says where this folder's credential comes from. In a color terminal the status is colored; piped output is plain text. Tokens and passwords are never printed, not even in `--json`.

```text
   ALIAS               STORE                                        CREDENTIALS          LAST USED
>  my-store (default)  my-store.lojavirtualnuvem.com.br #1234567    API ok, FTP ok       today
   classic-store       classic.lojavirtualnuvem.com.br              FTP rejected         3 days ago
```

#### `auth remove`

**Required:** `--alias <alias>` (prompted for when missing)

**Optional:** `--api` / `--ftp` (remove only that credential and keep the rest), `-y` (skip confirmation)

Folders linked to a removed alias stop authenticating until you run `auth login` or `auth link` there. Removing the default credential leaves no default until you choose one with `auth default`.

### Theme (FTP)

| Command | Description |
|--------|-------------|
| `theme ftp pull` | Download theme files from FTP |
| `theme ftp diff` | Show what a push would change, without uploading |
| `theme ftp push` | Upload local files to FTP |
| `theme ftp watch` | Watch files, sync to FTP, optionally reload the storefront in a browser |

Run `nuvemshop theme --help` (or `tiendanube theme --help`) to list subcommands.

Credentials come from [`auth ftp`](#auth-ftp). Every command below also accepts **`--alias <alias>`** to use another stored credential for one run.

#### `theme ftp pull` 

**Optional:** `-y` (skip overwrite confirmation), `-v` (verbose FTP)

#### `theme ftp diff`

**Optional:** `--json` (machine-readable output), `--force` (preview a forced push, which uploads every file), `-v` (verbose FTP)

Read-only: it uploads nothing. Lists the files a push would add, modify, and **delete from the remote theme**, plus files skipped for being empty (zero-byte files are never uploaded). Run it before `theme ftp push`, which is live on the published theme immediately.

It compares **file size and modification time, not content** — so an edit that leaves both unchanged is reported as unchanged, and there is no line-level diff as there is for the Fork workflow.

#### `theme ftp push`

**Optional:** `-y` (skip overwrite confirmation), `-v` (verbose FTP), `--force` (upload all files without comparing against the remote; also overrides the refusal to push a tree pulled over the Public API)

The confirmation reports how many files would be added, modified, and deleted before you answer. With `-y` the same counts are logged instead.

`--force` deliberately skips that: it means "upload everything, don't tell me what changes", so no comparison runs and the confirmation carries no counts.

#### `theme ftp watch`

**Optional:** `--no-browser` (FTP sync only, no Puppeteer), `-v` (verbose FTP)

Paths that include a **hidden segment** (a folder or file name starting with `.`, other than `.` / `..`) are **not** uploaded or watched — for example `.nuvem`, `.git`, or `foo/.bar/file`. That keeps local secrets and tooling off the server.

1. **File watcher** — The CLI watches the theme folder. When you add, change, or delete a file, it **uploads or deletes that file on the FTP server** (after a short “write finished” debounce so editors that save in multiple steps are handled more safely).
2. **Storefront tab (default)** — If you do **not** pass `--no-browser`, the CLI opens a **Chromium window** (via Puppeteer), sends you to **`admin`** so you can sign in, then navigates to the **storefront**. After each successful FTP sync, it runs a **full page reload** on that storefront tab so you see updated theme files from the server.
3. **`--no-browser`** — Only step 1 runs: FTP stays in sync; you refresh the store yourself in any browser you prefer.

So “live” feedback = **FTP sync + manual full reload of the storefront tab** (automated when the browser flow is enabled), not incremental hot patching of CSS/JS inside the page.

If you close the Puppeteer storefront tab, FTP watching continues; the CLI logs that reload was skipped until you use `--no-browser` or restart.

### End-to-end example: FTP workflow

A realistic session, from a fresh folder to start modifying the theme using FTP commands.

```bash
# 1. Create a folder and sign in with the store's FTP credentials
mkdir my-theme && cd my-theme
nuvemshop auth ftp --ftp-server "<ftp-server>" --ftp-username "<ftp-username>" --ftp-password "<ftp-password>" --store-url "<store-url>"

# 2. Pull the files locally; this is required before push/watch
nuvemshop theme ftp pull 

# 3. Start modifying
# 3.1 Iterate: edit files in your editor while watch syncs and reloads the storefront
nuvemshop theme ftp watch

# 3.2 Review before writing to the live theme — nothing is uploaded here
nuvemshop theme ftp diff

# 3.3 Push to completely update the storefront
nuvemshop theme ftp push
```

### Theme Fork (Public API)

Use these commands when syncing a **sections-based theme** via the **Public API**.

**Flow:** `auth login` → `theme list` / **`theme create`** → `theme pull` / **`theme diff`** / `theme push` / `theme watch` → **`theme preview`** for a storefront preview link → **`theme clone`** to duplicate a theme → **`theme fork`** to set **fork** (full theme paths on push) → **`theme publish`** when the theme should become **productive** (the live theme for the store). Use **`theme delete`** to remove a theme (destructive).

> [!NOTE]
> The Fork workflow (Public API) is available only for sectionable themes (e.g., **Ipanema**).

| Command | Description |
|---------|-------------|
| `theme list` | List the themes available for the current store |
| `theme pull` | Download all files from a theme |
| `theme current` | Print the default theme ID |
| `theme create` | Create a new theme (`--base-theme`, `--title`) |
| `theme clone` | Clone a theme to a new one |
| `theme delete` | Permanently delete a theme |
| `theme diff` | Show what a push would change, without uploading |
| `theme check` | Validate the files a push would send (Twig syntax, section schemas), without uploading |
| `theme push` | Upload local files to a theme |
| `theme watch` | Watch files and push changes via API in batches |
| `theme fork` | Enable fork mode (full theme paths on push) |
| `theme update` | Update a theme to a newer base-theme version, as a new draft |
| `theme preview` | Print a shareable preview URL for the theme |
| `theme performance` | Run a Lighthouse performance report on the current theme |
| `theme publish` | Make the theme live (productive) |


Credentials come from [`auth login`](#auth-login). Every command below also accepts **`--alias <alias>`** (use another stored credential for one run) and **`--token <token>`** (authenticate with a token from the authorize page for one run, reading and saving nothing).

**`.nuvem`:** the same file as FTP. It names the alias the folder uses and keeps the theme id saved by `theme pull`; it holds no credential. Do not commit it all the same — a folder last used by an older CLI version may still have one inside until a command runs there.

The same alias can hold the Public API and the FTP credentials of a store, and both command families then work from the same directory, so you can run `theme list` or `theme create` while syncing a classic theme over FTP. Each family needs only its own credential: an API command on an alias with FTP credentials alone tells you to run `auth login`.

To keep the two from mixing, the CLI records which family last pulled, and a push refuses a tree that came from the other one — uploading a sections-based theme to a classic one (or the reverse) would overwrite it with the wrong kind of files. Run the matching `pull` first, or pass `--force` to upload anyway; the confirmation says when `--force` is doing that. `watch` refuses outright, since it pushes on every save. A workspace that has never pulled — a fresh clone from git, for example — is not blocked.

#### `theme list`

**Default:** Prints the store id, then an **aligned table** (`id`, `title`, `base_theme`, `base_theme_variant`, `base_theme_version`, `base_theme_type`, `prod`, `fork`, `archived`). A `>` marks the theme linked to the current folder. Below the table, `Total` counts every theme and `Limit` shows how many themes count toward your plan's limit (archived themes don't count).

**Optional:** `--json` (full API JSON; the plan limit is `meta.max_installations`), **`-v`** (verbose HTTP). 

```bash
nuvemshop theme list --json
```

#### `theme pull`

**Required on first run:** `--theme-id` — saves as default on success; subsequent runs use the saved value automatically.

**Optional:** **`-y`** (skip publish confirmation), **`-v`** (verbose HTTP). 

```bash
nuvemshop theme pull --theme-id "1234567"
```

#### `theme current`

Print the default theme ID (saved by `theme pull`)

```bash
nuvemshop theme current
```

#### `theme create`

Create a new theme. Prints the new theme id on success.

> Currently only `ipanema` is accepted as `--base-theme`. Support for additional base themes is planned.

**Required:** `--base-theme`, `--title`  
**Optional:** **`--base-theme-variant`** (letters only, first letter uppercase, e.g. `Clothing`; when omitted, the API defaults to `Clothing`), **`--json`** (machine-readable JSON output), **`-v`** (verbose HTTP).  

```bash
nuvemshop theme create --base-theme "ipanema" --title "My New Theme" --base-theme-variant "Clothing"
```

#### `theme clone`

Creates a new theme identical to the source; prints the new theme id on success.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`--published`** (resolve the store's published theme via API), **`-y`** (skip clone confirmation), **`--json`** (machine-readable JSON output), **`-v`** (verbose HTTP). 

```bash
nuvemshop theme clone
```

#### `theme delete`

**DELETE** a theme. **Permanent** — removes from default if it pointed at this ID. It does not remove local files.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`-y`** (skip delete confirmation), **`--json`** (machine-readable JSON output), **`-v`** (verbose HTTP).  

```bash
nuvemshop theme delete
```

#### `theme diff`

Shows what a `theme push` would change — which files are **new**, which would be **updated**, and which would be **deleted** — without uploading anything. Files that push would skip (like `custom/`, or theme code on a theme that is not forked) are listed as skipped, not as changes.

**Default:** prints a summary grouped by change type, with one line per file.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`--published`** (resolve the store's published theme via API), **`--detailed`** (also show a git-style diff of what changed inside each file), **`--json`** (machine-readable JSON output; with `--detailed` each file also carries its diff as a `patch` string), **`-v`** (verbose HTTP).

```bash
nuvemshop theme diff
nuvemshop theme diff --detailed
nuvemshop theme diff --json --detailed
```

#### `theme check`

Validates the local files that `theme push` would send (the ones that differ from the remote theme) the way Nuvemshop checks them on save — Twig syntax in `.tpl` files, the JSON inside `{% schema %}` blocks, and size limits — without uploading anything. Lists each invalid file with the reason and exits with an error if any fails, so it fits CI or a pre-commit hook.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`--published`** (resolve the store's published theme via API), **`-v`** (verbose HTTP).

```bash
nuvemshop theme check
```

#### `theme push`

Upload local files to a theme. Before uploading, every file to send is validated (see `theme check`); if any is invalid, each one is listed and nothing is uploaded.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`-y`** (skip publish confirmation), **`-v`** (verbose HTTP), **`--force`** (upload all files without remote comparison, skipping unchanged detection; also overrides the refusal to push a tree pulled over FTP).

```bash
nuvemshop theme push
```

#### `theme watch`

Watch files and push changes via API. Changes are grouped: once files stop changing for a moment, everything changed since the last sync is sent together, so deleting a folder or switching branches does not send one request per file. A large sync is split into several requests sent in order; if a file is rejected (for example, deleting a file the storefront requires), the sync stops there, the error names the file, and requests already sent stay applied. If the browser is enabled, the storefront fully reloads once per sync.

Hidden path segments (`.nuvem`, `.git`, etc.) are ignored, same as FTP.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`--no-browser`** (no Chromium, no reload; API sync only), **`-v`** (verbose HTTP). 

```bash
nuvemshop theme watch
```

#### `theme fork`

Sets **fork** to true so pushes may include the full theme tree (see `theme pull` / `theme push` fork rules).

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`--published`** (resolve the store's published theme via API), **`-y`** (skip fork confirmation), **`--json`** (machine-readable JSON output), **`-v`** (verbose HTTP).  

```bash
nuvemshop theme fork
```

#### `theme update`

Updates a theme to a newer version of its base theme by creating a **new draft** — the source theme is left untouched. The CLI asks the API which versions the theme can move to (they differ per theme: an exact version for a forked theme, a major for a non-forked one), then dry-runs the update to report which local edits would be discarded before doing anything.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`--to <version>`** (target version; a forked theme takes an exact version like `2.3.1`, a non-forked one a major like `2`; omit to pick from the available versions), **`--title <title>`** (title for the new draft; defaults to `'<source> (<version>)'`), **`--dry-run`** (only report which local edits the update would discard, without creating anything), **`-y`** (skip the update confirmation), **`--json`** (machine-readable JSON output), **`-v`** (verbose HTTP).

```bash
nuvemshop theme update
nuvemshop theme update --to 2 --dry-run
nuvemshop theme update --to 2.3.1 -y
```

#### `theme preview`

Prints one line — a shareable preview URL for the theme in use. Use it before `theme publish` to review the storefront without making the theme live.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`)  

```bash
nuvemshop theme preview
```

#### `theme performance`

Runs a [Lighthouse](https://www.npmjs.com/package/lighthouse) performance audit against the storefront preview URL for the theme in use, for **both mobile and desktop**, and prints a separate report per device with the overall performance score plus the key metrics (First Contentful Paint, Speed Index, Largest Contentful Paint, Total Blocking Time, Cumulative Layout Shift, Time to Interactive). Uses the Chromium bundled with the CLI, so no extra setup is needed. The audit runs headless and can take a minute or two.

**Default:** prints a human-friendly, color-coded report for each device.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`--published`** (resolve the store's published theme via API), **`--detailed`** (also list the recommended changes from the Lighthouse report — failing opportunities/diagnostics, worst impact first, each with concrete examples of the offending URLs/elements and their per-item savings), **`--json`** (machine-readable JSON output; results are keyed by device under `results.mobile` and `results.desktop`, with a `recommendations` array — including `examples` — per device when combined with `--detailed`).

```bash
nuvemshop theme performance
nuvemshop theme performance --detailed
nuvemshop theme performance --json
```

#### `theme publish`

Publishing turns the theme **PRODUCTIVE** (live for customers; aligns with the `prod` column in `theme list`).

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`-y`** (skip publish confirmation), **`--json`** (machine-readable JSON output), **`-v`** (verbose HTTP).  

```bash
nuvemshop theme publish
```

### End-to-end example: Fork workflow

A realistic session, from a fresh folder to publishing a new theme. Replace `<id-from-output>` with the id printed by `theme create`.

```bash
# 1. Create a folder and sign in (browser flow); in later folders use `auth link`
mkdir my-theme && cd my-theme
nuvemshop auth login

# 2a. Either list existing themes and pick one
nuvemshop theme list
#     ...or create a new one from a base catalog theme
nuvemshop theme create --base-theme "ipanema" --title "Dev"

# 3. Pull the files locally; this is required before push/watch
#    and it saves the id as the default
nuvemshop theme pull --theme-id "<id-from-step-2>"

# 4. (Optional) lift push restrictions if you'll edit outside custom/, templates/, settings_data.json
nuvemshop theme fork -y

# 5. Iterate: edit files in your editor while watch syncs and reloads the storefront
nuvemshop theme watch

# 5b. (Optional) review what a push would change before uploading
nuvemshop theme diff --detailed

# 6. Share a preview link with your team
nuvemshop theme preview

# 6b. (Optional) check the theme's performance before shipping
nuvemshop theme performance

# 7. Ship it: make this theme the live one
nuvemshop theme publish -y
```

For CI or scripts, swap step 1 for `nuvemshop auth login --token "<token>"` to skip the browser entirely, or pass `--token "<token>"` to each command so nothing is stored on the runner.

### Skills

| Command | Description |
|---------|-------------|
| `skills install` | Install the bundled [Agent Skills](#agent-skills) into the coding agents on this machine |

#### `skills install`

```bash
nuvemshop skills install
```

Links every bundled skill into the skills folder of each coding agent found on
this machine, under your home directory. Because they are symlinks,
`npm update -g @tiendanube/cli` updates the skills too; re-run the command after
installing a new agent. Re-running is safe: an up-to-date link is reported as
`unchanged`, and a directory the command did not create is never replaced without
asking.

**Optional:** **`--project`** (install into the current directory instead of your
home directory), **`--agent <name...>`** (pick clients instead of detecting them),
**`--all`** (every supported client), **`--copy`** (copy the files instead of
linking, for Windows without developer mode), **`--dry-run`** (report what would
happen, change nothing), **`--json`** (machine-readable output).

**Clients:** `claude-code`, `cursor`, `codex`, `gemini-cli`, `antigravity`,
`github-copilot`, `openclaw`, `pi`, `windsurf`, `zed`, `opencode`, `goose`, `amp`,
`cline`, `warp`, `droid`, `kilo`, `roo`, `continue`, `junie`, `augment`, `trae`,
`qwen-code`, `openhands`, `kiro-cli`, `crush`. Paths and detection follow the
[Agent Skills reference implementation](https://github.com/vercel-labs/skills);
`--dry-run` lists the ones found on your machine.

For Claude, one run covers everything: Claude Code reads `~/.claude/skills` both
in a terminal and from the **Code** tab of the Claude desktop app.

The CLI points you at it twice, and never asks for anything: once after
`npm i -g`, and again at the bottom of `nuvemshop --help` — both naming the agents
it found on this machine, and both silent when it finds none.

## Agent Skills

The package ships a `skills/` folder of [Agent Skills](https://agentskills.io) —
the knowledge an AI coding agent needs to work on a Nuvemshop/Tiendanube theme
without guessing: which theme family a store's theme belongs to, which paths need
a fork and what forking costs, and how a classic theme's Twig vocabulary differs.
Install them with [`skills install`](#skills-install).

| Skill | Covers |
|---|---|
| `nuvemshop-theme-use-cases` | start here: a request mapped to the right workflow, and what is not a CLI job |
| `nuvemshop-theme-fork-workflow` | sections-based themes over the Public API, end to end |
| `nuvemshop-theme-ftp-workflow` | classic themes over FTP, where every push is production |
| `nuvemshop-fork-and-push-rules` | what a push accepts unforked, and the cost of forking |
| `nuvemshop-ipanema-architecture` | sections, blocks, JSON templates, section groups |
| `nuvemshop-ipanema-schema-reference` | the `{% schema %}` vocabulary and every setting type |
| `nuvemshop-classic-theme-architecture` | classic folder layout, `config/*.txt`, Twig traps |

The folder follows the [npm skills convention](https://github.com/antfu/skills-npm),
so a project that keeps the CLI as a dev dependency can also pick the skills up
through that ecosystem instead of running the command.

## OS compatibility

The CLI is **Node.js-based** and is intended to work on **Windows, macOS, and Linux** the same way you run any global npm binary.

## Anonymous usage data

**The CLI collects anonymous usage data by default.** It starts reporting on the first command and keeps doing so until you opt out.

**Opting out is one command:**

```bash
nuvemshop telemetry disable
```

The goal of collecting it is narrow: know which commands people actually use and which ones fail, so we fix the right things.

**What is collected**

- the command you ran, such as `theme push`
- whether it succeeded, failed, or was cancelled, and how long it took
- for failures: the error class and its stable code, for example `ThemeApiError` / `THEME_NOT_SECTIONABLE`
- the CLI, Node.js, and operating system versions, the CPU architecture, and whether the run was in CI
- a random id, generated on your machine, that identifies the installation and nothing else

**What is never collected**

- store ids, account data, or anything identifying you or your shop
- file names, file contents, or directory listings
- credentials, tokens, or FTP configuration
- command arguments, flag values, or error messages

Error messages are excluded deliberately: they can contain file paths and ids, so only the error class and code are reported.

**Managing it**

```bash
nuvemshop telemetry status     # show the current setting, id, and config file location
nuvemshop telemetry disable    # stop sending anything
nuvemshop telemetry enable     # start again
```

`tiendanube telemetry ...` does the same thing — both bins share one setting. `disable` deletes the random id, so `disable` followed by `enable` gives you a brand new one.

Environment variables override the stored setting for whatever environment they are set in:

```bash
export NUVEMSHOP_CLI_TELEMETRY_ENABLED=0     # force off, including in CI
export NUVEMSHOP_CLI_TELEMETRY_ENABLED=1     # force on, even where something else turned it off
export DO_NOT_TRACK=1                        # respected by many developer tools
```

`TIENDANUBE_` works as a prefix everywhere `NUVEMSHOP_` does, and `..._CLI_TELEMETRY_DISABLED=1` is accepted as an alias for `..._ENABLED=0`. Variables never change the stored setting — unset them and your original choice is back.

### Continuous integration

CI runs report like any other run, and by default they are treated as one-off executions rather than as people: the random id is generated per run and never written to disk, and every event is tagged so it counts as activity and never as a returning user.

To turn it off for a pipeline, set this in that environment:

```bash
NUVEMSHOP_CLI_TELEMETRY_ENABLED=0
```

**One exception**, for self-hosted runners: if the machine already has an id stored — because someone ran the CLI on it by hand — that id is reused instead of a per-run one, and its runs are tagged as a returning user like any other run from that machine. It is still marked as CI, so it can be filtered out separately. A stored opt-out is respected there too, and takes precedence over this per-run default — though `..._CLI_TELEMETRY_ENABLED=1` still overrides it, as everywhere else.

### Non-interactive runs

Nothing is ever printed about telemetry and nothing is ever asked, so scripted, piped, and `--yes` runs behave exactly like interactive ones: never blocked, and never with stdout corrupted for `| jq`.

The setting lives in one file per user, shared by the `tiendanube` and `nuvemshop` commands:

| OS | Location |
| --- | --- |
| Linux | `$XDG_CONFIG_HOME/tiendanube-cli/config.json`, or `~/.config/tiendanube-cli/config.json` |
| macOS | `~/.config/tiendanube-cli/config.json` |
| Windows | `%APPDATA%\tiendanube-cli\config.json` |

Deleting that file clears your choice, which means collection returns to being on, with a new random id.

## Official documentation

The developer portal holds the full guides for the CLI, themes, and the platform:

- **[CLI documentation](https://nuvemshop.dev/themes/developer-tools/cli/overview)** — a page per workflow, Fork (Public API) and FTP, plus theme development and theme installations.

Use the language selector in the portal to read it in Portuguese, Spanish, or English.

## Uninstallation

If you installed globally:

```bash
npm uninstall -g @tiendanube/cli
```

If you only used **`npx`**, there is nothing to remove globally; stop using the command or clear npm’s cache if you need to reclaim disk space from cached packages (`npm cache clean --force` — affects all cached packages, not only this CLI).

## Legal

Use of this package is subject to your agreements with **Nuvemshop / Tiendanube**. Distribution terms for the published artifact are defined in the `license` field of `package.json` on the registry.
