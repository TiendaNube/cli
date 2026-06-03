import fs from "node:fs";
import path from "node:path";
import { readdirpPromise } from "readdirp";
import type { NubesdkSlotCatalog } from "./slot-catalog";
import {
	GetDeprecatedSlotToCanonical,
	IsCatalogSlotName,
	IsSectionProductsDynamicTypeLiteral,
	ListSectionProductsTypesForDynamicPrefix,
	ResolveTypeToSlotNames,
	UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX,
} from "./slot-catalog";

const IGNORE_DIRS = new Set([".git", "node_modules"]);

const dataNubesdkSlotRe = /data-nubesdk-slot\s*=\s*["']([^"']+)["']/g;

/** `{% include '...nubesdk-slot...' with { ... } %}` (non-greedy `with` body). */
const includeNubesdkSlotRe =
	/\{%\s*include\s+["']([^"']*nubesdk-slot[^"']*)["']\s+with\s*\{([\s\S]*?)\}\s*%}/g;

const typeInWithRe = /type\s*:\s*["']([^"']+)["']/;

/** `{{ component('nubesdk-slot', { type: "..." }) }}` (Twig component helper). */
const componentNubesdkSlotRe =
	/component\s*\(\s*['"]nubesdk-slot['"]\s*,\s*\{([\s\S]*?)\}\s*\)/g;

/**
 * Platform `product-item-image` includes `nubesdk-slot` for `product_grid_item_image`.
 * Themes only reference the outer component; detection is by name — a theme override that
 * removes the inner slot would still be reported as covered.
 */
const platformProductItemImageRe =
	/component\s*\(\s*['"]product-item-image['"]/;

export type NubesdkThemeSlotScan = {
	directCanonical: Set<string>;
	/** Canonical slot satisfied only via deprecated `data-nubesdk-slot` → legacy name */
	legacyDomByCanonical: Map<string, string>;
	unknownUnresolved: Set<string>;
	/** True if any scanned `.tpl` invokes the platform image component. */
	usesPlatformProductItemImage: boolean;
	/**
	 * Grid image slots satisfied only because `usesPlatformProductItemImage` (not direct in theme).
	 */
	indirectViaProductItemImage: Set<string>;
};

export function createNubesdkThemeSlotScan(): NubesdkThemeSlotScan {
	return {
		directCanonical: new Set(),
		legacyDomByCanonical: new Map(),
		unknownUnresolved: new Set(),
		usesPlatformProductItemImage: false,
		indirectViaProductItemImage: new Set(),
	};
}

function finalizeIndirectProductGridItemImageSlots(
	catalog: NubesdkSlotCatalog,
	scan: NubesdkThemeSlotScan,
): void {
	scan.indirectViaProductItemImage.clear();
	if (!scan.usesPlatformProductItemImage) {
		return;
	}
	const group = catalog.groups.product_grid_item_image;
	if (!group) {
		return;
	}
	for (const name of group.slotNames) {
		if (
			!scan.directCanonical.has(name) &&
			!scan.legacyDomByCanonical.has(name)
		) {
			scan.indirectViaProductItemImage.add(name);
		}
	}
}

export function MergeScanIntoFoundSet(
	catalog: NubesdkSlotCatalog,
	scan: NubesdkThemeSlotScan,
): Set<string> {
	finalizeIndirectProductGridItemImageSlots(catalog, scan);
	const s = new Set<string>();
	for (const x of scan.directCanonical) {
		s.add(x);
	}
	for (const c of scan.legacyDomByCanonical.keys()) {
		s.add(c);
	}
	for (const x of scan.indirectViaProductItemImage) {
		s.add(x);
	}
	for (const u of scan.unknownUnresolved) {
		s.add(u);
	}
	return s;
}

function ExpandTypeLiteralToSlotNames(
	catalog: NubesdkSlotCatalog,
	typeLiteral: string,
): string[] {
	if (IsSectionProductsDynamicTypeLiteral(typeLiteral)) {
		const fullTypes = ListSectionProductsTypesForDynamicPrefix(
			catalog,
			typeLiteral,
		);
		const out: string[] = [];
		for (const ft of fullTypes) {
			out.push(...ResolveTypeToSlotNames(catalog, ft));
		}
		return out;
	}
	return ResolveTypeToSlotNames(catalog, typeLiteral);
}

function RecordDataNubesdkSlot(
	catalog: NubesdkSlotCatalog,
	name: string,
	scan: NubesdkThemeSlotScan,
): void {
	const dep = GetDeprecatedSlotToCanonical(catalog);
	const canonicalFromLegacy = dep[name];
	if (canonicalFromLegacy) {
		if (!IsCatalogSlotName(catalog, canonicalFromLegacy)) {
			scan.unknownUnresolved.add(`${UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX}${name}`);
			return;
		}
		if (!scan.directCanonical.has(canonicalFromLegacy)) {
			scan.legacyDomByCanonical.set(canonicalFromLegacy, name);
		}
		return;
	}
	if (IsCatalogSlotName(catalog, name)) {
		scan.directCanonical.add(name);
		scan.legacyDomByCanonical.delete(name);
		return;
	}
	scan.unknownUnresolved.add(`${UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX}${name}`);
}

function RecordResolvedTypeSlots(
	catalog: NubesdkSlotCatalog,
	typeLiteral: string,
	scan: NubesdkThemeSlotScan,
): void {
	const resolved = ExpandTypeLiteralToSlotNames(catalog, typeLiteral);
	if (resolved.length === 0) {
		scan.unknownUnresolved.add(
			`${UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX}${typeLiteral}`,
		);
		return;
	}
	for (const slot of resolved) {
		scan.directCanonical.add(slot);
		scan.legacyDomByCanonical.delete(slot);
	}
}

async function CollectTplPaths(themeRoot: string): Promise<string[]> {
	const normalized = path.resolve(themeRoot);
	const entries = await readdirpPromise(normalized, {
		fileFilter: (entry) => entry.basename.endsWith(".tpl"),
		directoryFilter: (d) => !IGNORE_DIRS.has(d.basename),
	});
	return entries.map((e) => e.fullPath);
}

export function CollectSlotsFromTplContent(
	content: string,
	catalog: NubesdkSlotCatalog,
	scan: NubesdkThemeSlotScan,
): void {
	for (const m of content.matchAll(dataNubesdkSlotRe)) {
		const name = m[1];
		if (!name) {
			continue;
		}
		RecordDataNubesdkSlot(catalog, name, scan);
	}

	for (const m of content.matchAll(includeNubesdkSlotRe)) {
		const withBody = m[2];
		if (!withBody) {
			continue;
		}
		const typeMatch = typeInWithRe.exec(withBody);
		if (!typeMatch?.[1]) {
			continue;
		}
		const typeLiteral = typeMatch[1];
		RecordResolvedTypeSlots(catalog, typeLiteral, scan);
	}

	for (const m of content.matchAll(componentNubesdkSlotRe)) {
		const propsBody = m[1];
		if (!propsBody) {
			continue;
		}
		const typeMatch = typeInWithRe.exec(propsBody);
		if (!typeMatch?.[1]) {
			continue;
		}
		const typeLiteral = typeMatch[1];
		RecordResolvedTypeSlots(catalog, typeLiteral, scan);
	}

	if (platformProductItemImageRe.test(content)) {
		scan.usesPlatformProductItemImage = true;
	}
}

export type ScanThemeForNubesdkSlotsResult = {
	found: Set<string>;
	directCanonical: Set<string>;
	legacyDomByCanonical: Map<string, string>;
	indirectViaProductItemImage: Set<string>;
	tplFilesAnalyzed: number;
};

export async function ScanThemeForNubesdkSlots(
	themeRoot: string,
	catalog: NubesdkSlotCatalog,
	onProgress: (done: number, total: number) => void,
): Promise<ScanThemeForNubesdkSlotsResult> {
	const paths = await CollectTplPaths(themeRoot);
	const scan = createNubesdkThemeSlotScan();
	const total = paths.length;
	if (total === 0) {
		onProgress(0, 0);
		return {
			found: MergeScanIntoFoundSet(catalog, scan),
			directCanonical: scan.directCanonical,
			legacyDomByCanonical: scan.legacyDomByCanonical,
			indirectViaProductItemImage: scan.indirectViaProductItemImage,
			tplFilesAnalyzed: 0,
		};
	}
	for (let i = 0; i < paths.length; i++) {
		const filePath = paths[i];
		if (!filePath) {
			continue;
		}
		const content = fs.readFileSync(filePath, "utf8");
		CollectSlotsFromTplContent(content, catalog, scan);
		onProgress(i + 1, total);
	}
	return {
		found: MergeScanIntoFoundSet(catalog, scan),
		directCanonical: scan.directCanonical,
		legacyDomByCanonical: scan.legacyDomByCanonical,
		indirectViaProductItemImage: scan.indirectViaProductItemImage,
		tplFilesAnalyzed: total,
	};
}
