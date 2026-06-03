import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	CollectSlotsFromTplContent,
	MergeScanIntoFoundSet,
	ScanThemeForNubesdkSlots,
	createNubesdkThemeSlotScan,
} from "./scan-theme-slots";
import type { NubesdkSlotCatalog } from "./slot-catalog";
import {
	LoadSlotCatalog,
	UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX,
} from "./slot-catalog";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("scan-theme-slots", () => {
	it("detects literal data-nubesdk-slot", async () => {
		const root = path.join(__dirname, "__fixtures__/literal-slot");
		const cat = LoadSlotCatalog();
		const { found, tplFilesAnalyzed } = await ScanThemeForNubesdkSlots(
			root,
			cat,
			() => {},
		);
		expect(tplFilesAnalyzed).toBe(1);
		expect(found.has("after_product_detail_price")).toBe(true);
	});

	it("detects component() in .tpl via full theme scan (fixture on disk)", async () => {
		const root = path.join(__dirname, "__fixtures__/component-slot");
		const cat = LoadSlotCatalog();
		const { found, tplFilesAnalyzed } = await ScanThemeForNubesdkSlots(
			root,
			cat,
			() => {},
		);
		expect(tplFilesAnalyzed).toBe(1);
		expect(found.has("before_product_detail_price")).toBe(true);
	});

	it("detects component('nubesdk-slot', { type }) as in Amazonas themes", () => {
		const content =
			"{{ component('nubesdk-slot', { type: \"before_product_detail_price\" }) }}";
		const cat = LoadSlotCatalog();
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(content, cat, scan);
		const found = MergeScanIntoFoundSet(cat, scan);
		expect(found.has("before_product_detail_price")).toBe(true);
	});

	it("detects component with double-quoted nubesdk-slot name", () => {
		const content = '{{ component("nubesdk-slot", { type: "after_header" }) }}';
		const cat = LoadSlotCatalog();
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(content, cat, scan);
		const found = MergeScanIntoFoundSet(cat, scan);
		expect(found.has("after_header")).toBe(true);
	});

	it("expands product_detail_image group from component() type", () => {
		const content =
			"{{ component('nubesdk-slot', { type: \"product_detail_image\" }) }}";
		const cat = LoadSlotCatalog();
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(content, cat, scan);
		const found = MergeScanIntoFoundSet(cat, scan);
		expect(found.has("product_detail_image_top_left")).toBe(true);
		expect(found.has("product_detail_image_center_center")).toBe(true);
	});

	it("expands before_section_products_ dynamic Twig type to all catalog section slots", () => {
		const content = `{{ component('nubesdk-slot', { type: 'before_section_products_' ~ data_store_name }) }}`;
		const cat = LoadSlotCatalog();
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(content, cat, scan);
		const found = MergeScanIntoFoundSet(cat, scan);
		expect(found.has("before_section_products_sale")).toBe(true);
	});

	it("does not map deprecated DOM to legacy coverage when canonical is missing from catalog", () => {
		const badCatalog = {
			groups: {
				other: { slotNames: ["other_slot"] },
			},
			legacyTypeToGroup: {},
			deprecatedSlotToCanonical: {
				legacy_dom_only: "not_in_catalog_anywhere",
			},
		} as NubesdkSlotCatalog;
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(
			'<div data-nubesdk-slot="legacy_dom_only"></div>',
			badCatalog,
			scan,
		);
		expect(scan.legacyDomByCanonical.size).toBe(0);
		expect(
			scan.unknownUnresolved.has(
				`${UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX}legacy_dom_only`,
			),
		).toBe(true);
	});

	it("maps deprecated data-nubesdk-slot to canonical without unknown sentinel", () => {
		const content =
			'<div data-nubesdk-slot="after_add_to_cart_pdp" class="js-nubesdk-slot"></div>';
		const cat = LoadSlotCatalog();
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(content, cat, scan);
		expect(scan.directCanonical.has("after_product_detail_add_to_cart")).toBe(
			false,
		);
		expect(
			scan.legacyDomByCanonical.get("after_product_detail_add_to_cart"),
		).toBe("after_add_to_cart_pdp");
		const found = MergeScanIntoFoundSet(cat, scan);
		expect(found.has("after_product_detail_add_to_cart")).toBe(true);
		expect(
			found.has(`${UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX}after_add_to_cart_pdp`),
		).toBe(false);
	});

	it("expands legacy include type to group slots", async () => {
		const root = path.join(__dirname, "__fixtures__/legacy-include");
		const cat = LoadSlotCatalog();
		const { found, tplFilesAnalyzed } = await ScanThemeForNubesdkSlots(
			root,
			cat,
			() => {},
		);
		expect(tplFilesAnalyzed).toBe(1);
		expect(found.has("after_product_detail_price")).toBe(true);
	});

	it("records unknown data-nubesdk-slot literal with sentinel prefix", () => {
		const content = '<div data-nubesdk-slot="not_a_catalog_slot_xyz"></div>';
		const cat = LoadSlotCatalog();
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(content, cat, scan);
		const found = MergeScanIntoFoundSet(cat, scan);
		expect(
			found.has(`${UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX}not_a_catalog_slot_xyz`),
		).toBe(true);
	});

	it("records unresolvable component type with sentinel prefix", () => {
		const content =
			"{{ component('nubesdk-slot', { type: \"fake_type_for_test\" }) }}";
		const cat = LoadSlotCatalog();
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(content, cat, scan);
		const found = MergeScanIntoFoundSet(cat, scan);
		expect(
			found.has(`${UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX}fake_type_for_test`),
		).toBe(true);
	});

	it("records unresolvable include type with sentinel prefix", () => {
		const content =
			"{% include 'snipplets/nubesdk-slot.tpl' with { type: 'another_fake_type' } %}";
		const cat = LoadSlotCatalog();
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(content, cat, scan);
		const found = MergeScanIntoFoundSet(cat, scan);
		expect(
			found.has(`${UNKNOWN_NUBESDK_SLOT_ENTRY_PREFIX}another_fake_type`),
		).toBe(true);
	});

	it("treats product_grid_item_image slots as found when theme uses platform product-item-image only", async () => {
		const root = path.join(__dirname, "__fixtures__/product-item-image-slot");
		const cat = LoadSlotCatalog();
		const {
			found,
			directCanonical,
			indirectViaProductItemImage,
			tplFilesAnalyzed,
		} = await ScanThemeForNubesdkSlots(root, cat, () => {});
		expect(tplFilesAnalyzed).toBe(1);
		expect(found.has("product_grid_item_image_top_left")).toBe(true);
		expect(directCanonical.has("product_grid_item_image_top_left")).toBe(false);
		expect(
			indirectViaProductItemImage.has("product_grid_item_image_top_left"),
		).toBe(true);
	});

	it("does not mark grid image slots indirect when nubesdk-slot is present in theme", async () => {
		const root = path.join(
			__dirname,
			"__fixtures__/product-item-image-with-nubesdk",
		);
		const cat = LoadSlotCatalog();
		const { directCanonical, indirectViaProductItemImage, tplFilesAnalyzed } =
			await ScanThemeForNubesdkSlots(root, cat, () => {});
		expect(tplFilesAnalyzed).toBe(1);
		expect(directCanonical.has("product_grid_item_image_top_left")).toBe(true);
		expect(
			indirectViaProductItemImage.has("product_grid_item_image_top_left"),
		).toBe(false);
	});

	it("detects platform product-item-image with double-quoted component name", () => {
		const content =
			'{{ component("product-item-image", { image_lazy: true }) }}';
		const cat = LoadSlotCatalog();
		const scan = createNubesdkThemeSlotScan();
		CollectSlotsFromTplContent(content, cat, scan);
		MergeScanIntoFoundSet(cat, scan);
		expect(scan.usesPlatformProductItemImage).toBe(true);
		expect(scan.indirectViaProductItemImage.size).toBeGreaterThan(0);
	});
});
