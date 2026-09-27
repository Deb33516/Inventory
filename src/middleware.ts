import { defineMiddleware } from "astro:middleware";
import { createClient } from "./lib/supabase/server";

const PROTECTED_PREFIXES = ["/account"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient({
    request: context.request,
    cookies: context.cookies,
  });

  // getUser() revalidates the token against Supabase Auth rather than
  // trusting the (unverified) session stored in cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  context.locals.supabase = supabase;
  context.locals.user = user;

  const isProtected = PROTECTED_PREFIXES.some(
    (prefix) =>
      context.url.pathname === prefix ||
      context.url.pathname.startsWith(prefix + "/")
  );

  if (isProtected && !user) {
    const redirectTo = encodeURIComponent(
      context.url.pathname + context.url.search
    );
    return context.redirect(`/login?redirect=${redirectTo}`);
  }

  return next();
});
