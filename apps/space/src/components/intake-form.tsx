'use client';
import { useState } from 'react';
import { PUBLIC_API_URL } from '@/lib/api-url';
import type { PublicIntakeForm } from '@/lib/public-api';

/*
 * The submit goes **from the browser**, not through the space server, and that
 * is deliberate: the endpoint is throttled per IP, so proxying it would make
 * every anonymous visitor share one bucket and let a single submitter lock the
 * form for everyone. The API already allows :3002 in its CORS list, and the
 * space CSP names this origin in `connect-src` for exactly this request.
 */

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 10_000;

type State = 'idle' | 'sending' | 'sent';

export function IntakeFormView({ form }: { form: PublicIntakeForm }) {
  const [state, setState] = useState<State>('idle');
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === 'sending' || !title.trim()) return;
    setState('sending');
    setError('');
    try {
      const res = await fetch(
        `${PUBLIC_API_URL}/intake/forms/${encodeURIComponent(form.anchor)}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim(),
            description: description.trim(),
            // Omitted rather than sent empty — the API validates it as an
            // email when present, and "" is not one.
            ...(email.trim() ? { submitterEmail: email.trim() } : {}),
          }),
        },
      );
      if (res.status === 429) {
        setError('Too many requests just now. Please try again in a minute.');
        setState('idle');
        return;
      }
      if (res.status === 404) {
        setError('This form has stopped accepting requests.');
        setState('idle');
        return;
      }
      if (!res.ok) {
        setError('Something went wrong. Please try again.');
        setState('idle');
        return;
      }
      setState('sent');
    } catch {
      // A network failure and a blocked request look the same here; both mean
      // "we do not know whether it landed", so say only that.
      setError('Could not reach the server. Please try again.');
      setState('idle');
    }
  };

  if (state === 'sent') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <h2 className="text-lg font-semibold">Thank you</h2>
        <p className="mt-2 text-[14px] text-gray-500">
          Your request has been received. The team will review it.
        </p>
        <button
          type="button"
          onClick={() => {
            setTitle('');
            setDescription('');
            setEmail('');
            setState('idle');
          }}
          className="mt-4 text-[13px] font-medium text-indigo-600 underline underline-offset-2"
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-xl border border-gray-200 bg-white p-6 flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="intake-title" className="text-[13px] font-medium">
          Summary <span className="text-red-500">*</span>
        </label>
        <input
          id="intake-title"
          required
          maxLength={MAX_TITLE}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What do you need?"
          className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] outline-none focus:border-indigo-500"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="intake-description" className="text-[13px] font-medium">
          Details
        </label>
        <textarea
          id="intake-description"
          rows={6}
          maxLength={MAX_DESCRIPTION}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Anything that helps — steps, links, deadlines."
          className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] leading-relaxed outline-none focus:border-indigo-500 resize-y"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="intake-email" className="text-[13px] font-medium">
          Your email{' '}
          <span className="font-normal text-gray-400">
            (optional — so we can follow up)
          </span>
        </label>
        <input
          id="intake-email"
          type="email"
          maxLength={200}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="rounded-lg border border-gray-300 px-3 py-2 text-[14px] outline-none focus:border-indigo-500"
        />
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-red-600">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-gray-400">
          Your request goes to the team&rsquo;s queue. It is not public.
        </p>
        <button
          type="submit"
          disabled={state === 'sending' || !title.trim()}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-[14px] font-medium text-white disabled:opacity-50 hover:bg-indigo-700"
        >
          {state === 'sending' ? 'Sending…' : 'Send request'}
        </button>
      </div>
    </form>
  );
}
