'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Eye, EyeOff, Lock } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { useAcceptInvite } from '@/hooks/use-auth';
import { FieldIcon } from '../_components/auth-tabs';

const Schema = z
  .object({
    password: z.string().min(8, 'At least 8 characters'),
    confirm: z.string().min(1, 'Please confirm your password'),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ['confirm'],
  });
type Input = z.infer<typeof Schema>;

function AcceptInviteForm() {
  const token = useSearchParams().get('token') ?? '';
  const router = useRouter();
  const acceptInvite = useAcceptInvite();
  const [serverError, setServerError] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Input>({ resolver: zodResolver(Schema) });

  if (!token) {
    return (
      <div className="text-center py-4">
        <p className="text-[15px] font-semibold mb-2">Invalid invite link</p>
        <p className="text-[13px] text-text-muted leading-[1.6]">
          This link is missing or malformed. Ask your admin to resend the
          invitation.
        </p>
      </div>
    );
  }

  if (acceptInvite.isPending || isSubmitting) return <LoadingScreen />;

  const onSubmit = handleSubmit(async (data) => {
    setServerError('');
    try {
      await acceptInvite.mutateAsync({ token, password: data.password });
      router.replace('/home');
    } catch (e: any) {
      setServerError(
        e?.response?.data?.message ??
          'Invalid or expired invite link. Ask your admin to resend.',
      );
    }
  });

  return (
    <>
      <div className="mb-6 text-center">
        <h2 className="text-[22px] font-bold tracking-[-.01em]">
          Set your password
        </h2>
        <p className="text-[13px] text-text-muted mt-1.5 leading-[1.6]">
          Create a password to activate your Prism account.
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <FieldIcon
          label="New password"
          icon={<Lock className="w-4 h-4" />}
          error={errors.password?.message}
        >
          <input
            type={showPwd ? 'text' : 'password'}
            className="auth-input pr-10"
            placeholder="Min. 8 characters"
            autoFocus
            autoComplete="new-password"
            {...register('password')}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
          >
            {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </FieldIcon>

        <FieldIcon
          label="Confirm password"
          icon={<Lock className="w-4 h-4" />}
          error={errors.confirm?.message}
        >
          <input
            type={showConfirm ? 'text' : 'password'}
            className="auth-input pr-10"
            placeholder="Repeat your password"
            autoComplete="new-password"
            {...register('confirm')}
          />
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setShowConfirm((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text transition-colors"
          >
            {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </FieldIcon>

        {serverError && (
          <div className="px-2.5 py-1.5 rounded-sm text-[12px] text-red bg-[rgba(239,68,68,.08)]">
            {serverError}
          </div>
        )}

        <Button type="submit" variant="grad" size="lg" full>
          Activate my account
        </Button>
      </form>
    </>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteForm />
    </Suspense>
  );
}
