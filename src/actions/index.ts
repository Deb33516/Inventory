import { defineAction, ActionError } from "astro:actions";
import { z } from "astro/zod";
import { createClient } from "../lib/supabase/server";
import { createAdminClient } from "../lib/supabase/admin";
import { ROLE_DASHBOARD } from "../lib/roles";
import type { UserRole } from "../lib/types";

// Astro's form-to-object conversion fills any declared field missing from
// FormData with null (rather than omitting the key), and a present-but-empty
// text input submits "" — normalize both to undefined before zod's
// .optional() sees them.
const emptyToUndefined = (value: unknown) =>
  value === "" || value === null ? undefined : value;

export const server = {
  signUp: defineAction({
    accept: "form",
    input: z.object({
      fullName: z.string().min(1, "Full name is required"),
      email: z.string().email("Enter a valid email address"),
      password: z.string().min(8, "Password must be at least 8 characters"),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { error } = await supabase.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: { full_name: input.fullName },
          emailRedirectTo: new URL("/auth/callback?next=/account", context.url.origin).toString(),
        },
      });

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return {
        message: "Check your email to confirm your account before signing in.",
      };
    },
  }),

  signIn: defineAction({
    accept: "form",
    input: z.object({
      email: z.string().email("Enter a valid email address"),
      password: z.string().min(1, "Password is required"),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { error } = await supabase.auth.signInWithPassword({
        email: input.email,
        password: input.password,
      });

      if (error) {
        throw new ActionError({ code: "UNAUTHORIZED", message: error.message });
      }

      // Role-aware default landing destination — an explicit ?redirect= (if
      // any) is applied client-side, in preference to this, by login.astro.
      // customer intentionally falls back to /account even if the profile
      // lookup fails, since that's already every existing user's default.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user!.id)
        .single();

      const role = (profile?.role as UserRole) ?? "customer";
      const redirectTo = role === "customer" ? "/account" : ROLE_DASHBOARD[role];

      return { message: "Signed in.", redirectTo };
    },
  }),

  signOut: defineAction({
    handler: async (_input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      await supabase.auth.signOut();

      return { message: "Signed out." };
    },
  }),

  requestPasswordReset: defineAction({
    accept: "form",
    input: z.object({
      email: z.string().email("Enter a valid email address"),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      // Always report success, regardless of whether the email exists, so
      // this endpoint can't be used to enumerate registered accounts.
      // Supabase doesn't error for a nonexistent email — any error here is
      // an unexpected delivery/config problem, so log it for observability
      // without changing the generic response below.
      const { error } = await supabase.auth.resetPasswordForEmail(input.email, {
        redirectTo: new URL(
          "/auth/callback?next=/reset-password",
          context.url.origin
        ).toString(),
      });

      if (error) {
        console.error("resetPasswordForEmail failed:", error.message);
      }

      return {
        message: "If an account exists for that email, a reset link is on its way.",
      };
    },
  }),

  updatePassword: defineAction({
    accept: "form",
    input: z
      .object({
        password: z.string().min(8, "Password must be at least 8 characters"),
        confirmPassword: z.string(),
      })
      .refine((data) => data.password === data.confirmPassword, {
        message: "Passwords do not match",
        path: ["confirmPassword"],
      }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      // Requires an active recovery session, established by verifying the
      // reset link in src/pages/auth/callback.astro.
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new ActionError({
          code: "UNAUTHORIZED",
          message: "Your password reset link has expired. Request a new one.",
        });
      }

      const { error } = await supabase.auth.updateUser({
        password: input.password,
      });

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Password updated. You can now sign in." };
    },
  }),

  createProduct: defineAction({
    accept: "form",
    input: z.object({
      sku: z.string().min(1, "SKU is required"),
      name: z.string().min(1, "Name is required"),
      description: z.preprocess(emptyToUndefined, z.string().optional()),
      categoryId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
      price: z.coerce.number().min(0, "Price must be 0 or more"),
      cost: z.preprocess(
        emptyToUndefined,
        z.coerce.number().min(0, "Cost must be 0 or more").optional()
      ),
      imageUrl: z.preprocess(
        emptyToUndefined,
        z.string().url("Enter a valid URL").optional()
      ),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { data, error } = await supabase
        .from("products")
        .insert({
          sku: input.sku,
          name: input.name,
          description: input.description ?? null,
          category_id: input.categoryId ?? null,
          price: input.price,
          cost: input.cost ?? null,
          image_url: input.imageUrl ?? null,
        })
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") {
          throw new ActionError({
            code: "CONFLICT",
            message: "That SKU is already in use.",
          });
        }
        // category_id references categories ON DELETE — if the selected
        // category was deleted between page load and submit, the FK check
        // fails here instead of raising a raw Postgres constraint error.
        if (error.code === "23503") {
          throw new ActionError({
            code: "CONFLICT",
            message: "The selected category no longer exists. Refresh the page and choose another.",
          });
        }
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Product created.", id: data.id };
    },
  }),

  updateProduct: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().uuid(),
      sku: z.string().min(1, "SKU is required"),
      name: z.string().min(1, "Name is required"),
      description: z.preprocess(emptyToUndefined, z.string().optional()),
      categoryId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
      price: z.coerce.number().min(0, "Price must be 0 or more"),
      cost: z.preprocess(
        emptyToUndefined,
        z.coerce.number().min(0, "Cost must be 0 or more").optional()
      ),
      imageUrl: z.preprocess(
        emptyToUndefined,
        z.string().url("Enter a valid URL").optional()
      ),
      isActive: z.preprocess(emptyToUndefined, z.coerce.boolean().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { error } = await supabase
        .from("products")
        .update({
          sku: input.sku,
          name: input.name,
          description: input.description ?? null,
          category_id: input.categoryId ?? null,
          price: input.price,
          cost: input.cost ?? null,
          image_url: input.imageUrl ?? null,
          is_active: Boolean(input.isActive),
        })
        .eq("id", input.id);

      if (error) {
        if (error.code === "23505") {
          throw new ActionError({
            code: "CONFLICT",
            message: "That SKU is already in use.",
          });
        }
        // category_id references categories ON DELETE — if the selected
        // category was deleted between page load and submit, the FK check
        // fails here instead of raising a raw Postgres constraint error.
        if (error.code === "23503") {
          throw new ActionError({
            code: "CONFLICT",
            message: "The selected category no longer exists. Refresh the page and choose another.",
          });
        }
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Product updated." };
    },
  }),

  createCategory: defineAction({
    accept: "form",
    input: z.object({
      name: z.string().min(1, "Name is required"),
      slug: z
        .string()
        .min(1, "Slug is required")
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only"),
      description: z.preprocess(emptyToUndefined, z.string().optional()),
      parentId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      // Parent-category rules: only a top-level category (parent_id null)
      // may be selected as a parent. A category cannot be its own parent
      // is enforced in updateCategory, where the row already exists.
      if (input.parentId) {
        const { data: parent } = await supabase
          .from("categories")
          .select("id, parent_id")
          .eq("id", input.parentId)
          .maybeSingle();

        if (!parent) {
          throw new ActionError({
            code: "BAD_REQUEST",
            message: "Selected parent category was not found.",
          });
        }
        if (parent.parent_id !== null) {
          throw new ActionError({
            code: "BAD_REQUEST",
            message: "Only a top-level category can be selected as a parent.",
          });
        }
      }

      const { error } = await supabase.from("categories").insert({
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        parent_id: input.parentId ?? null,
      });

      if (error) {
        if (error.code === "23505") {
          throw new ActionError({
            code: "CONFLICT",
            message: "A category with that name or slug already exists.",
          });
        }
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Category created." };
    },
  }),

  updateCategory: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().uuid(),
      name: z.string().min(1, "Name is required"),
      slug: z
        .string()
        .min(1, "Slug is required")
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only"),
      description: z.preprocess(emptyToUndefined, z.string().optional()),
      parentId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      if (input.parentId) {
        // A category cannot be its own parent.
        if (input.parentId === input.id) {
          throw new ActionError({
            code: "BAD_REQUEST",
            message: "A category cannot be its own parent.",
          });
        }

        // Only a top-level category can be selected as a parent — which
        // also covers "a category that already has a parent cannot itself
        // be selected as a parent" (having a parent means parent_id isn't
        // null, so it fails this same check).
        const { data: parent } = await supabase
          .from("categories")
          .select("id, parent_id")
          .eq("id", input.parentId)
          .maybeSingle();

        if (!parent) {
          throw new ActionError({
            code: "BAD_REQUEST",
            message: "Selected parent category was not found.",
          });
        }
        if (parent.parent_id !== null) {
          throw new ActionError({
            code: "BAD_REQUEST",
            message: "Only a top-level category can be selected as a parent.",
          });
        }
      }

      const { error } = await supabase
        .from("categories")
        .update({
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          parent_id: input.parentId ?? null,
        })
        .eq("id", input.id);

      if (error) {
        if (error.code === "23505") {
          throw new ActionError({
            code: "CONFLICT",
            message: "A category with that name or slug already exists.",
          });
        }
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Category updated." };
    },
  }),

  recordInventoryMovement: defineAction({
    accept: "form",
    input: z
      .object({
        productId: z.string().uuid(),
        movementType: z.enum(["restock", "adjustment", "damaged"]),
        quantity: z.coerce
          .number()
          .int("Quantity must be a whole number")
          .refine((v) => v !== 0, "Quantity cannot be zero"),
        reason: z.preprocess(emptyToUndefined, z.string().optional()),
        supplierId: z.preprocess(emptyToUndefined, z.string().uuid().optional()),
      })
      .refine(
        (data) => data.movementType !== "restock" || data.quantity > 0,
        { message: "Restock quantity must be positive", path: ["quantity"] }
      )
      .refine(
        (data) =>
          data.movementType === "restock" ||
          (data.reason !== undefined && data.reason.trim().length > 0),
        { message: "A reason is required for adjustments and damaged stock", path: ["reason"] }
      ),
    // Business rules (positive restock, non-zero adjustment, forced-negative
    // damaged, reason required, no order references) are enforced again,
    // authoritatively, inside record_inventory_movement() — this validation
    // exists only to give a fast, friendly error before the round trip.
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { data, error } = await supabase.rpc("record_inventory_movement", {
        p_product_id: input.productId,
        p_movement_type: input.movementType,
        p_quantity_delta: input.quantity,
        p_reason: input.reason ?? null,
        p_supplier_id: input.movementType === "restock" ? input.supplierId ?? null : null,
        p_reference_order_id: null,
      });

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Stock updated.", inventory: data };
    },
  }),

  updateReorderLevel: defineAction({
    accept: "form",
    input: z.object({
      productId: z.string().uuid(),
      reorderLevel: z.coerce.number().int().min(0, "Reorder level must be 0 or more"),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { error } = await supabase
        .from("inventory")
        .update({ reorder_level: input.reorderLevel })
        .eq("product_id", input.productId);

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Reorder level updated." };
    },
  }),

  createSupplier: defineAction({
    accept: "form",
    input: z.object({
      name: z.string().min(1, "Name is required"),
      contactName: z.preprocess(emptyToUndefined, z.string().optional()),
      email: z.preprocess(emptyToUndefined, z.string().email("Enter a valid email address").optional()),
      phone: z.preprocess(emptyToUndefined, z.string().optional()),
      address: z.preprocess(emptyToUndefined, z.string().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { error } = await supabase.from("suppliers").insert({
        name: input.name,
        contact_name: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
      });

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Supplier created." };
    },
  }),

  updateSupplier: defineAction({
    accept: "form",
    input: z.object({
      id: z.string().uuid(),
      name: z.string().min(1, "Name is required"),
      contactName: z.preprocess(emptyToUndefined, z.string().optional()),
      email: z.preprocess(emptyToUndefined, z.string().email("Enter a valid email address").optional()),
      phone: z.preprocess(emptyToUndefined, z.string().optional()),
      address: z.preprocess(emptyToUndefined, z.string().optional()),
      isActive: z.preprocess(emptyToUndefined, z.coerce.boolean().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { error } = await supabase
        .from("suppliers")
        .update({
          name: input.name,
          contact_name: input.contactName ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          address: input.address ?? null,
          is_active: Boolean(input.isActive),
        })
        .eq("id", input.id);

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Supplier updated." };
    },
  }),

  updateCustomerProfile: defineAction({
    accept: "form",
    input: z.object({
      fullName: z.string().min(1, "Full name is required"),
      phone: z.preprocess(emptyToUndefined, z.string().optional()),
      billingAddress: z.preprocess(emptyToUndefined, z.string().optional()),
      shippingAddress: z.preprocess(emptyToUndefined, z.string().optional()),
      marketingOptIn: z.preprocess(emptyToUndefined, z.coerce.boolean().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." });
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: input.fullName, phone: input.phone ?? null })
        .eq("id", user.id);

      if (profileError) {
        throw new ActionError({ code: "BAD_REQUEST", message: profileError.message });
      }

      const { error: customerError } = await supabase
        .from("customers")
        .update({
          billing_address: input.billingAddress ? { formatted: input.billingAddress } : null,
          shipping_address: input.shippingAddress ? { formatted: input.shippingAddress } : null,
          marketing_opt_in: Boolean(input.marketingOptIn),
        })
        .eq("profile_id", user.id);

      if (customerError) {
        throw new ActionError({ code: "BAD_REQUEST", message: customerError.message });
      }

      return { message: "Profile updated." };
    },
  }),

  updateCustomerNotes: defineAction({
    accept: "form",
    input: z.object({
      profileId: z.string().uuid(),
      notes: z.preprocess(emptyToUndefined, z.string().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        throw new ActionError({ code: "UNAUTHORIZED", message: "You must be signed in." });
      }

      // customer_notes RLS enforces this independently now (staff-only,
      // target must be role='customer'), but this explicit check still
      // gives a fast, friendly error instead of a generic RLS failure.
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

      const staffRoles: UserRole[] = ["sales_staff", "admin", "super_admin"];

      if (!profile || !staffRoles.includes(profile.role as UserRole)) {
        throw new ActionError({ code: "FORBIDDEN", message: "Only staff can edit customer notes." });
      }

      const trimmedNote = input.notes?.trim();

      const { data: existing } = await supabase
        .from("customer_notes")
        .select("id")
        .eq("customer_id", input.profileId)
        .maybeSingle();

      // A blank note clears it — delete the row rather than storing an
      // empty string, since customer_notes.note is check-constrained to
      // be non-blank ("no notes yet" is "no row").
      if (!trimmedNote) {
        if (existing) {
          const { error: deleteError } = await supabase
            .from("customer_notes")
            .delete()
            .eq("customer_id", input.profileId);

          if (deleteError) {
            throw new ActionError({ code: "BAD_REQUEST", message: deleteError.message });
          }
        }

        return { message: "Notes updated." };
      }

      const { error } = existing
        ? await supabase
            .from("customer_notes")
            .update({ note: trimmedNote })
            .eq("customer_id", input.profileId)
        : await supabase
            .from("customer_notes")
            .insert({ customer_id: input.profileId, note: trimmedNote, created_by: user.id });

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Notes updated." };
    },
  }),

  placeOrder: defineAction({
    input: z.object({
      customerId: z.string().uuid(),
      items: z
        .array(
          z.object({
            productId: z.string().uuid(),
            quantity: z.number().int().positive(),
          })
        )
        .min(1, "Add at least one item"),
      shippingAddress: z.string().min(1, "Shipping address is required"),
      paymentMethod: z.enum(["card", "upi", "cash", "bank_transfer"]),
      notes: z.preprocess(emptyToUndefined, z.string().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { data, error } = await supabase.rpc("place_order", {
        p_customer_id: input.customerId,
        p_items: input.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
        p_shipping_address: { formatted: input.shippingAddress },
        p_payment_method: input.paymentMethod,
        p_notes: input.notes ?? null,
      });

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Order placed.", order: data };
    },
  }),

  updateOrderStatus: defineAction({
    input: z.object({
      orderId: z.string().uuid(),
      newStatus: z.enum([
        "pending",
        "confirmed",
        "processing",
        "shipped",
        "delivered",
        "cancelled",
        "refunded",
      ]),
      reason: z.preprocess(emptyToUndefined, z.string().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { data, error } = await supabase.rpc("update_order_status", {
        p_order_id: input.orderId,
        p_new_status: input.newStatus,
        p_reason: input.reason ?? null,
      });

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Order updated.", order: data };
    },
  }),

  // Direct delete — super_admin only, relying entirely on the new
  // products_delete_super_admin RLS policy. inventory_staff/admin no
  // longer have this capability at all (RLS-enforced); they use
  // requestApproval instead.
  deleteProduct: defineAction({
    input: z.object({
      productId: z.string().uuid(),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { error } = await supabase.from("products").delete().eq("id", input.productId);

      if (error) {
        // order_items/inventory_movements reference products ON DELETE
        // RESTRICT — without this, a product with history would surface a
        // raw Postgres constraint-name error instead of this friendly one.
        if (error.code === "23503") {
          throw new ActionError({
            code: "CONFLICT",
            message: "This product has order or movement history and cannot be deleted.",
          });
        }
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Product deleted." };
    },
  }),

  requestApproval: defineAction({
    input: z.object({
      actionType: z.enum([
        "delete_product",
        "deactivate_staff",
        "change_role",
        "cancel_paid_order",
        "refund_payment",
      ]),
      targetTable: z.enum(["products", "profiles", "orders", "payments"]),
      targetId: z.string().uuid(),
      reason: z.string().min(1, "A reason is required"),
      newRole: z.preprocess(emptyToUndefined, z.string().optional()),
    }),
    // All authorization, target/action_type mapping, and business-rule
    // validation happens authoritatively inside create_approval_request()
    // — this is just a thin, typed pass-through.
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { data, error } = await supabase.rpc("create_approval_request", {
        p_action_type: input.actionType,
        p_target_table: input.targetTable,
        p_target_id: input.targetId,
        p_reason: input.reason,
        p_payload: input.newRole ? { new_role: input.newRole } : {},
      });

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Approval request submitted.", request: data };
    },
  }),

  reviewApprovalRequest: defineAction({
    input: z.object({
      requestId: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      reviewNote: z.preprocess(emptyToUndefined, z.string().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { data, error } = await supabase.rpc("review_approval_request", {
        p_request_id: input.requestId,
        p_decision: input.decision,
        p_review_note: input.reviewNote ?? null,
      });

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: input.decision === "approved" ? "Request approved." : "Request rejected.", request: data };
    },
  }),

  // Direct staff edit — super_admin only, relying entirely on the existing,
  // unrestricted profiles_update_super_admin RLS policy (unchanged since
  // Phase 3). Deliberately not routed through the approval workflow: that
  // gate is for admin/sales_staff/inventory_staff delegating a sensitive
  // change upward, not for super_admin's own already-unilateral capability.
  updateStaffProfile: defineAction({
    input: z.object({
      profileId: z.string().uuid(),
      isActive: z.boolean().optional(),
      newRole: z.enum(["sales_staff", "inventory_staff", "admin"]).optional(),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const update: Record<string, unknown> = {};
      if (input.isActive !== undefined) update.is_active = input.isActive;
      if (input.newRole !== undefined) update.role = input.newRole;

      if (Object.keys(update).length === 0) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Nothing to update." });
      }

      const { error } = await supabase.from("profiles").update(update).eq("id", input.profileId);

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Profile updated." };
    },
  }),

  // Provisions a brand-new staff/admin account. Direct (not approval-gated)
  // for both admin and super_admin — Phase 9's approval gate is reserved for
  // actions with an existing victim or irreversible loss (deleting a product
  // with history, reassigning/deactivating an existing person's access,
  // cancelling/refunding a real paid order); provisioning a brand-new
  // account is additive and fully reversible via the existing direct
  // deactivate/role-change controls on this same page. super_admin is not a
  // selectable role here — not a runtime check, a closed zod enum, so it
  // cannot reach the handler as a value at all.
  inviteStaff: defineAction({
    accept: "form",
    input: z.object({
      fullName: z.string().min(1, "Full name is required"),
      email: z.string().email("Enter a valid email address"),
      role: z.enum(["sales_staff", "inventory_staff", "admin"]),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      // The only authorization backstop for this action: the service-role
      // client used below bypasses RLS entirely, so this explicit,
      // server-derived (never client-supplied) role check is load-bearing,
      // not a "friendly error" convenience like elsewhere in this file.
      const callerRole = context.locals.role;
      if (callerRole !== "admin" && callerRole !== "super_admin") {
        throw new ActionError({ code: "FORBIDDEN", message: "Only admin or super admin can invite staff." });
      }

      const adminClient = createAdminClient();

      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(input.email, {
        data: { full_name: input.fullName },
        redirectTo: new URL(
          `/auth/callback?next=${encodeURIComponent("/reset-password")}`,
          context.url.origin
        ).toString(),
      });

      if (error) {
        if (error.status === 422 || /already been registered|already exists/i.test(error.message)) {
          throw new ActionError({ code: "CONFLICT", message: "That email is already registered." });
        }
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      // handle_new_user() has already run synchronously inside the insert
      // above and created a profiles row defaulted to role='customer' — this
      // is the one write in the whole action that deliberately bypasses RLS,
      // scoped to exactly the row just created, never a client-supplied id.
      const { error: roleError } = await adminClient
        .from("profiles")
        .update({ role: input.role })
        .eq("id", data.user.id);

      if (roleError) {
        throw new ActionError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Invitation email was sent, but assigning the role failed. Use the role dropdown on this page to fix it once the account appears.",
        });
      }

      await supabase.from("audit_logs").insert({
        actor_id: context.locals.user!.id,
        action: "staff_invited",
        entity_table: "profiles",
        entity_id: data.user.id,
        new_value: { role: input.role, email: input.email },
      });

      return { message: "Invitation sent." };
    },
  }),

  // "Report an issue" — any of customer/inventory_staff/admin/super_admin
  // reporting their own issue. RLS (support_tickets_insert_own) is the real
  // backstop; created_by is always the caller's own id, never client-chosen.
  createSupportTicket: defineAction({
    accept: "form",
    input: z.object({
      subject: z.string().min(1, "Subject is required"),
      description: z.string().min(1, "Description is required"),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { data, error } = await supabase
        .from("support_tickets")
        .insert({
          created_by: context.locals.user!.id,
          subject: input.subject,
          description: input.description,
        })
        .select("id")
        .single();

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      return { message: "Issue reported.", id: data.id };
    },
  }),

  // inventory_staff adding operational notes/resolution and advancing
  // status on a ticket assigned to them. RLS (support_tickets_update_
  // assigned_staff) rejects this outright for any ticket not currently
  // assigned to the caller — this handler never checks that itself, the
  // update simply affects 0 rows and surfaces as a friendly error below.
  updateSupportTicket: defineAction({
    accept: "form",
    input: z.object({
      ticketId: z.string().uuid(),
      status: z.enum(["open", "in_progress", "waiting", "resolved", "closed"]),
      resolution: z.preprocess(emptyToUndefined, z.string().optional()),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const { data, error } = await supabase
        .from("support_tickets")
        .update({ status: input.status, resolution: input.resolution ?? null })
        .eq("id", input.ticketId)
        .select("id")
        .maybeSingle();

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      if (!data) {
        throw new ActionError({
          code: "FORBIDDEN",
          message: "This ticket isn't assigned to you.",
        });
      }

      return { message: "Ticket updated." };
    },
  }),

  // Admin Settings (real MVP pass). Deliberately NOT accept:"form" — the
  // low-stock toggle is called as a plain instant-apply object (no form
  // around it at all), and an HTML checkbox's value is simply absent from
  // FormData when unchecked, which would make a form-based boolean
  // impossible to ever turn off. Business profile / Numbering are
  // submitted as plain objects built from their form fields client-side
  // for the same reason. RLS (app_settings_update_staff) is the real
  // authorization backstop — a non-admin/super_admin caller's update
  // simply affects 0 rows on the singleton row, surfaced as a friendly
  // error below, same pattern as updateStaffProfile/updateSupportTicket.
  updateAppSettings: defineAction({
    input: z.object({
      businessName: z.preprocess(emptyToUndefined, z.string().optional()),
      gstin: z.preprocess(emptyToUndefined, z.string().optional()),
      orderNumberPrefix: z.preprocess(emptyToUndefined, z.string().optional()),
      nextOrderNumber: z.preprocess(emptyToUndefined, z.coerce.number().int().positive().optional()),
      lowStockAlertsEnabled: z.boolean().optional(),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const update: Record<string, unknown> = {};
      if (input.businessName !== undefined) update.business_name = input.businessName;
      if (input.gstin !== undefined) update.gstin = input.gstin;
      if (input.orderNumberPrefix !== undefined) update.order_number_prefix = input.orderNumberPrefix;
      if (input.nextOrderNumber !== undefined) update.next_order_number = input.nextOrderNumber;
      if (input.lowStockAlertsEnabled !== undefined) update.low_stock_alerts_enabled = input.lowStockAlertsEnabled;

      if (Object.keys(update).length === 0) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Nothing to update." });
      }

      const { data, error } = await supabase.from("app_settings").update(update).eq("id", true).select("id").maybeSingle();

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      if (!data) {
        throw new ActionError({ code: "FORBIDDEN", message: "You don't have access to app settings." });
      }

      return { message: "Settings updated." };
    },
  }),

  // Mark-as-read / Ignore for the caller's own real notification row.
  // RLS (notifications_update_own) is the real authorization backstop —
  // targeting another recipient's notification simply affects 0 rows.
  updateNotification: defineAction({
    input: z.object({
      notificationId: z.string().uuid(),
      markRead: z.boolean().optional(),
      ignore: z.boolean().optional(),
    }),
    handler: async (input, context) => {
      const supabase = createClient({
        request: context.request,
        cookies: context.cookies,
      });

      const update: Record<string, unknown> = {};
      if (input.markRead) update.read_at = new Date().toISOString();
      if (input.ignore) update.ignored_at = new Date().toISOString();

      if (Object.keys(update).length === 0) {
        throw new ActionError({ code: "BAD_REQUEST", message: "Nothing to update." });
      }

      const { data, error } = await supabase.from("notifications").update(update).eq("id", input.notificationId).select("id").maybeSingle();

      if (error) {
        throw new ActionError({ code: "BAD_REQUEST", message: error.message });
      }

      if (!data) {
        throw new ActionError({ code: "FORBIDDEN", message: "Notification not found." });
      }

      return { message: "Notification updated." };
    },
  }),
};
