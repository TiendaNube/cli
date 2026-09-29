---
name: nuvemshop-ipanema-architecture
description: What Ipanema is and how its files fit together on a Nuvemshop/Tiendanube store: sections, blocks, JSON templates, section groups, and how it differs from classic Twig themes. Use when editing a sections-based theme, before changing any file under sections/, blocks/, snippets/, layouts/ or templates/.
license: MIT
compatibility: Requires the Nuvemshop/Tiendanube CLI (@tiendanube/cli) on PATH
---

# Ipanema — sections-based theme architecture

**Ipanema** is Nuvemshop/Tiendanube's first sections-based storefront theme
(`code: "ipanema"`). It is a theme, not a framework or a template language — the
template language is still Twig (`.tpl`). What makes it different is that pages
are composed from merchant-editable **sections** and **blocks** described by JSON,
instead of being fixed `.tpl` templates.

Merchants edit it visually through the Brand Editor. Developers edit it through
the CLI's Fork workflow. Ipanema is currently the only theme that workflow
supports.

## Folder layout of a pulled theme

```
sections/       # .tpl files, one per section, each with a {% schema %} block
blocks/         # .tpl files, one per block type, each with a {% schema %} block
snippets/       # reusable Twig partials (no schema)
layouts/        # layout.tpl — the page shell
templates/      # JSON: which sections appear on which page, and their settings
  pages/        #   home.json, product.json, category.json, cart.json, 404.json, ...
  layout/       #   header.json, footer.json  (section groups)
config/
  settings_schema.json   # global theme settings, grouped into editor panels
  settings_data.json     # the merchant's chosen values for those settings
translations/   # <locale>.json (storefront copy) + <locale>.schema.json (editor labels)
custom/         # store-specific overrides (pulled, but never pushed — see below)
static/         # compiled CSS, JS, images
manifest.json   # present in a pulled workspace
```

That list is also the CLI's sync scope: anything outside it, and any path with a
hidden segment (`.nuvem`, `.git`, `foo/.bar/baz`), is neither pulled nor pushed.

## Sections and blocks

A **section** is a horizontal band of a page — a hero, a product grid, a footer.
Each is one `.tpl` file under `sections/` ending in a `{% schema %}` block that
declares its settings, which blocks it accepts, and its presets.

A **block** is a smaller unit placed inside a section — a heading, a button, an
image, a testimonial. Each is one `.tpl` under `blocks/`. Sections render their
blocks by including them dynamically:

```twig
{% for block in section.blocks %}
	{% include 'blocks/' ~ block.type ~ '.tpl' with { block: block } %}
{% endfor %}
```

Blocks can nest. A `group` block, for example, holds its own child blocks, which
is how two buttons end up side by side inside a hero.

Inside a section template, settings are read from `section.settings.<id>` and the
section's own identity from `section.id`. Inside a block template,
`block.settings.<id>`.

## JSON templates

`templates/pages/*.json` decides which sections a page shows, in what order, with
what values. `sections` is an **object keyed by instance id** — not an array — and
a sibling `order` array gives the sequence:

```json
{
  "sections": {
    "hero_divided": {
      "type": "hero-divided",
      "settings": { "alignment": "center", "height": 100 },
      "blocks": {
        "heading": { "type": "heading", "settings": { "title": "t:defaults.hero.heading" } },
        "text":    { "type": "text",    "settings": { "text": "t:defaults.hero.description" } }
      }
    },
    "newsletter": { "type": "newsletter", "settings": {} }
  },
  "order": ["hero_divided", "newsletter"]
}
```

The instance key (`hero_divided`) is arbitrary and local to the template; `type`
is the section file name without `.tpl`. The same section file can appear many
times on one page under different keys.

**`order` is the source of truth for sequence.** When you add a section to a
template you must add its key to `order` as well, or it will not render.

## Section groups

`templates/layout/header.json` and `footer.json` are **section groups**: reusable
groups of sections that appear across pages rather than on one page. They carry a
`type` and `name` alongside the same `sections` map.

## Translations

Schema labels use `t:` keys resolved from `translations/<locale>.schema.json` —
for example `"label": "t:settings.background"`. Storefront-facing copy resolves
from `translations/<locale>.json`. Never hardcode user-visible strings in a
schema; add a `t:` key and translate it.

## How Ipanema differs from classic Twig themes

| | Classic theme | Ipanema |
|---|---|---|
| Page composition | fixed `.tpl` templates | `sections/` + `blocks/` + JSON templates |
| Merchant editing | limited theme settings | full section/block composition in the Brand Editor |
| JavaScript | jQuery / jQueryNuvem, `.js.tpl` | vanilla JS, plain `.js` |
| CSS | Sass compiled per store | compiled CSS in `static/` |
| Reuse | private shared components | local `snippets/` |
| Sync | FTP | the Public API (`theme pull` / `theme push`) |

Do not carry classic-theme idioms into Ipanema: no jQuery, no `.js.tpl`, no
private component includes. The spellings differ too, and picking the classic one
here fails quietly — nothing is included, or no string comes out:

- Reusable partials live in `snippets/` and the include tag is `{% snippet %}` —
  **no L**, in both. `snipplets/` and `{% snipplet %}` are the classic forms and
  do not belong in an Ipanema theme. In practice the shipped theme reaches for
  them with a plain `{% include 'snippets/<path>.tpl' %}`, which spells the folder
  out — so that path, too, is the one without the L.
- Translations use the `t` filter against `translations/<locale>.json`.
  `| translate` against `config/translations.txt` is the classic form.

The **`nuvemshop-classic-theme-architecture`** skill carries the full mapping
between the two vocabularies, in the other direction.

## Where to go next

- **`nuvemshop-ipanema-schema-reference`** — the exact `{% schema %}` vocabulary
  and every available setting type.
- **`nuvemshop-fork-and-push-rules`** — which of these folders you can actually
  push to, and when a fork is required.
- **`nuvemshop-theme-fork-workflow`** — the commands that move these files
  between the store and the workspace.
