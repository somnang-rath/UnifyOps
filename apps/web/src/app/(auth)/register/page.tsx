'use client';
import Link from 'next/link';
import { MailOpen } from 'lucide-react';

export default function RegisterPage() {
  return (
    <div className="flex flex-col items-center text-center gap-4 py-4">
      <div className="w-12 h-12 rounded-full bg-bg-subtle border border-border flex items-center justify-center">
        <MailOpen className="w-5 h-5 text-text-muted" />
      </div>
      <div>
        <h2 className="text-[18px] font-bold mb-1.5">Invitation only</h2>
        <p className="text-[13px] text-text-muted leading-[1.7]">
          This workspace does not allow public sign-ups.
          <br />
          Ask a workspace admin to invite you — you will receive an email with a
          link to activate your account.
        </p>
      </div>
      <Link href="/login" className="text-[13px] text-accent font-medium">
        Back to sign in
      </Link>
    </div>
  );
}
