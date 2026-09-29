---
name: nuvemshop-theme-ftp-workflow
description: Workflow for classic (non-sectionable) Nuvemshop/Tiendanube themes over FTP - how to tell which themes need it, pull, edit, push, and what to do when credentials fail. Use for any theme whose is_sectionable is false; every push here lands on the live storefront, so read this before proposing one.
license: MIT
compatibility: Requires the Nuvemshop/Tiendanube CLI (@tiendanube/cli) on PATH
---

# The FTP theme workflow

This is the workflow for **classic themes** — anything that is not a sections-based
theme. It syncs over FTP rather than the Public API, and it is a different world
from the Fork workflow: no fork, and no theme IDs — because there is no theme to
choose.

This skill covers **moving files**. For what is inside them — the folder layout,
Twig, `config/*.txt`, and the spellings that differ from sectionable themes
(`snipplets/` with an L, `translate` rather than `t`) — read the
`nuvemshop-classic-theme-architecture` skill before editing anything.

One capability this family does not have: **moving to a newer base-theme
version.** `nuvemshop theme update` belongs to the Public API side, where a
theme's version is a thing the platform tracks. Classic themes have no CLI path
onto a newer base version at all. Say that plainly rather than improvising one,
and do not report anything as "already up to date" here — the concept does not
apply, which is a different answer from good news.

## Which workflow does a theme need?

Read `is_sectionable` from the theme listing (that is a Public API call, so it
needs `theme authorize` in the workspace):

```bash
nuvemshop theme list --json
```

| `is_sectionable` | Base theme | Sync |
|---|---|---|
| `true` | Ipanema | the Public API — `theme pull`, `theme diff`, `theme push`… |
| `false` | any classic base theme (Amazonas, Atlántico, Style…) | FTP — `theme ftp pull`, `theme ftp push` |

Two things that trip people up:

- **The listing does not return a `theme_type` field.** That only appears in
  `theme create` and `theme clone` responses. Read `is_sectionable` (or
  `base_theme_type`, which is `"sectionable"` or `"legacy"`).
- **A store can hold both kinds at once**, so check the specific theme rather than
  assuming the store is one or the other.

Reaching for the wrong family gives a clear error: the CLI says which credentials
the workspace is missing and names the command that adds them.

## What these commands target

FTP has no theme id, and that is not a convenience — there is nothing to pass. The
FTP credentials themselves identify one theme: **the theme currently published in
the store**. These commands cannot be pointed at any other theme.

Three things follow, and all three matter before you push:

- **A push is live the moment it finishes.** There is no draft to review and no
  preview URL, and nothing shows what changed inside a file. That makes
  `theme ftp push` the least reversible command in the CLI. Say so plainly when
  proposing one.
- **A classic theme that is not published cannot be synced with these commands at
  all.** There is no way to reach it. Say that plainly rather than proposing a way
  around it — publishing it would technically expose it over FTP, but it would
  also change the live storefront and cut off the theme published before, so it is
  not a workaround, it is a bigger change than the one being asked for.
- **If the published theme changes, the connection dies.** See
  "When the store's published theme changes" below.

## Working in production is the normal case here

The Fork workflow tells you to clone a theme and work on the copy, publishing only
when it is ready. **That advice does not transfer to FTP, and trying to apply it
will make things worse.** There is no copy to work on: the credentials resolve to
the published theme, so every FTP edit lands in production by construction.

**Do not publish another theme in order to get a working copy.** It is not a safety
measure — it changes what shoppers see, and it closes the FTP access for the theme
that was published before, which is the very thing you were trying to protect. If
the user wants a classic theme that is not published, the honest answer is that
these commands cannot reach it, not a workaround.

What replaces the safe copy is your own version control, plus review before the
push rather than after:

1. Pull, commit that pull, and only then edit. The commit is the only rollback
   and the only content-level change set this family has.
2. One push per coherent set of changes, not one per edit.
3. Tell the user which files you changed and which you deleted locally — your
   version control already knows — before the push runs. A push removes anything
   on the remote that is missing locally, and nothing will ask about it file by
   file. For a large batch, see "Before a large batch: `theme ftp diff`" below.

`nuvemshop theme ftp watch` is the deliberate exception: it uploads on every save.
It is the opposite trade from everything above, so do not reach for it thinking it
is the safer option — it is the least reviewed way to write to a live storefront.

## Opening FTP freezes the theme

FTP is enabled per theme from the store admin, under **Design → code editor**.
Before asking the user to do that, tell them what it costs:

**From the moment FTP is enabled, that theme stops receiving the platform's
automatic fixes and improvements.** Anything the platform would have shipped to it
from then on has to be applied by hand instead. It is the same trade as forking a
sections-based theme — the theme's maintenance becomes the store's.

Relay this before the switch is flipped, not after. How to close FTP again, and
whether closing it resumes the automatic fixes, is not documented — so do not tell
the user it can be undone.

## Version control is the only rollback

There is no backup, restore, revert or version history for classic themes, in the
platform or in the CLI. A push overwrites the remote and deletes whatever is
missing locally, so the local copy is the only copy of what was there before.

So a classic-theme job starts with `nuvemshop theme ftp pull` and a commit of that
pull to version control, before any edit. That commit is what makes a bad push
fixable. Paths with a hidden segment — anything starting with `.`, such as
`.nuvem`, `.git` or `foo/.bar/file` — are never uploaded or watched, so keeping
the repository in the workspace is safe.

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

## Step 1 — Configure the workspace (terminal only)

FTP credentials are established by running this in a terminal:

```bash
nuvemshop theme ftp setup
```

It asks for the FTP server, username, password and store URL, and writes them to
`.nuvem`. Leave it with the user: the password is a secret that should not travel
through a chat transcript.

Until it has been run, the FTP commands fail with the CLI's own message telling the
user to run `theme ftp setup` first. Relay that message rather than trying to
diagnose it.

**A workspace may hold both credential sets**, and then both families work in the
same directory — useful when you want to list themes over the API and then sync a
classic one over FTP. Nothing stops you from pushing a tree pulled by the other
family, so keep one directory per theme unless you have a reason not to.

## Step 2 — Pull

```bash
nuvemshop theme ftp pull
```

Downloads the theme into the current directory. **It overwrites local files**, so
make sure the user has committed or backed up local work first. It asks for
confirmation.

Commit the pulled tree before editing it — that commit is the only rollback there
is.

## Step 3 — Edit, then push

```bash
nuvemshop theme ftp push
```

The push first compares the local tree with the remote, then asks one yes/no
question that carries the counts: how many files it will add, modify, and delete
from the remote theme. With `-y` it logs the same counts as `Pending changes`
instead of asking. Those are counts, not file names, and they come from the same
comparison the push is about to act on — so for an ordinary push they are the
check, and nothing needs to run before it.

Two things the comparison cannot do, both worth stating rather than implying:

- It compares **size and modification time, not content**, so an edit that keeps
  the byte count and timestamp reads as unchanged.
- Files of **zero bytes are never uploaded** (a workaround for an FTP library
  bug), so they show up as skipped rather than as work.

**Group related edits into one push.** Do not push after every small change. Two
reasons, and they agree:

- **It is slow.** The push walks the whole remote tree to compare it. On a
  142-file theme that walk measured around 28 seconds, so the cost is per push,
  not per file, and twenty small pushes cost twenty times what one push costs.
- **It is a worse review.** Every push is live to shoppers. Reviewing twenty small
  change sets is not twenty reviews — it becomes a reflex, and the confirmation
  stops meaning anything.

Make the related edits, push once.

### Before a large batch: `theme ftp diff`

```bash
nuvemshop theme ftp diff          # add --json for a machine-readable list
```

It runs the same comparison as the push and uploads nothing, but it names every
file to add, modify, and delete. **It costs the same full walk of the remote
tree**, and the push that follows walks it again — so a diff before a push pays
that price twice. Do not run it before every push, after each edit, or in a loop
while iterating: that is what stalls the work.

Run it once, before pushing a large batch, when the file list is worth the wait:

- many files changed, or files deleted locally — the list is the only place the
  deletions are named before they happen;
- a long time since the last pull, or a hint that someone else edited the theme
  — a file listed as modified that you did not touch means the remote moved, and
  the user should see it before it is overwritten.

For a small change set that you made and can name yourself, skip it and push.

`--force` uploads every file instead of comparing against the remote first. It
means "upload everything, do not work out what moved", which is exactly why it
should only be set when the user has asked for it in those terms. Never reach for
it to get past a refusal or to save time.

### Confirmations, and why they fail in a non-interactive shell

`theme ftp pull` and `theme ftp push` both ask a yes/no question. There is no TTY
behind a tool call, and `CI` counts as non-interactive too, so in that setting the
command does not ask — it **aborts** with:

> Destructive operation requires confirmation. Re-run with --yes in
> non-interactive mode.

`theme ftp push` compares before it asks, so a run without `-y` here pays the
whole remote walk and then aborts without showing a single count. Do not run it
to find out what would change — that is the job of `theme ftp diff`, when the
change is big enough to justify one.

Tell the user exactly what the command will change, get their explicit yes, and
only then re-run it with `-y`. On this family that yes is worth more than on the
other one: there is no preview, and the push is the storefront.

## Measuring performance around a classic push

Worth doing when the change touches an image, a script, a stylesheet, a font or a
component that adds markup. Not worth it for copy, a colour or a translation.

Two things are different here from the sections-based side, and both need saying
out loud before you propose it:

- **It needs Public API credentials in this workspace.** The audit resolves the
  store URL from the API configuration, and the URL that `theme ftp setup` saved is
  not read for this. With FTP credentials alone the command fails on the missing
  API credentials. Tell the user that `nuvemshop theme authorize` in their terminal
  would add them and unlock the measurement — and offer to carry on without it,
  because this is an extra, not a prerequisite for fixing a file.
- **The "after" is already live.** There is no preview to measure, so the second
  measurement is of the storefront that shoppers are already seeing. This flow
  tells you what a change cost; it cannot stop the cost from landing.

When the workspace does have both credential sets:

```bash
nuvemshop theme performance --published --device mobile --detailed
```

`--published` is the right target here, because FTP writes to the published
theme — the same theme on both sides of the comparison. Run it once before the
push and once after, same device both times, and show the user both numbers.

A drop of 5 points or more is worth calling out; below that, give the numbers
without a verdict. Undoing it means pushing the previous commit, which exists only
if it was made when the tree was pulled. Then stop: report, ask, and let the user
decide whether the cost is acceptable. Do not re-run the audit chasing a better
number, and do not start fixing on your own initiative — see
`nuvemshop-theme-use-cases` for the full flow.

## When the store's published theme changes

FTP access belongs to the published theme. If a different theme gets published —
with `nuvemshop theme publish`, or by someone switching themes in the store's
admin panel — the FTP account for the previous theme stops working. Pulls, pushes
and a running `theme ftp watch` all begin failing with login or connection errors.

The error text will not say this. It arrives as a raw FTP message such as
`530 Login incorrect`, or a closed-connection error, so treat an FTP failure in a
workspace that used to work as a likely theme swap.

It is not a typo and not a transient fault, so **do not retry**. Tell the user to:

1. Open the store's admin panel and get the FTP credentials for the theme that is
   published now.
2. Re-run `nuvemshop theme ftp setup` in their terminal with those credentials.

The credentials already in `.nuvem` are dead and cannot be repaired — and as
always, do not read or edit that file to investigate.

## Commands that do not belong in a tool call

- **`nuvemshop theme ftp watch`** — a file watcher that syncs on every save and
  reloads the storefront. It never returns on its own, so running it from a tool
  call hangs the call. When the user wants an auto-syncing loop, tell them to run
  it in a terminal alongside the session. If their watch starts failing on every
  save, suspect a theme swap rather than their editor.
- **`nuvemshop theme ftp setup`** — see Step 1.

## Credentials

**Never read, open, decode or print `.nuvem`.** It holds the store's FTP
credentials, including the password. Confirming the file exists is fine; its
contents are never needed for theme work.

When a command fails on authentication, do not inspect or edit `.nuvem` to
diagnose it. Tell the user to verify their credentials and re-run
`nuvemshop theme ftp setup` in their terminal, and do not retry the call, because
a retry loop on bad credentials only hides the cause.
