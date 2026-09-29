---
name: nuvemshop-theme-fork-workflow
description: End-to-end workflow for developing a sections-based Nuvemshop/Tiendanube theme with the CLI - authorize, pick or create a theme, pull, edit, diff, push, preview, publish. Use for any theme whose is_sectionable is true (Ipanema). For classic themes read nuvemshop-theme-ftp-workflow instead; if you are not sure which applies, read nuvemshop-theme-use-cases.
license: MIT
compatibility: Requires the Nuvemshop/Tiendanube CLI (@tiendanube/cli) on PATH
---

# The Fork (Public API) theme workflow

This workflow applies to **sections-based themes** — today that means **Ipanema**.
Classic themes sync over FTP instead (`nuvemshop-theme-ftp-workflow`) and are
built on a different vocabulary (`nuvemshop-classic-theme-architecture`) — do not
carry the tags and filters from this workflow into one.

Before you edit any file, read the **`nuvemshop-ipanema-architecture`** skill. It
explains what sections, blocks, JSON templates and section groups are, and the
folder layout it describes is exactly what `nuvemshop theme pull` writes into the
workspace. The steps below move files around; that skill is what tells you which
file to change.

## Does this theme use this workflow?

Read `is_sectionable` from the theme listing:

```bash
nuvemshop theme list --json
```

| `is_sectionable` | Base theme | Sync |
|---|---|---|
| `true` | Ipanema | this workflow — `theme pull`, `theme diff`, `theme push`… |
| `false` | any classic base theme (Amazonas, Atlántico, Style…) | `theme ftp pull`, `theme ftp push` |

Two things that trip people up:

- **The listing does not return a `theme_type` field.** That only appears in
  `theme create` and `theme clone` responses. Read `is_sectionable` (or
  `base_theme_type`, which is `"sectionable"` or `"legacy"`).
- **A store can hold both kinds at once**, so check the specific theme rather than
  assuming the store is one or the other.

## The workspace file: `.nuvem`

Every theme workspace is a directory containing a `.nuvem` file holding the store
credentials and the last pulled theme ID. It is **per-directory**, not a global
config in your home folder.

**Never read, open, decode or print `.nuvem`.** It holds the store's access
token. Confirming the file exists is fine, and `nuvemshop theme current` answers
"is this workspace configured?" without touching its contents — nothing in this
workflow needs them.

Two consequences of it being per-directory:

- Commands act on the current working directory. If one reports that the store
  configuration was not found, that directory is not authorized yet.
- `--theme-id` defaults to the last pulled theme recorded in `.nuvem`. Pass it
  explicitly whenever the target matters.

## Which binary to name

Both `nuvemshop` and `tiendanube` are installed by the same package and run the
same CLI, so either one works for every command. Which one you *name* when
suggesting a command follows the language the user is writing in:

| The user writes in | Suggest |
|---|---|
| Portuguese | `nuvemshop` |
| English | `nuvemshop` |
| Spanish | `tiendanube` |
| anything else | `nuvemshop` |

**If the user has already typed one of them, mirror their choice** and ignore the
table. They have shown you which brand they use, and that beats inferring it from
language.

## Confirmations, and why they fail in a non-interactive shell

Every command that overwrites or publishes something asks a yes/no question
first: `theme pull`, `theme push`, `theme clone`, `theme fork`, `theme unfork`,
`theme update`, `theme delete`, `theme publish`.

There is no TTY behind a tool call, and `CI` counts as non-interactive too, so in
that setting the command does not ask — it **aborts** with:

> Destructive operation requires confirmation. Re-run with --yes in
> non-interactive mode.

That is the CLI protecting the store, not a bug to route around. The sequence is:
tell the user exactly what the command will change, get their explicit yes, and
only then re-run it with `-y`. Never add `-y` on your own initiative to get past
the abort, and never add it to a command the user has not agreed to.

## Step 1 — Authorize, in the user's terminal (one time per workspace)

Ask the user to run:

```bash
nuvemshop theme authorize
```

It opens a browser, they sign in, and the CLI writes the credentials into
`.nuvem` itself. Nothing comes back to you, and nothing should: a token pasted
into the conversation would be stored in the transcript, so the whole exchange
stays between the user, their browser and their terminal.

Never ask the user for a token, and never offer to store one for them. (There is
a `--token` flag for CI, but it is theirs to use, not yours to request.) If a
command reports the workspace is not authorized, relay that and point them at the
command above.

## Step 2 — Pick a theme, or create one

```bash
nuvemshop theme list
```

To start from the base catalog instead:

```bash
nuvemshop theme create --base-theme ipanema --title "My theme"
```

Two separate rules apply to `--base-theme`, and they fail in different places:

- **Shape — the CLI's validator.** The code must be lowercase letters, digits,
  hyphens or underscores, so `Ipanema` is rejected for its capital `I` before any
  request goes out. The validator accepts *any* well-formed lowercase slug; it
  knows nothing about which themes exist.
- **Existence — the platform catalog, enforced by the API.** Today `ipanema` is
  the only sections-based base theme on offer, so a well-formed but unknown code
  passes the validator and then fails at the API.

If a value is rejected, read which of the two rejected it: a casing complaint is
the validator, an unknown-theme complaint is the catalog.

```bash
nuvemshop theme clone --published --title "Work in progress"
```

`theme clone` copies an existing theme, which is the safe way to experiment
against a live store: clone, edit the clone, publish only when it is ready.
`--published` picks the live theme without needing its id. Before you publish that
clone, read "Before publishing a clone" under Step 6 — the merchant may have kept
editing the live theme while you worked.

**This is a Public API strategy only.** Classic themes have no equivalent — FTP
resolves to the published theme, so there is no copy to work on and editing
production is unavoidable. Do not carry "clone it first" into an FTP workspace,
and never publish a theme in order to manufacture a copy: see the
`nuvemshop-theme-ftp-workflow` skill for what protects that workflow instead.

### Installation slots

A store holds a limited number of themes, and that number differs between stores —
so read it rather than assume it. `nuvemshop theme list --json` returns
**`meta.max_installations`** alongside the `themes` array; comparing the two tells
you whether there is room before you promise a clone.

`theme create`, `theme clone`, `theme unfork` and `theme update` each add one, so
each can be **refused because the store is full** — that is a state to resolve,
not an error to retry. Show the user what is installed and agree with them which
non-productive theme to remove. Removing it is `nuvemshop theme delete
--theme-id <id>`; never choose which theme to delete on the user's behalf.

## Step 3 — Pull before anything else

```bash
nuvemshop theme pull --theme-id <id>
```

This downloads the theme's files into the current directory and records it as the
workspace default. **Pull overwrites local files**, so make sure any local work is
committed or backed up first. `theme push` and `theme diff` both expect a pulled
workspace.

### Take a baseline, if the change could affect loading

If the work involves an image, a script, a stylesheet, a font, or a section coming
or going, measure before you edit:

```bash
nuvemshop theme performance --theme-id <id> --device mobile --detailed
```

Measure **the theme you are about to change** — if you cloned, that is the clone,
not the original. Measuring one and then the other compares two installations
rather than a before and an after.

Keep the numbers: nothing stores them, and after the push the previous state of
the files is gone. Skip this for copy, colour or translation changes. The full
flow, the threshold that counts as a real change, and when to stop are in the
`nuvemshop-theme-use-cases` skill under "Measuring what a change cost".

## Step 4 — Edit, then review before uploading

Edit files locally, then:

```bash
nuvemshop theme diff --detailed
```

`theme diff` is read-only — it uploads nothing and reports exactly what a push
would change. Always diff before pushing so you can tell the user what is about
to change.

Whether a given file can be pushed at all depends on whether the theme is forked.
Read the **`nuvemshop-fork-and-push-rules`** skill before pushing anything under
`sections/`, `blocks/`, `snippets/`, or `layouts/`.

## Step 5 — Push

```bash
nuvemshop theme push --theme-id <id>
```

This changes what the theme renders, so it asks for confirmation first (see
"Confirmations" above).

Read its output rather than its exit code. It prints the plan and then the
result — `created`, `updated`, `deleted`, `unchanged` — plus a line per file, and
for a non-forked theme a `Skipped (not forked, but has changes)` entry for every
code file it left alone. A push that skipped everything you edited still finishes
successfully; the skipped list is the only place that says so.

`--force` uploads every file without comparing against the remote first. It makes
the push slower and the report less informative, so use it only when the remote
comparison is what you are trying to bypass.

## Step 6 — Preview, then publish

```bash
nuvemshop theme preview --theme-id <id>
```

That returns a shareable URL that does not affect the live storefront — use it to
let the user check the result.

If you took a baseline in Step 3, measure again here, on the same theme with the
same device, and show both numbers before proposing the publish:

```bash
nuvemshop theme performance --theme-id <id> --device mobile --detailed
```

This is the one moment on this family where a regression can still be caught for
free: nothing has reached shoppers yet, so "do not publish" is a complete fix.
Call a drop real at 5 points or more, name the likely cause from the failing
audits, and ask the user what they want to do — a slower page can be the right
trade, and that is their call.

Then stop. **Do not run the audit again** hoping for a kinder number, and do not
start fixing on your own initiative: one measurement each side is the whole
budget, and the loop of patch-and-re-measure is what makes this expensive instead
of useful. `nuvemshop-theme-use-cases` has the full flow.

### Before publishing a clone

A clone is a snapshot. While you work on it, the merchant can keep editing the
**live** theme in the customizer / Brand Editor, and those edits stay on the theme
they were made on. Publishing the clone swaps the live theme for your snapshot and
**discards them**. Two things keep that from happening:

- **Align `config/settings_data.json` with the live theme before you publish.**
  That file holds the merchant's saved setting values. It is store-runtime data
  rather than theme code, so it can be pushed without a fork — see
  `nuvemshop-fork-and-push-rules`.
- **Agree with the merchant not to edit in the customizer while the work is in
  flight.** Anything they change there after you take the clone is work somebody
  has to reconcile by hand, so settle this when the clone is made, not at publish
  time.

```bash
nuvemshop theme publish --theme-id <id>
```

That makes the theme live for shoppers. It asks for confirmation, and it takes the
theme id explicitly rather than defaulting to a guess.

It has one side effect that is easy to miss: FTP access belongs to whichever theme
is published, so publishing a different one cuts off anybody working over FTP on
the theme that was published before. They will need fresh FTP credentials from the
admin panel and a re-run of `nuvemshop theme ftp setup`. Mention it if the store
has a classic theme in play.

## Commands that do not belong in a tool call

- **`nuvemshop theme watch`** — a file watcher with live storefront reload. It
  never returns on its own ("Press Ctrl+C to stop"), so running it from a tool
  call hangs the call rather than doing anything useful. When a user wants an
  auto-syncing dev loop, tell them to run it in a terminal alongside the session.
  Same for `nuvemshop theme ftp watch`.
- **`nuvemshop theme authorize` and `nuvemshop theme ftp setup`** — the two
  commands that establish credentials. Both prompt for secrets, and a token or
  password that passes through the conversation ends up in the transcript. Leave
  them in the user's terminal.
- The deprecated `theme installation *` command group; use the flat commands.

## When authentication fails

Tell the user to verify their credentials and re-run `nuvemshop theme authorize`
in their terminal — or `nuvemshop theme ftp setup` if the failure came from an FTP
command. Then stop: **do not retry the call**, because a retry loop on bad
credentials burns time and hides the cause.

Never try to diagnose or repair credentials by inspecting or editing `.nuvem`.

## Reading errors

The CLI's error messages are written for humans and usually name the next action
verbatim — for example that a workspace needs `theme authorize` first, or that a
file was skipped because the theme is not forked. Pass them on to the user rather
than paraphrasing, and follow the action they name.

The binary name inside an error is whichever one was invoked, so it matches the
command you ran. When you turn an error into a suggestion of your own, still pick
the name with the rule in "Which binary to name" above.
