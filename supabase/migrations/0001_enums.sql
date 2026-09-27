-- Phase 3: enums shared across the schema.

create type public.user_role as enum (
  'customer',
  'sales_staff',
  'inventory_staff',
  'admin',
  'super_admin'
);

create type public.order_status as enum (
  'pending',
  'confirmed',
  'processing',
  'shipped',
  'delivered',
  'cancelled',
  'refunded'
);

create type public.payment_method as enum (
  'card',
  'upi',
  'cash',
  'bank_transfer'
);

create type public.payment_status as enum (
  'pending',
  'paid',
  'failed',
  'refunded'
);

create type public.movement_type as enum (
  'restock',
  'sale',
  'adjustment',
  'damaged',
  'return'
);

create type public.approval_action_type as enum (
  'delete_product',
  'deactivate_staff',
  'change_role',
  'cancel_paid_order',
  'refund_payment',
  'inventory_adjustment'
);

create type public.approval_status as enum (
  'pending',
  'approved',
  'rejected'
);
