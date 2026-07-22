'use client';

export function TypingIndicator({
  users,
}: {
  users: { userId: string; name: string }[];
}) {
  const names = users.map((u) => u.name || 'Someone');
  const label =
    names.length === 1
      ? `${names[0]} is typing…`
      : names.length === 2
        ? `${names[0]} and ${names[1]} are typing…`
        : 'Several people are typing…';
  return (
    <div className="flex items-center gap-2 px-2 py-1 text-[12px] text-text-muted">
      <span className="flex gap-0.5">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
      {label}
    </div>
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce"
      style={{ animationDelay: delay }}
    />
  );
}
