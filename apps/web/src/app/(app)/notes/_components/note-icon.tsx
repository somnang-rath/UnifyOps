"use client"
import {
  BookOpen,
  NotebookPen,
  FileText,
  Folder as FolderIcon,
  Star,
  Heart,
  Lightbulb,
  Target,
  Rocket,
  Flame,
  Sparkles,
  Pin,
  Hash,
  GraduationCap,
  Mic,
  Music,
  Camera,
  Code,
  Coffee,
  Brain,
  Briefcase,
  Moon,
  Sun,
  Trophy,
  Compass,
  Globe,
  Leaf,
  Zap,
  Package,
  Library,
  ListChecks,
  Bookmark,
  Tag,
  Bell,
  Calendar,
  Map,
  Palette,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

const ICON_LIST: { name: string; icon: LucideIcon }[] = [
  { name: "BookOpen", icon: BookOpen },
  { name: "NotebookPen", icon: NotebookPen },
  { name: "FileText", icon: FileText },
  { name: "Folder", icon: FolderIcon },
  { name: "Star", icon: Star },
  { name: "Heart", icon: Heart },
  { name: "Lightbulb", icon: Lightbulb },
  { name: "Target", icon: Target },
  { name: "Rocket", icon: Rocket },
  { name: "Flame", icon: Flame },
  { name: "Sparkles", icon: Sparkles },
  { name: "Pin", icon: Pin },
  { name: "Hash", icon: Hash },
  { name: "GraduationCap", icon: GraduationCap },
  { name: "Mic", icon: Mic },
  { name: "Music", icon: Music },
  { name: "Camera", icon: Camera },
  { name: "Code", icon: Code },
  { name: "Coffee", icon: Coffee },
  { name: "Brain", icon: Brain },
  { name: "Briefcase", icon: Briefcase },
  { name: "Moon", icon: Moon },
  { name: "Sun", icon: Sun },
  { name: "Trophy", icon: Trophy },
  { name: "Compass", icon: Compass },
  { name: "Globe", icon: Globe },
  { name: "Leaf", icon: Leaf },
  { name: "Zap", icon: Zap },
  { name: "Package", icon: Package },
  { name: "Library", icon: Library },
  { name: "ListChecks", icon: ListChecks },
  { name: "Bookmark", icon: Bookmark },
  { name: "Tag", icon: Tag },
  { name: "Bell", icon: Bell },
  { name: "Calendar", icon: Calendar },
  { name: "Map", icon: Map },
  { name: "Palette", icon: Palette },
]

export const LUCIDE_ICONS = ICON_LIST
const ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  ICON_LIST.map((x) => [x.name, x.icon]),
)

const PREFIX = "lucide:"
export const lucideValue = (name: string) => `${PREFIX}${name}`
export const isLucideIcon = (v: string | null | undefined): v is string =>
  !!v && v.startsWith(PREFIX)
export const lucideNameOf = (v: string) => v.slice(PREFIX.length)

export function NoteIcon({
  value,
  size = 18,
  className,
}: {
  value: string | null | undefined
  size?: number
  className?: string
}) {
  if (isLucideIcon(value)) {
    const Icon = ICON_MAP[lucideNameOf(value)]
    if (Icon)
      return (
        <Icon
          className={cn("text-accent", className)}
          style={{ width: size, height: size }}
          strokeWidth={2}
        />
      )
  }
  return (
    <span
      className={cn("leading-none", className)}
      style={{ fontSize: size }}
    >
      {value || "📄"}
    </span>
  )
}
