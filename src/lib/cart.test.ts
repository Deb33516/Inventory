import { describe, it, expect, beforeEach } from "vitest";
import { addToCart, updateCartQuantity, removeFromCart, clearCart, getCart, getCartCount } from "./cart";

const item = { productId: "p1", sku: "SKU-1", name: "Widget", price: 100 };
const item2 = { productId: "p2", sku: "SKU-2", name: "Gadget", price: 50 };

describe("cart (localStorage-backed)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty", () => {
    expect(getCart()).toEqual([]);
    expect(getCartCount()).toBe(0);
  });

  it("adds a new item with the given quantity", () => {
    addToCart(item, 2);
    expect(getCart()).toEqual([{ ...item, quantity: 2 }]);
  });

  it("increments quantity when adding an already-present product", () => {
    addToCart(item, 1);
    addToCart(item, 3);
    expect(getCart()).toEqual([{ ...item, quantity: 4 }]);
  });

  it("keeps separate line items for different products", () => {
    addToCart(item, 1);
    addToCart(item2, 2);
    expect(getCart()).toHaveLength(2);
    expect(getCartCount()).toBe(3);
  });

  it("updateCartQuantity sets an exact quantity", () => {
    addToCart(item, 1);
    updateCartQuantity(item.productId, 5);
    expect(getCart()).toEqual([{ ...item, quantity: 5 }]);
  });

  it("updateCartQuantity removes the line when quantity drops to 0 or below", () => {
    addToCart(item, 1);
    updateCartQuantity(item.productId, 0);
    expect(getCart()).toEqual([]);
  });

  it("removeFromCart removes only the targeted product", () => {
    addToCart(item, 1);
    addToCart(item2, 1);
    removeFromCart(item.productId);
    expect(getCart()).toEqual([{ ...item2, quantity: 1 }]);
  });

  it("clearCart empties the cart", () => {
    addToCart(item, 1);
    addToCart(item2, 1);
    clearCart();
    expect(getCart()).toEqual([]);
  });

  it("getCart recovers gracefully from corrupted storage", () => {
    localStorage.setItem("cart", "{not valid json");
    expect(getCart()).toEqual([]);
  });

  it("getCart recovers gracefully from a non-array stored value", () => {
    localStorage.setItem("cart", JSON.stringify({ not: "an array" }));
    expect(getCart()).toEqual([]);
  });
});
