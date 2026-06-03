# @tiendanube/cli

An Official CLI to automate theme development and interact with **Nuvemshop / Tiendanube** backend.

[![npm version](https://img.shields.io/npm/v/@tiendanube/cli.svg)](https://www.npmjs.com/package/@tiendanube/cli)

Both `nuvemshop` and `tiendanube` run the same CLI. Examples below use `nuvemshop`; substitute `tiendanube` freely.

## Table of contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Commands](#commands)
  - [Theme, FTP](#theme-ftp)
  - [End-to-end example: FTP workflow](#end-to-end-example-ftp-workflow)
  - [Theme, Fork (Public API)](#theme-fork-public-api)
  - [End-to-end example: Fork workflow](#end-to-end-example-fork-workflow)
- [OS compatibility](#os-compatibility)
- [Official documentation](#official-documentation)
- [Uninstallation](#uninstallation)
- [Legal](#legal)

## Requirements

- **Node.js** 24.15 or newer.

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
2. **Pick a sync mode** (see [CLI Official Documentation](https://dev.nuvemshop.com.br/docs/developer-tools/cli/getting-started) to choose):
   - **FTP:** run `nuvemshop theme ftp setup` (FTP credentials and store URL).
   - **Fork (Public API):** run `nuvemshop theme authorize` (sign in via the browser and paste the token).
3. **Download the theme** (required before `push` or `watch`, so the local folder mirrors the remote state):
   - **FTP:** `tiendanube theme ftp pull`.
   - **Fork:** find the theme id with `tiendanube theme list`, then run `tiendanube theme pull --theme-id <id>`. The id is saved as the default in `.nuvem`, so later commands do not need `--theme-id` again. If you do not have a theme yet, create one first with `tiendanube theme create --base-theme "ipanema" --title "<title>"` and use the id it prints.
4. Edit files locally.
5. Push or watch your changes:
   - **FTP:** `nuvemshop theme ftp push` or `nuvemshop theme ftp watch`.
   - **Fork:** `nuvemshop theme push` or `nuvemshop theme watch`.

For a full examples, see [End-to-end example: Fork workflow](#end-to-end-example-fork-workflow) and  [End-to-end example: FTP workflow](#end-to-end-example-ftp-workflow).


## Commands

### Theme (FTP)

| Command | Description |
|--------|-------------|
| `theme ftp setup` | Configure FTP and store URL |
| `theme ftp pull` | Download theme files from FTP |
| `theme ftp push` | Upload local files to FTP |
| `theme ftp watch` | Watch files, sync to FTP, optionally reload the storefront in a browser |

Run `nuvemshop theme --help` (or `tiendanube theme --help`) to list subcommands.

#### `theme ftp setup`

**Required:** `--ftp-server`, `--ftp-username`, `--ftp-password`, `--store-url`

**Optional:** `-y` (skip non-empty directory warning), `-v` (verbose FTP)

```bash
nuvemshop theme ftp setup \
  --ftp-server ftp.nuvemshop.com.br \
  --ftp-username my_username \
  --ftp-password my_password \
  --store-url https://mystore.lojavirtualnuvem.com.br/
```

> **Tip:** Find your FTP credentials in the [FTP Workflow Official Documentation](https://dev.nuvemshop.com.br/docs/developer-tools/cli/ftp-workflow).

`theme ftp setup` writes **`.nuvem`** with FTP settings and your store URL. It is **obfuscated, not encrypted**.

Do not commit or share it. Add `.nuvem` to `.gitignore`.

#### `theme ftp pull` 

**Optional:** `-y` (skip overwrite confirmation), `-v` (verbose FTP)

#### `theme ftp push`

**Optional:** `-y` (skip overwrite confirmation), `-v` (verbose FTP), `--force` (skip remote comparison and upload all files)

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
# 1. Create a folder and ftp setup the CLI
mkdir my-theme && cd my-theme
nuvemshop theme ftp setup --ftp-server "<ftp-server>" --ftp-username "<ftp-username>" --ftp-password "<ftp-password>" --store-url "<store-url>"

# 2. Pull the files locally; this is required before push/watch
nuvemshop theme ftp pull 

# 3. Start modifying
# 3.1 Iterate: edit files in your editor while watch syncs and reloads the storefront
nuvemshop theme ftp watch

# 3.2 Edit files and run push to completely update the storefront
nuvemshop theme ftp push
```

### Theme Fork (Public API)

Use these commands when syncing a **sections-based theme** via the **Public API**.

**Flow:** `theme authorize` → `theme list` / **`theme create`** → `theme pull` / `theme push` / `theme watch` → **`theme preview`** for a storefront preview link → **`theme clone`** to duplicate a theme → **`theme fork`** to set **fork** (full theme paths on push) → **`theme publish`** when the theme should become **productive** (the live theme for the store). Use **`theme delete`** to remove a theme (destructive).

> [!NOTE]
> The Fork workflow (Public API) is available only for sectionable themes (e.g., **Ipanema**).

| Command | Description |
|---------|-------------|
| `theme authorize` | Authorize the CLI via browser or `--token` for CI |
| `theme list` | List the themes available for the current store |
| `theme pull` | Download all files from a theme |
| `theme current` | Print the default theme ID |
| `theme create` | Create a new theme (`--base-theme`, `--title`) |
| `theme clone` | Clone a theme to a new one |
| `theme delete` | Permanently delete a theme |
| `theme push` | Upload local files to a theme |
| `theme watch` | Watch files and push via API on each change |
| `theme fork` | Enable fork mode (full theme paths on push) |
| `theme preview` | Print a shareable preview URL for the theme |
| `theme publish` | Make the theme live (productive) |


**`.nuvem`:** Same file as FTP, **it's obfuscated, not encrypted**. It can hold either FTP config or API config, or both blocks merged if you switch modes. Do not commit it.

#### `theme authorize`

**Default:** opens your default browser (macOS, Linux, or Windows). Sign in, then **paste the token** the page shows when prompted. The CLI saves the configuration locally.

**Optional:** **`--token <token>`** — same string you would paste after the browser step; **skips the browser and the prompt** (typical for scripts or CI). **`--token`** must be the **full** value from the page (JSON with `store_id` and `access_token`, Base64-encoded), not only the raw API access token.

**Optional:** **`-y`** (skip non-empty directory warning), **`-v`** (verbose HTTP).

If verification fails, you’ll see an error after the file is written — fix the token or API settings and run again.

```bash
nuvemshop theme authorize --token "<token-from-authorize-page>" -y
```

#### `theme list`

**Default:** Prints an **aligned table** (`id`, `store_id`, `title`, `base_theme`, `version`, `base_theme_type`, `prod`, `fork`).

**Optional:** `--json` (full API JSON), **`-v`** (verbose HTTP). 

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
**Optional:** **`--json`** (machine-readable JSON output), **`-v`** (verbose HTTP).  

```bash
nuvemshop theme create --base-theme "ipanema" --title "My New Theme"
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

#### `theme push`

Upload local files to a theme.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`), **`-y`** (skip publish confirmation), **`-v`** (verbose HTTP), **`--force`** (upload all files without remote comparison, skipping unchanged detection).

```bash
nuvemshop theme push
```

#### `theme watch`

Watch files and push via API on each file change. If browser enabled, full-reload page.

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

#### `theme preview`

Prints one line — a shareable preview URL for the theme in use. Use it before `theme publish` to review the storefront without making the theme live.

**Optional:** `--theme-id` (defaults to the id saved by `theme pull`)  

```bash
nuvemshop theme preview
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
# 1. Create a folder and authorize the CLI (browser flow)
mkdir my-theme && cd my-theme
nuvemshop theme authorize

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

# 6. Share a preview link with your team
nuvemshop theme preview

# 7. Ship it: make this theme the live one
nuvemshop theme publish -y
```

For CI or scripts, swap step 1 for `nuvemshop theme authorize --token "<token>"` to skip the browser entirely.

## OS compatibility

The CLI is **Node.js-based** and is intended to work on **Windows, macOS, and Linux** the same way you run any global npm binary.

## Official documentation

For guides on stores, themes, FTP, and the platform (language and region may vary):

- **Nuvemshop / Tiendanube:** [CLI DevHub Documentation](https://dev.nuvemshop.com.br/docs/developer-tools/cli)

Search those sites for **FTP**, **tema**, or **theme** to reach the articles that match your storefront product.

## Uninstallation

If you installed globally:

```bash
npm uninstall -g @tiendanube/cli
```

If you only used **`npx`**, there is nothing to remove globally; stop using the command or clear npm’s cache if you need to reclaim disk space from cached packages (`npm cache clean --force` — affects all cached packages, not only this CLI).

## Legal

Use of this package is subject to your agreements with **Nuvemshop / Tiendanube**. Distribution terms for the published artifact are defined in the `license` field of `package.json` on the registry.
