export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="text-center max-w-md">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-gray-400">
          404
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">
          Page not available
        </h1>
        <p className="mt-3 text-[14px] text-gray-500">
          This page is not published, or the link is no longer valid.
        </p>
      </div>
    </main>
  );
}
