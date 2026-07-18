import { Construction } from 'lucide-react';

export function ComingSoon({
  title,
  desc,
}: {
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-16">
      <div className="w-14 h-14 rounded-full flex items-center justify-center bg-bg-subtle border border-border">
        <Construction className="w-7 h-7 text-text-muted" />
      </div>
      <h3 className="text-[16px] font-semibold">{title}</h3>
      <p className="text-[13px] text-text-muted max-w-[360px]">{desc}</p>
      <span className="text-[11px] uppercase tracking-wide font-semibold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
        Coming soon
      </span>
    </div>
  );
}
