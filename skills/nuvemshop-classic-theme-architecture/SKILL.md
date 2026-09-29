---
name: nuvemshop-classic-theme-architecture
description: How a classic (non-sectionable) Nuvemshop/Tiendanube theme is built - the folder layout, layout.tpl and templates/, the config/*.txt files, and the Twig spellings that differ from sectionable themes. Use before editing any file in a classic theme, and whenever a theme syncs over FTP rather than the Public API.
license: MIT
compatibility: Requires the Nuvemshop/Tiendanube CLI (@tiendanube/cli) on PATH
---

# Classic (legacy) theme architecture

Classic themes are the pre-sections model: every page is a static `.tpl` file
rendered with **Twig**, configured through `config/*.txt`, and synced over **FTP**
only. This is what the Base theme and every non-sectionable base theme
(Amazonas, Atlántico, Style…) use.

The platform's own position, worth relaying accurately: this model stays
documented for the stores still on it, but it is **not** the model for building a
new theme — that is sectionable themes. Neither is it deprecated for existing
stores, so "you should migrate" is not the answer to a maintenance request.

To sync one, see the `nuvemshop-theme-ftp-workflow` skill. There is no fork, no
Public API push, and no theme id: FTP resolves to the store's published theme.

Two costs to know before you touch a classic theme, both from that skill:

- **Opening FTP freezes the theme.** Once FTP is enabled for a theme — from the
  store admin, under Design → code editor — it stops receiving the platform's
  automatic fixes and improvements, and each one has to be applied by hand from
  then on.
- **The local copy is the only copy.** Nothing in the platform or the CLI keeps a
  backup, a revert or a version history of a classic theme, and a push overwrites
  the remote and deletes files missing locally. So pull first and commit that pull
  to version control before editing; `.git` is excluded from FTP sync, so the
  repository is safe to keep in the workspace.

## Read this first: the spellings that differ from sectionable themes

Most of the general Twig documentation is written for sectionable themes, and four
things are spelled differently here. Using the sectionable form in a classic theme
does not error politely — it renders nothing, or renders the raw key.

| | Classic (this skill) | Sectionable (Ipanema) |
|---|---|---|
| Component folder | `snipplets/` — **with the L** | `snippets/` |
| Include tag | `{% snipplet %}` | `{% include 'snippets/…' %}` in practice |
| Translation filter | `translate` | `t` |
| Translation source | `config/translations.txt` | `translations/<locale>.json` |
| Translation key | the **Spanish** string, literally | a dotted key |
| Settings | `config/settings.txt` + `defaults.txt` | `config/settings_schema.json` |
| Section settings | none — no `{% schema %}` blocks | a `{% schema %}` per section |
| Page composition | one static `.tpl` per page type | JSON templates of sections and blocks |
| `section` object | a featured-products group from `sections.txt` | a section instance with `.settings`/`.blocks` |

So in a classic theme:

```twig
{% snipplet "product-item.tpl" %}
{{ "Agregar al carrito" | translate }}
```

and **not** `{% snippet %}` or `| t`.

One asymmetry worth knowing, because it decides what you copy: `{% snipplet %}` is
the idiom classic themes actually use, but on the Ipanema side the shipped theme
reaches for the plain Twig form — `{% include 'snippets/icon.tpl' %}` — in around
a hundred files, and `{% snippet %}` in none of them. So the mirror of a classic
`{% snipplet %}` is an `{% include %}`, not a same-shaped tag.

Filters that exist only for sectionable themes and have nothing to act on here:
`block_attributes`, `resolve_media`. Do not reach for `{% schema %}`,
`section.settings`, `section.blocks`, or `templates/pages/*.json` either — none of
them exist in this model.

## Folder structure

```
config/
  settings.txt        merchant-editable settings
  defaults.txt        default value per setting
  variants.txt        named presets of settings
  sections.txt        featured-product groups
  translations.txt    all translatable strings
layouts/
  layout.tpl          the one wrapper for every page
templates/
  home.tpl product.tpl category.tpl cart.tpl page.tpl
  contact.tpl search.tpl password.tpl 404.tpl
  account/            login, register, info, addresses, address,
                      orders, order, reset, newpass
snipplets/            reusable components
static/
  css/  js/  img/
```

Two things about real stores that the documented tree does not show:

- A live classic theme also carries **`config/data.json`**, which the docs do not
  list. Treat it as platform-managed: do not hand-edit it, and do not delete it.
- Because an FTP push deletes remote files that are missing locally, a file you
  never pulled is a file a push would remove. Pull the whole theme before you
  push, and let your own version control show you what the change set is.

## layouts/layout.tpl

One file wraps every page. It opens and closes `<html>` and `<body>`, holds the
`<head>`, renders the shared header and footer, and injects the page with
`{% template_content %}`:

```twig
<!DOCTYPE html>
<html lang="{{ language.code }}">
<head>
  <title>{{ page_title }}</title>
  {{ 'css/style-colors.scss.tpl' | static_url | css_tag }}
</head>
<body>
  {% snipplet "header/header.tpl" %}
  <main>{% template_content %}</main>
  {% snipplet "footer/footer.tpl" %}
  {{ 'js/store.js.tpl' | static_url | script_tag }}
</body>
</html>
```

**Templates must not open `<html>`, `<head>` or `<body>`** — the layout already
did. A template that repeats them produces nested documents.

## templates/

The platform picks the template from the URL: `/products/<handle>` renders
`product.tpl`, the result is injected at `{% template_content %}`.

The global `template` variable names the current page, for loading things
conditionally. Its valid values are exactly: `home`, `product`, `category`,
`cart`, `page`, `contact`, `search`, `password`, `404`.

```twig
{% if template == 'product' %}{{ pin_js }}{% endif %}
```

Customer account pages live in `templates/account/`.

## config/

**`settings.txt`** declares what the merchant can change; each entry becomes a
control in the theme customizer and is readable as `settings.<name>`. The types
are `checkbox`, `i18n_input`, `dropdown`, `color`, `font`, `image`, `textarea`.
The format is indented plain text, not JSON:

```
color
    name = primary_color
    description = Primary brand color
dropdown
    name = theme_variant
    description = Theme style
    values
        classic = Classic
        modern = Modern
```

**`defaults.txt`** gives each setting its initial value (`primary_color = #2B35AF`).
**`variants.txt`** groups settings into named presets under `[Name]` headers.

**`sections.txt`** declares featured-product groups the merchant fills from the
admin. This is what `section` means in a classic theme:

```
[primary]
name = Featured Products
description = Main featured products section
```

```twig
{% for section in sections %}
  {% if section.products | length > 0 %}
    <h2>{{ section.name }}</h2>
    {% for product in section.products %}{% snipplet "product-item.tpl" %}{% endfor %}
  {% endif %}
{% endfor %}
```

**`translations.txt`** holds every translatable string, grouped per key with one
line per language. **The key is the Spanish string**, which is the single most
common mistake when writing new copy:

```
es "Agregar al carrito"
pt "Adicionar ao carrinho"
en "Add to cart"
```

```twig
{{ "Agregar al carrito" | translate }}
```

Always add all three languages when introducing a string; a missing one falls back
to the key, so a Brazilian storefront would show Spanish.

## static/

Assets, and the reason `.tpl` shows up on stylesheets: **any file ending in
`.tpl` runs through Twig**, whatever its content type. So `style-colors.scss.tpl`
can read `settings`:

```scss
$primary-color: {{ settings.primary_color }};
.btn-primary { background-color: $primary-color; }
```

The same applies to `.js.tpl` for injecting translated strings into scripts.

**`static/css/checkout.scss.tpl` must stay at that exact path** — the platform
looks for it there, and it styles checkout, so changes are storefront-visible in
the most sensitive place.

Reference assets through filters rather than hardcoded URLs:
`{{ 'img/placeholder.png' | static_url | img_tag }}`.

## Twig, the parts used constantly

`{{ ... }}` prints, `{% ... %}` executes, `{# ... #}` comments. `{% set %}` stores
a value. `{% if %}`/`{% else %}`/`{% elseif %}` branch; `{% for %}` loops and
exposes `loop.index`, `loop.index0`, `loop.first`, `loop.last`, `loop.length`.

Three ways to include a component, and the path rule differs between them:

| Form | Path | Parameters | Block override |
|---|---|---|---|
| `{% snipplet "x.tpl" %}` | relative to `snipplets/` | no | no |
| `{% include "snipplets/x.tpl" %}` | starts at `snipplets/` | `with { … }` | no |
| `{% embed "snipplets/x.tpl" %}` | starts at `snipplets/` | `with { … }` | yes, `{% block %}` |

Note the asymmetry: `{% snipplet %}` adds the folder for you, the other two do not.

Filters available in this model: `translate`, `money`, `raw`, `static_url`,
`css_tag`, `script_tag`, `img_tag`, `a_tag`, `product_image_url`,
`category_image_url`, `settings_image_url`, `has_custom_image`, `is_external`,
`take`, `shuffle`, `highlight`, `sanitize`, `json_encode`, `add_param`,
`static_inline`, `format_address`, `format_address_short`, plus
`google_fonts_url`. Image sizes are `tiny`, `small`, `medium`, `large`, `huge`,
`original`, `1080p`.

`raw` disables escaping — use it for store settings and platform-generated HTML,
never for anything a shopper typed.

## Source

Nuvemshop/Tiendanube developer documentation, Classic Themes (Legacy):
`nuvemshop.dev/themes/classic-themes/getting-started`, plus its Layouts &
Templates and Configuration pages, and the Twig reference under
`nuvemshop.dev/themes/twig-reference`. When a detail here disagrees with a live
theme, the live theme wins — say so rather than forcing the file to match.
