// Client-side only — the cart is a deliberate exception to "no
// client-side state management": a persisted server-side cart table
// would mean a new table + its own RLS purely to hold pre-checkout,
// throwaway state. Every function here assumes it's running in the
// browser (called only from <script> tags, never from Astro frontmatter).
import type { CartItem } from "./types";

const STORAGE_KEY = "cart";

export function getCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setCart(items: CartItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // ignore — private browsing / storage disabled
  }
}

export function addToCart(item: Omit<CartItem, "quantity">, quantity = 1) {
  const items = getCart();
  const existing = items.find((i) => i.productId === item.productId);

  if (existing) {
    existing.quantity += quantity;
  } else {
    items.push({ ...item, quantity });
  }

  setCart(items);
  return items;
}

export function updateCartQuantity(productId: string, quantity: number) {
  const items = getCart();
  const next =
    quantity <= 0
      ? items.filter((i) => i.productId !== productId)
      : items.map((i) => (i.productId === productId ? { ...i, quantity } : i));
  setCart(next);
  return next;
}

export function removeFromCart(productId: string) {
  const next = getCart().filter((i) => i.productId !== productId);
  setCart(next);
  return next;
}

export function clearCart() {
  setCart([]);
}

export function getCartCount(): number {
  return getCart().reduce((sum, i) => sum + i.quantity, 0);
}
