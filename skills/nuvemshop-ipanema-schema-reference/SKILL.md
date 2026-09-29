---
name: nuvemshop-ipanema-schema-reference
description: The exact schema vocabulary for Ipanema sections and blocks on a Nuvemshop/Tiendanube store: entry kinds, all 23 setting_type values, conditional visibility, presets, and global settings_schema.json. Use when writing or editing a {% schema %} block, a section preset, or config/settings_schema.json.
license: MIT
compatibility: Requires the Nuvemshop/Tiendanube CLI (@tiendanube/cli) on PATH
---

# Ipanema `{% schema %}` reference

Every file under `sections/` and `blocks/` ends with a schema block:

```twig
{% schema %}
{ ... }
{% endschema %}
```

## Section-level keys

```json
{
  "name": "t:names.text_editorial",
  "icon": "TextSizeIcon",
  "class": "section section-rich-text",
  "add_section_order": 8,
  "blocks": [ { "tags": ["general"] } ],
  "settings": [ ... ],
  "enabled_on": {
    "page_templates": "all",
    "layout_templates": ["footer"]
  },
  "presets": [ ... ]
}
```

- `name` — editor label, as a `t:` translation key.
- `icon` — editor icon identifier.
- `class` — CSS classes applied to the section wrapper.
- `add_section_order` — position in the editor's "add section" list.
- `blocks` — which block types this section accepts. Commonly tag-based
  (`{ "tags": ["general"] }`) rather than an explicit type list.
- `enabled_on` — restricts where the section may be used. `page_templates` can be
  `"all"` or an array; `layout_templates` names section groups such as
  `["header"]` or `["footer"]`.
- `presets` — starting configurations offered in the editor, each with its own
  `settings` and pre-populated `blocks`.

## The `settings` array

**This is the part most often gotten wrong.** Entries are discriminated by
`type`, and an actual input control is `type: "setting"` with the control kind in
a separate `setting_type` field:

```json
{
  "type": "setting",
  "setting_type": "range",
  "id": "vertical_padding",
  "label": "t:settings.vertical_padding",
  "min": 0, "max": 120, "step": 4,
  "unit": "px",
  "default": 64,
  "icon": "vertical_padding"
}
```

There is no flat `{ "type": "range" }` form. The other entry kinds are layout,
not controls:

| `type` | Purpose |
|---|---|
| `setting` | an input control; `setting_type` selects which |
| `header` | a group heading; carries `content`, no `id` |
| `group` | a nested grouping of settings |

## All `setting_type` values

Text and rich text: `text`, `richtext`, `inline_richtext`, `custom_code`

Choice: `radio`, `select`, `checkbox`, `toggle`, `heading_select`

Alignment: `alignment`, `text_alignment`

Numeric: `range`

Color and type: `color`, `font_picker`

Media: `image_picker`, `icon_picker`, `video_url`

Links and data: `url`, `menu`, `menu_item`, `product_list`

Date and time: `date`, `time`

Common fields on a control: `id`, `label`, `default`, `info` (helper text),
`options` (for `radio`/`select`/alignment kinds, each `{ value, label }`), and for
`range`: `min`, `max`, `step`, `unit`.

### Inheriting a global value

`default_setting` points at an id from `config/settings_schema.json` so a section
control starts from the theme's global choice instead of a literal:

```json
{ "type": "setting", "setting_type": "color", "id": "text_color",
  "label": "t:settings.text", "default_setting": "text_color" }
```

## Conditional controls — `visible_if` and `disabled_if`

Two distinct features, both taking a Twig expression as a string:

- `visible_if` — hides the control entirely when the expression is false.
- `disabled_if` — keeps it visible but greys it out when the expression is true.

```json
{ "type": "setting", "setting_type": "range", "id": "horizontal_padding",
  "label": "t:settings.horizontal_padding", "min": 0, "max": 120, "step": 4,
  "disabled_if": "{{ section.settings.section_width == 'page' }}" }
```

Note the inverted sense: `visible_if` is a condition for showing, `disabled_if` a
condition for disabling. Both are used throughout the shipped theme; pick by
whether an inapplicable control should vanish or simply be unavailable.

## Presets

```json
"presets": [
  {
    "name": "t:names.text_editorial",
    "category": "t:categories.content",
    "settings": { "alignment": "center", "gap": 16 },
    "blocks": [
      { "type": "heading", "settings": { "title": "t:defaults.rich_text.heading", "size": "h4" } },
      { "type": "text",    "settings": { "text": "t:defaults.rich_text.description" } }
    ]
  }
]
```

Note that `presets[].blocks` is an **array**, whereas `blocks` in a JSON template
is an **object keyed by instance id**. Do not copy one shape into the other.

## Global settings — `config/settings_schema.json`

A top-level **array** of editor panels, each with its own `settings` array using
the exact same entry vocabulary:

```json
[
  {
    "name": "t:names.colors",
    "icon": "ColorPaletteIcon",
    "group": "t:names.brand",
    "settings": [
      { "type": "header", "content": "t:content.main_colors" },
      { "type": "setting", "setting_type": "color", "id": "background_color",
        "label": "t:settings.background", "default": "#FFFFFF" }
    ]
  }
]
```

`group` buckets panels together in the editor sidebar.

`config/settings_data.json` holds the merchant's chosen values for these. It is
**instance data, not code** — see the `nuvemshop-fork-and-push-rules` skill for
why that distinction decides whether you can push it.

## Rules of thumb

- Every user-visible string is a `t:` key, resolved from
  `translations/<locale>.schema.json`. Never hardcode copy in a schema.
- `id` values must be unique within their settings array, and are what the
  template reads as `section.settings.<id>` / `block.settings.<id>`.
- After adding a setting, give it a `default` (or `default_setting`) — an absent
  value reaches the template as undefined and usually renders as empty.
- When in doubt about a field, read a shipped section under `sections/` in the
  pulled theme; those schemas are what the engine actually parses.

The vocabulary here is transcribed from the shipped Ipanema theme's own section
and block schemas, which is the only authority that matches what the engine
parses. When a detail here disagrees with a pulled theme, the pulled theme wins.
