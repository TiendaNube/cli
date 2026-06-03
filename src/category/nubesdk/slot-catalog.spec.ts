import { describe, expect, it } from "vitest";
import {
	GetAllSlotNamesSorted,
	IsCatalogSlotName,
	ListSectionProductsTypesForDynamicPrefix,
	LoadSlotCatalog,
	ResolveTypeToSlotNames,
} from "./slot-catalog";

describe("slot-catalog", () => {
	it("loads after_product_detail_add_to_cart group with canonical slot only", () => {
		const cat = LoadSlotCatalog();
		expect(cat.groups.after_product_detail_add_to_cart?.slotNames).toEqual([
			"after_product_detail_add_to_cart",
		]);
	});

	it("resolves legacy product-after-add-to-cart to canonical PDP add-to-cart slot", () => {
		const cat = LoadSlotCatalog();
		expect(ResolveTypeToSlotNames(cat, "product-after-add-to-cart")).toEqual([
			"after_product_detail_add_to_cart",
		]);
	});

	it("resolves legacy after_add_to_cart_pdp type to canonical slot", () => {
		const cat = LoadSlotCatalog();
		expect(ResolveTypeToSlotNames(cat, "after_add_to_cart_pdp")).toEqual([
			"after_product_detail_add_to_cart",
		]);
	});

	it("lists section product types for Twig dynamic prefix", () => {
		const cat = LoadSlotCatalog();
		const types = ListSectionProductsTypesForDynamicPrefix(
			cat,
			"before_section_products_",
		).sort((a, b) => a.localeCompare(b));
		expect(types).toEqual(["before_section_products_sale"]);
	});

	it("still expands by group key when the key is also a slot name (e.g. before_footer)", () => {
		const cat = LoadSlotCatalog();
		expect(ResolveTypeToSlotNames(cat, "before_footer")).toEqual([
			"before_footer",
		]);
	});

	it("GetAllSlotNamesSorted returns sorted unique names", () => {
		const cat = LoadSlotCatalog();
		const names = GetAllSlotNamesSorted(cat);
		expect(names.length).toBeGreaterThan(40);
		expect(new Set(names).size).toBe(names.length);
		const sorted = [...names].sort((a, b) => a.localeCompare(b));
		expect(names).toEqual(sorted);
	});

	it("IsCatalogSlotName is true for a declared slot and false for typos", () => {
		const cat = LoadSlotCatalog();
		expect(IsCatalogSlotName(cat, "after_header")).toBe(true);
		expect(IsCatalogSlotName(cat, "after_headr_typo")).toBe(false);
	});

	it("does not list deprecated DOM-only aliases as required slot names", () => {
		const cat = LoadSlotCatalog();
		const names = GetAllSlotNamesSorted(cat);
		expect(names).not.toContain("after_add_to_cart_pdp");
		expect(names).not.toContain("before_add_to_cart_pdp");
	});
});
