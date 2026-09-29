---
name: nuvemshop-fork-and-push-rules
description: Which Nuvemshop/Tiendanube theme paths can be pushed without forking, which require a forked theme, and the trade-off forking creates. Use before any theme push that touches sections, blocks, snippets, layouts, schemas or translations, and before proposing a fork or an unfork.
license: MIT
compatibility: Requires the Nuvemshop/Tiendanube CLI (@tiendanube/cli) on PATH
---

# Fork and push rules

A theme's files split into two categories, and which one a file falls into decides
whether you can push it.

## Instance data — pushable without a fork

- `templates/` (everything under it)
- `config/settings_data.json`

These are the merchant's *choices*: which sections appear on which page and with
what settings (`templates/`) and the values behind the global theme settings
(`config/settings_data.json`). You can push these to an ordinary, non-forked
theme.

### `custom/` is instance data the CLI still cannot push

`custom/` holds store-specific overrides, so by the fork rules it belongs in the
list above, and the Public API does accept it on a non-forked theme. This CLI,
however, drops `custom/` files before it even looks at the fork state: a push
reports them as skipped and uploads nothing. Pull the folder and read it, but do
not tell the user a push will apply changes there. This is a gap in the CLI, not
a platform rule.

## Theme code — requires a forked theme

Everything else, which in an Ipanema workspace means:

- `sections/` — section templates and their schemas
- `blocks/` — block templates and their schemas
- `snippets/` — shared Twig partials
- `layouts/` — the page shell
- `config/settings_schema.json` — the *definition* of global settings
- `translations/*.schema.json` — editor-facing labels
- `static/` — compiled CSS, JS, images

A push does not fail on these — it **skips them and says so**, listing each one as
`Skipped (not forked, but has changes)` and counting them in the closing summary.
So a push can report success while changing nothing you cared about: read the
skipped list, do not just check the exit code.

To make them pushable, fork the theme first:

```bash
nuvemshop theme fork --theme-id <id>
```

## Note the split inside `config/` and `translations/`

This trips people up. Within the same folder:

| Path | Category |
|---|---|
| `config/settings_data.json` | instance data — pushable unforked |
| `config/settings_schema.json` | code — needs a fork |
| `translations/<locale>.json` | code — needs a fork |
| `translations/<locale>.schema.json` | code — needs a fork |

Changing *what a setting is* is code. Changing *what the merchant picked* is data.

## What forking costs

A forked theme **stops receiving base-theme updates**. Improvements and fixes
shipped to Ipanema will no longer flow into it; from then on that theme's code is
yours to maintain.

So the decision is not "fork by default":

- Only need to rearrange sections or change setting values? Do **not** fork. Edit
  `templates/` and `config/settings_data.json` and push.
- Need a new section, a modified block, or a schema change? Fork — there is no
  other way — and accept ownership of the code.

Because it changes the theme's update behaviour, `nuvemshop theme fork` asks for
confirmation. Say plainly what forking costs before asking for it.

## Unforking

`nuvemshop theme unfork --theme-id <id>` is not an in-place revert. It creates a
**new theme with a new id** that keeps your templates and settings but drops the
forked theme code, so that new theme tracks the base theme and receives automatic
updates again. The theme you unforked is left untouched — nothing is reverted on
it, and it keeps its code and its id.

So it is not a free undo of a fork: the code customizations held on the fork do
not come along, and the result is a separate draft you still have to preview and
publish. Like the fork, it asks for confirmation, and it consumes an installation
slot.

## Fork state decides the shape of a version

When a theme moves to a newer base-theme version (`nuvemshop theme update`), the
accepted target differs by fork state, and it is the one place where forking
changes an input rather than a permission:

| | Accepted `--to` | Meaning |
|---|---|---|
| forked | an exact version, `2.3.1` | it is pinned, so it moves to a named release |
| not forked | a major, `2` | it tracks the line and takes the newest inside it |

Do not construct those values. Run the command without `--to` and it asks with
the versions the API says this theme can reach; pass a value it does not accept
and the error lists them (`Available: …`). A hand-built version fails a round trip
later.

## Recommended sequence for a code change

This sequence is for sections-based themes over the Public API. Classic themes
sync over FTP, where none of it applies — no fork, no clone, and no copy to work
on; see the `nuvemshop-theme-ftp-workflow` skill.

1. `nuvemshop theme list` — find the theme; note whether it is already forked.
2. `nuvemshop theme clone --theme-id <id>` — if this is a live theme, work on a
   copy rather than the original.
3. `nuvemshop theme fork --theme-id <id>` — only if the change touches code, and
   only after the user agrees to the update trade-off.
4. `nuvemshop theme pull --theme-id <id>` — get the files locally.
5. Edit.
6. `nuvemshop theme diff --detailed` — confirm the change set is what you intend.
7. `nuvemshop theme push --theme-id <id>` — upload.
8. `nuvemshop theme preview --theme-id <id>` — let the user see it.
9. `nuvemshop theme publish --theme-id <id>` — only when they approve.
