import rawCatalog from "./data/nubesdk-slots.json" with { type: "json" };

export type SlotGroup = { slotNames: string[] };

export type NubesdkSlotCatalog = {
	groups: Record<string, SlotGroup>;
	legacyTypeToGroup: Record<string, string>;
	/** Legacy `data-nubesdk-slot` values that satisfy the canonical slot name. */
	deprecatedSlotToCanonical?: Record<string, string>;
};

/** Prefix for identifiers found in templates that are not in the catalog (data attribute or unresolvable `type`). */
export const UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX = "__UNKNOWN__:" as const;

const catalog = rawCatalog as NubesdkSlotCatalog;

export function LoadSlotCatalog(): NubesdkSlotCatalog {
	return catalog;
}

const SECTION_PRODUCTS_BEFORE_PREFIX = "before_section_products_" as const;
const SECTION_PRODUCTS_AFTER_PREFIX = "after_section_products_" as const;

/** Twig `type: 'before_section_products_' ~ var` / `after_section_products_' ~ var` prefixes. */
export const SECTION_PRODUCTS_DYNAMIC_TYPE_PREFIXES = [
	SECTION_PRODUCTS_BEFORE_PREFIX,
	SECTION_PRODUCTS_AFTER_PREFIX,
] as const;

export function GetDeprecatedSlotToCanonical(
	cat: NubesdkSlotCatalog,
): Record<string, string> {
	return cat.deprecatedSlotToCanonical ?? {};
}

/**
 * Full `type` strings for dynamic home sections, derived from catalog group keys
 * (e.g. `before_section_products_sale` when `before_section_products_` is concatenated in Twig).
 */
export function ListSectionProductsTypesForDynamicPrefix(
	cat: NubesdkSlotCatalog,
	twigLiteralPrefix: string,
): string[] {
	return Object.keys(cat.groups).filter(
		(k) =>
			k.startsWith(twigLiteralPrefix) && k.length > twigLiteralPrefix.length,
	);
}

export function IsSectionProductsDynamicTypeLiteral(
	typeLiteral: string,
): boolean {
	return (
		typeLiteral === SECTION_PRODUCTS_BEFORE_PREFIX ||
		typeLiteral === SECTION_PRODUCTS_AFTER_PREFIX
	);
}

export function GetAllSlotNamesSorted(cat: NubesdkSlotCatalog): string[] {
	const set = new Set<string>();
	for (const group of Object.values(cat.groups)) {
		for (const name of group.slotNames) {
			set.add(name);
		}
	}
	return [...set].sort((a, b) => a.localeCompare(b));
}

/** True if `name` is a declared slot name in any catalog group. */
export function IsCatalogSlotName(
	cat: NubesdkSlotCatalog,
	name: string,
): boolean {
	for (const group of Object.values(cat.groups)) {
		if (group.slotNames.includes(name)) {
			return true;
		}
	}
	return false;
}

/**
 * Resolves a Twig `type` string to slot names emitted by nubesdk-slot.tpl for that type.
 * Tries `legacyTypeToGroup` and group keys first (so group-level types still expand every slot in the group),
 * then a concrete `typeLiteral` that appears in some `group.slotNames` but is not a group key (e.g. `before_footer_internal`).
 */
export function ResolveTypeToSlotNames(
	cat: NubesdkSlotCatalog,
	typeLiteral: string,
): string[] {
	const groupKey =
		cat.legacyTypeToGroup[typeLiteral] ??
		(cat.groups[typeLiteral] ? typeLiteral : undefined);
	if (groupKey) {
		const group = cat.groups[groupKey];
		return group ? [...group.slotNames] : [];
	}
	if (IsCatalogSlotName(cat, typeLiteral)) {
		return [typeLiteral];
	}
	return [];
}
