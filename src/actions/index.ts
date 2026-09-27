import { defineAction, ActionError } from "astro:actions";
import { z } from "astro/zod";
import { createClient } from "../lib/supabase/server";

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
};
