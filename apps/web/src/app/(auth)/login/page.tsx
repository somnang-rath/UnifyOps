"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingScreen } from "@/components/ui/loading-screen";
import { LoginSchema, type LoginInput } from "@/schemas/auth";
import { useLogin } from "@/hooks/use-auth";
import { AuthHead, FieldIcon } from "../_components/auth-tabs";

export default function LoginPage() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/home";
  const login = useLogin();
  const [serverError, setServerError] = useState("");

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(LoginSchema) });

  const onSubmit = handleSubmit(async (data) => {
    setServerError("");
    try {
      await login.mutateAsync(data);
      router.replace(next);
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
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            className="auth-input"
            {...register("password")}
          />
        </FieldIcon>

        {serverError && (
          <div className="px-2.5 py-1.5 rounded-sm text-[12px] text-red bg-[rgba(239,68,68,.08)]">
            {serverError}
          </div>
        )}

        <Button type="submit" variant="grad" size="lg" full>
          Sign in to UnifyOps
        </Button>

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
