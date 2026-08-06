"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff, Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { LoginSchema, type LoginInput } from "@/schemas/auth";
import { useLogin, localeNeedsFullNavigation } from "@/hooks/use-auth";
import { AuthHead, FieldIcon } from "../_components/auth-tabs";
import { OAuthButtons } from "../_components/oauth-buttons";

/** Frozen failure codes the OAuth callback redirects with (ADR 0008 §4). */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_failed:
    "Sign-in with the provider failed. Please try again or use your password.",
  signup_disabled:
    "No account matches that profile, and sign-ups are disabled on this instance.",
  account_disabled: "This account has been disabled. Contact an administrator.",
};

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/home";
  const oauthError = OAUTH_ERROR_MESSAGES[params.get("error") ?? ""];
  const login = useLogin();
  const [serverError, setServerError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setServerError("");
    try {
      const res = await login.mutateAsync(data);
      // A user whose account language differs from what this page was rendered
      // in needs the server, not the client router — see the helper.
      if (localeNeedsFullNavigation(res.user)) window.location.assign(next);
      else router.replace(next);
    } catch (e: any) {
      setServerError(e?.response?.data?.message ?? "Invalid credentials");
    }
  });

  if (login.isPending || isSubmitting) {
    return <LoadingScreen />;
  }

  return (
    <>
      <AuthHead />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <FieldIcon
          label="Email"
          icon={<Mail className="w-4 h-4" />}
          error={errors.email?.message}
        >
          <input
            type="text"
            autoComplete="username"
            placeholder="you@example.com"
            className="auth-input"
            {...register("email")}
          />
        </FieldIcon>
        <FieldIcon
          label="Password"
          icon={<Lock className="w-4 h-4" />}
          error={errors.password?.message}
        >
          <input
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="Enter your password"
            className="auth-input pr-10"
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
          >
            {showPassword ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </FieldIcon>

        {(serverError || oauthError) && (
          <div className="px-2.5 py-1.5 rounded-sm text-[12px] text-red bg-[rgba(239,68,68,.08)]">
            {serverError || oauthError}
          </div>
        )}

        <Button type="submit" variant="primary" size="lg" full>
          Sign in to UnifyOps
        </Button>

        <OAuthButtons />

        <div className="text-center text-[12px] text-text-muted p-2.5 rounded-sm bg-bg-subtle border border-dashed border-border leading-[1.7]">
          <strong className="block mb-1">New here?</strong>
          <a href="/register" className="underline underline-offset-2 hover:text-text">
            Create an account
          </a>
          {" · "}
          <a href="/forgot-password" className="underline underline-offset-2 hover:text-text">
            Forgot password?
          </a>
        </div>

        <p className="text-center text-[12px] text-text-muted">
          Access is by invitation only. Contact a workspace admin.
        </p>
      </form>
    </>
  );
}
