import { BookOpen, Bug, Calendar, KanbanSquare } from "lucide-react"
import { UnifyOpsLogo } from "@/components/icons/logo"

const features = [
  {
    Icon: Bug,
    cls: "bg-gradient-to-br from-violet to-indigo",
    title: "Smart task tracking",
    desc: "Organize work with priorities, labels, and assignees",
  },
  {
    Icon: KanbanSquare,
    cls: "bg-gradient-to-br from-blue to-cyan",
    title: "Visual kanban boards",
    desc: "Drag & drop across workflow stages",
  },
  {
    Icon: Calendar,
    cls: "bg-gradient-to-br from-pink to-rose",
    title: "Calendar & timeline",
    desc: "See deadlines and plan sprints visually",
  },
  {
    Icon: BookOpen,
    cls: "bg-gradient-to-br from-amber to-red",
    title: "Built-in wiki",
    desc: "Document everything your team needs",
  },
]

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-bg p-6 overflow-hidden">
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute -top-[140px] -left-[120px] w-[520px] h-[520px] rounded-full opacity-50 blur-[90px] bg-violet animate-float" />
        <div className="absolute -bottom-[120px] -right-[100px] w-[420px] h-[420px] rounded-full opacity-50 blur-[90px] bg-pink animate-float [animation-delay:-6s]" />
        <div className="absolute top-[40%] left-1/2 w-[360px] h-[360px] rounded-full opacity-50 blur-[90px] bg-cyan animate-float [animation-delay:-12s]" />
      </div>

      <div className="relative z-10 grid w-full max-w-[1180px] grid-cols-1 items-center gap-12 lg:grid-cols-2">
        <div className="p-8">
          <div className="w-32 h-32 mb-6 drop-shadow-[0_8px_24px_rgba(99,102,241,.35)] ">
            <UnifyOpsLogo className="w-full h-full" />
          </div>
          <h1 className="text-[40px] leading-[1.1] font-extrabold tracking-[-.02em] mb-3.5">
            Welcome to{" "}
            <span className="font-extrabold" style={{ color: "#54A6DB" }}>
              UnifyOps
            </span>
          </h1>
          <p className="text-[16px] text-text-sub max-w-[440px] leading-[1.6] mb-9">
            The complete workspace for modern teams. Plan, build, and ship — all
            in one beautiful place.
          </p>
          <div className="flex flex-col gap-[18px]">
            {features.map(({ Icon, cls, title, desc }) => (
              <div key={title} className="flex items-start gap-3.5">
                <div
                  className={`w-10 h-10 rounded-[10px] flex items-center justify-center text-white flex-shrink-0 ${cls}`}
                >
                  <Icon className="w-[18px] h-[18px]" />
                </div>
                <div>
                  <strong className="block text-[14px] font-semibold mb-0.5">
                    {title}
                  </strong>
                  <span className="text-[13px] text-text-muted leading-[1.5]">
                    {desc}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-center">
          <div className="w-full max-w-[420px] p-9 rounded-2xl bg-bg-card border border-border shadow-xl backdrop-blur-2xl">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
