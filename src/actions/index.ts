import { defineAction, ActionError } from "astro:actions";
import { z } from "astro/zod";
import { createClient } from "../lib/supabase/server";
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

      return { message: "Signed in." };
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
};
