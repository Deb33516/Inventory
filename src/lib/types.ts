export type UserRole =
  | "customer"
  | "sales_staff"
  | "inventory_staff"
  | "admin"
  | "super_admin";

export type MovementType = "restock" | "sale" | "adjustment" | "damaged" | "return";

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "processing"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "refunded";

export type PaymentMethod = "card" | "upi" | "cash" | "bank_transfer";

export interface CartItem {
  productId: string;
  sku: string;
  name: string;
  price: number;
  quantity: number;
}
