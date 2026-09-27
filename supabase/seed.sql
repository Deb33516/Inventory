-- Phase 3 seed data — minimal, clearly-test data for local/dev use.
-- Not a migration: safe to re-run against a fresh project, but will
-- fail on unique-constraint conflicts if run twice against the same one.

insert into public.categories (name, slug, description) values
  ('Electronics', 'electronics', 'Devices and accessories'),
  ('Home & Kitchen', 'home-kitchen', 'Household and kitchen goods'),
  ('Office Supplies', 'office-supplies', 'Stationery and office equipment');

insert into public.suppliers (name, contact_name, email, phone) values
  ('Northwind Distributors', 'Priya Sharma', 'priya@northwind.example.test', '+91-9000000000');

insert into public.products (sku, name, description, category_id, price, cost, is_active)
select v.sku, v.name, v.description, c.id, v.price, v.cost, true
from (values
  ('ELEC-001', 'Wireless Mouse', 'Ergonomic 2.4GHz wireless mouse', 'electronics', 799.00, 420.00),
  ('ELEC-002', 'USB-C Hub', '6-in-1 USB-C hub with HDMI', 'electronics', 1899.00, 1100.00),
  ('HOME-001', 'Ceramic Mug Set', 'Set of 4 ceramic mugs', 'home-kitchen', 599.00, 280.00),
  ('OFFICE-001', 'Notebook Pack', 'Pack of 3 ruled notebooks', 'office-supplies', 249.00, 110.00)
) as v(sku, name, description, category_slug, price, cost)
join public.categories c on c.slug = v.category_slug;

-- OFFICE-001 is deliberately below its reorder level, to exercise the
-- low-stock partial index / dashboard widget logic later.
insert into public.inventory (product_id, quantity_on_hand, reorder_level)
select p.id, v.qty, v.reorder
from (values
  ('ELEC-001', 40, 10),
  ('ELEC-002', 15, 10),
  ('HOME-001', 60, 15),
  ('OFFICE-001', 5, 20)
) as v(sku, qty, reorder)
join public.products p on p.sku = v.sku;
