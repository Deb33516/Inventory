export type UserRole =
  | "customer"
  | "sales_staff"
  | "inventory_staff"
  | "admin"
  | "super_admin";

export type MovementType = "restock" | "sale" | "adjustment" | "damaged" | "return";
