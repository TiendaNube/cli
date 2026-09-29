---
name: nuvemshop-theme-use-cases
description: Start here for Nuvemshop/Tiendanube theme work. Maps a real request ("I want to change my store's theme") to the right workflow, the right commands, and what to tell the user first. Covers both theme families, how to measure what a change cost, what has no path at all, and what is not a CLI job.
license: MIT
compatibility: Requires the Nuvemshop/Tiendanube CLI (@tiendanube/cli) on PATH
---

# Use cases: from the request to the right move

The other skills explain how each workflow works. This one is for the moment
before that: someone asked for a change and you do not yet know which workflow
applies.

Work through the three questions below before proposing anything. Most wrong turns
here come from skipping them — the two theme families have different capabilities,
different risks, and one of them edits production by construction.

## Step 0 — the three questions

**1. Which theme?** Run `nuvemshop theme list`. The store may hold several. Unless
the user named one, the theme that matters is the **published** one, because that
is what shoppers see and the only one FTP can reach.

**2. Which family?** Read `is_sectionable` on *that theme*
(`nuvemshop theme list --json`):

| `is_sectionable` | Family | Sync | Skill |
|---|---|---|---|
| `true` | sections-based (Ipanema) | Public API | `nuvemshop-theme-fork-workflow` |
| `false` | classic / legacy (Amazonas, Atlántico, Style…) | FTP | `nuvemshop-theme-ftp-workflow` + `nuvemshop-classic-theme-architecture` |

A store can hold both kinds. Decide per theme, never per store.

**3. What kind of change?** This decides the artifact, and sometimes decides that
there is nothing to push at all:

| The user wants | It lives in | Route |
|---|---|---|
| a colour, font, or a text they can see a field for | theme settings | the merchant's own editor — see "Not a CLI job" |
| a section moved, added or removed on a page | `templates/*.json` (Ipanema) | push, no fork needed |
| new markup or behaviour in a component | section/block/snippet code | needs a fork — state the cost first |
| anything at all on a classic theme | `.tpl` files over FTP | production, directly |
| a product, price, page or order changed | the store's catalog | not theme work |
| the store to feel faster, or "is this slower now?" | whatever the change touched | measure it — see "Measuring what a change cost" |
| a newer version of the base theme | the theme's version, not its files | `theme update` — sections-based only |

State which of these you concluded, and why, before running anything that writes.
If the request is ambiguous between a settings change and a code change, ask — the
two have very different costs.

## Not a CLI job

Recognising these saves the user from a deploy they did not need:

- **A value the merchant can already change.** If the theme exposes the setting,
  the merchant changes it in the admin theme editor and it is live immediately,
  with no clone, no push and no risk. Hand-editing
  `config/settings_data.json` to do the same thing is slower and can be
  overwritten by the merchant's next click.
- **Loose CSS or JavaScript.** The admin has a field for custom CSS. Reaching for
  a theme file for a few rules means the change now belongs to the theme's release
  cycle instead of to the merchant.
- **Catalog and content.** Products, prices, categories, pages, orders and
  customers are not in the theme. A theme change cannot fix "the price is wrong".
- **A different theme entirely.** Choosing or installing another theme from the
  catalog happens in the admin, not here.

Say so plainly when it applies, and offer the CLI path only if the user still wants
the change in code.

## Sections-based (Ipanema) themes

### Change what a page shows, on a live store

The common request, and the one with a safe path.

1. `nuvemshop theme clone --published` — copies the live theme (no id needed) so
   the work happens off the storefront.
2. `nuvemshop theme pull --theme-id <clone id>`, edit `templates/*.json` and
   `config/settings_data.json`, then `nuvemshop theme diff --detailed` and
   `nuvemshop theme push --theme-id <clone id>`.
3. `nuvemshop theme preview --theme-id <clone id>` and let the user look.
4. Align `config/settings_data.json` with the live theme, then
   `nuvemshop theme publish --theme-id <clone id>`.

Step 4 is not a formality. The merchant may have kept editing the live theme in
their editor while you worked on the copy, and publishing the clone would discard
that. Ask them to hold off while the work is in flight, and re-check before
publishing.

Check there is room before promising the clone. `nuvemshop theme list --json`
returns `meta.max_installations` — how many themes the store may hold — next to
the `themes` array, so compare the two rather than finding out from a refusal. If
it is full, show the user what is installed and agree which non-productive theme
to remove; the choice is theirs, and `nuvemshop theme delete --theme-id <id>` is
how it goes.

### Change component code

Editing anything under `sections/`, `blocks/`, `snippets/`, `layouts/`, `static/`,
or a schema or translation file requires `nuvemshop theme fork` first.

**Forking is permanent and it has a price: the theme stops receiving base-theme
updates from the platform.** Every future improvement and fix has to be applied by
hand. Say that, in those terms, and get an explicit yes before forking. If the user
only needs a value changed, they may not need any of this — check Step 0 again.

See `nuvemshop-fork-and-push-rules` for exactly which paths fall on which side,
and `nuvemshop-ipanema-architecture` for what sections, blocks and JSON templates
are.

### Build a new theme

`nuvemshop theme create --base-theme ipanema --title "…"` starts one from the base
catalog, then pull, edit, preview, publish. This is sections-based only — the CLI
cannot create a classic theme.

### "Update my theme to the newer version"

The base theme ships new versions. Moving onto one does not change the theme in
place: it creates a **new draft** at that version, leaves the source untouched,
and in the draft any file whose local edits conflict takes the new version's
content instead. So the question to settle with the user is which local work they
are willing to lose.

1. `nuvemshop theme update --dry-run` — reports which local edits the update would
   discard, and changes nothing. Omit `--to` and it asks which version to move to,
   listing the ones the API says this theme can reach; in a non-interactive shell
   it instead fails naming them (`A target version is required (--to).
   Available: …`), which is another way to read the list.
2. **Read the discard list to the user before proposing anything.** If it is
   empty, say so; that is the easy case and it deserves to be named.
3. `nuvemshop theme update --to <version> -y` once they agree. Check there is room
   first — it consumes an installation slot.
4. `nuvemshop theme pull` the new draft, then preview and publish it like any
   other theme.

The shape of `--to` depends on the fork state: a forked theme takes an exact
version such as `2.3.1`, a non-forked one a major such as `2`. Take the values
from the prompt or the error rather than constructing them.

**Sections-based only.** A theme's base version is a Public API concept; classic
themes have no CLI path onto a newer base version. On a classic theme, do not
reach for this command to find out — say that base-theme version updates do not
exist in that family. Reporting "your theme is already on the latest version" to
someone on a classic theme would be wrong twice over: it implies the concept
applies and that they are fine.

### "It looks fine but it is slow"

`nuvemshop theme performance` runs a Lighthouse audit and reports a score out of
100 plus the six loading metrics. It measures the **remote** theme through its
preview URL, so push before you measure or you will be auditing the previous
version.

With `--detailed` it also lists the audits that failed, each with an estimated
saving. That list is what turns "the score is 71" into something a person can act
on, so ask for it whenever the answer is meant to lead somewhere.

### "That publish broke something, put it back"

The theme that was published before is still there — publishing demotes a theme, it
does not delete it. So `nuvemshop theme list`, find it, and
`nuvemshop theme publish --theme-id <old id>` again.

This is the only real undo in the product, and it only exists on this family. Do
not promise it anywhere else.

## Classic (legacy) themes

### Change a live classic theme

There is no copy to work on: FTP resolves to the published theme, so every change
lands in production. That is the workflow, not a mistake to route around.

**Before asking the user to open FTP, tell them what it costs.** Opening FTP
freezes that theme: from then on it stops receiving the platform's automatic fixes
and improvements, and each one has to be applied by hand. It is a one-way decision
of the same weight as forking. If the theme already has FTP open, that cost is
already paid and there is nothing to decide.

Then:

1. The user opens FTP in the store admin, under Design → code editor, and runs
   `nuvemshop theme ftp setup` in their terminal. Credentials never come to you.
2. `nuvemshop theme ftp pull`, then **commit the result to version control before
   editing anything**. This is the only thing that will let you undo a mistake —
   see below.
3. Edit, tell the user what changed and what you deleted, then
   `nuvemshop theme ftp push`. Its confirmation already carries the add, modify
   and delete counts. Save `nuvemshop theme ftp diff` for a large batch: it walks
   the whole remote tree, and the push walks it again.

Step 2 is doing double duty: it is the rollback *and* the only content-level
change set anyone can read.

Read `nuvemshop-classic-theme-architecture` before touching a file: the folder is
`snipplets/` with an L, the translation filter is `translate`, and the settings
live in `config/*.txt`. The sections-based spellings silently render nothing here.

### "I broke the live store"

Be honest quickly. **The platform keeps no backup, no version history and no undo
for classic themes.** A push overwrites, and it deletes remote files that are
missing locally.

What can be done, in order:

1. If the workspace is in version control, check out the last good commit and push
   that. This is why step 2 above matters.
2. If there is a local copy from before the change, push that.
3. If neither exists, the previous file contents are gone. Say that rather than
   implying a recovery exists.

### "I want to work on a classic theme that is not the live one"

These commands cannot reach it — FTP has no theme id and resolves to the published
theme. Publishing the other theme would technically expose it, but that changes
the storefront and cuts FTP access on the theme that was published before, so it
is a much larger change than the one being asked for. Say the limitation.

## Both families

### The workspace has API and FTP credentials

That is supported: one directory can list themes over the API and sync a classic
theme over FTP. Nothing in the CLI stops you from pushing a tree that was pulled
by the other family, though, and the two file layouts are not interchangeable — so
keep one directory per theme unless you have a reason not to, and pull with the
family you intend to push with.

### Someone else changed the theme

On a sections-based theme, run `nuvemshop theme diff --detailed` before any push.
If it reports changes you did not make, the remote moved: another developer, or
the merchant's own editor. Show the user before overwriting anything. On a classic
theme, one `nuvemshop theme ftp diff` before the push answers the same question at
file level — a file listed as modified that you did not touch means the remote
moved. It is slow, so run it when there is reason to suspect this, not by habit.

### A fresh machine, or a directory that is not set up yet

`nuvemshop theme current` answers "is this workspace configured?" without touching
credentials. If it is not, the user runs `nuvemshop theme authorize` (Public API)
or `nuvemshop theme ftp setup` (FTP) in their own terminal — leave both with them,
because a token or password that passes through the conversation ends up in the
transcript.

### Translations

On a classic theme, `config/translations.txt`, keyed by the Spanish string, pushed
over FTP like any other file. On Ipanema, the files under `translations/` are theme
code, so changing them requires a fork with the cost that carries.

### Checkout styling, classic themes

`static/css/checkout.scss.tpl`, and it has to stay at exactly that path. It styles
checkout, so it is the most sensitive file in the theme — tell the user what will
change before pushing it.

## Measuring what a change cost

A change that makes the storefront slower is easy to ship and hard to notice. So
for changes that plausibly affect loading, measure once before and once after, and
put both numbers in front of the user.

**When to measure.** Only when the change could move the needle: an image added or
replaced, a script, a stylesheet, a font, a section or component entering or
leaving. Editing copy, a colour or a translation does not need it — spending a
minute measuring a word change is how a useful habit turns into a tax.

**How to measure, both sides the same way.**

```bash
nuvemshop theme performance --theme-id <id> --device mobile --detailed
```

Mobile alone takes about half the time of the default, and the detail costs
nothing extra — it is the same audit, just a fuller report. Use the same device on
both sides or the comparison is meaningless.

The two families measure different things, and it matters:

| | Sections-based | Classic |
|---|---|---|
| Before | the theme as it stands, after pulling | the published theme (`--published`) |
| After | the clone's preview, **before publishing** | the published theme, **already live** |
| If it got worse | do not publish; nothing reached shoppers | it is already out there |

On a classic theme the "after" is the storefront, because an FTP push is
production. There is no version of this flow that catches a regression before
shoppers do — say that when you propose it, and note that undoing it means pushing
the previous commit, which only exists if it was made before editing.

Measuring a classic theme also needs Public API credentials in the same workspace,
because the audit resolves the store URL from the API config; FTP credentials
alone are not enough. If they are missing, say that `nuvemshop theme authorize`
would add them and unlock the measurement, and offer to carry on without it. It is
a useful extra, not a prerequisite for fixing a header.

### Reading the result, and knowing when to stop

Report both scores every time, even when nothing moved — "unchanged" is a useful
answer. Call it a real change at **5 points or more**; below that, give the numbers
without a verdict.

If it dropped by 5 or more:

1. Name the likely cause from the failing audits in the detailed report, comparing
   which ones are new rather than reading the score alone.
2. If there is an obvious fix, describe it and **ask whether to apply it**.
3. If there is not, **offer to revert** and ask. On a sections-based theme that
   means not publishing, or republishing the previous theme. On a classic theme it
   means pushing the previous commit.

**Then stop.** One measurement before, one after, and the decision goes to the
user. A worse score is a result, not a failed measurement: do not run the audit
again hoping for a different number, and do not start fixing and re-measuring on
your own initiative — that loop burns minutes and hides the change that caused it.
Measure a third time only if the user asks after seeing the numbers.

And a slower store is not automatically the wrong trade. A section that costs 6
points may be exactly what the merchant wanted. Whether the cost is acceptable is
theirs to judge, so present it as a trade rather than a defect to be corrected.

## What does not exist

Do not offer these, and do not imply them:

- **Backup, restore, revert or version history**, for either family. The
  substitutes are: a clone plus `theme publish` on the older theme (Ipanema only),
  and your own version control (classic).
- **Reaching a non-published theme over FTP.**
- **Creating a classic theme through the CLI.**
- **A content diff for FTP.** `theme ftp diff` compares size and modification
  time only; the pull-and-commit is the substitute for seeing what changed inside
  a file.
- **Undoing a fork.** `nuvemshop theme unfork` creates a *new* theme that keeps
  templates and settings but drops the forked code; it does not restore the
  original's history.
- **Pushing `custom/` over the Public API.** This CLI skips that folder, so a
  change there will not reach the store no matter what the fork state is.
- **A performance history.** Nothing stores past audits. If nobody measured before
  the change, there is no "before" to compare against, and none can be recovered —
  on a classic theme the previous version of the files is gone once pushed.

When a user asks for one of these, say it is not available and offer the nearest
thing that is. An invented workaround here costs someone their storefront.
