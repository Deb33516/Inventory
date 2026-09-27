import { defineAction, ActionError } from "astro:actions";
import { z } from "astro/zod";
import { createClient } from "../lib/supabase/server";

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
};
