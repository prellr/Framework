import { Link, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  StickyNote,
  Shield,
  Boxes,
  KeyRound,
  LineChart,
  Rocket,
  Database,
  History,
  Coins,
  Radar,
  BarChart3,
  Trophy,
  Wallet,
  Briefcase,
  Zap,
  BookOpen,
  Target,
  FlaskConical,
  Binary,
  BadgeCent,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";
import {
  canAccessSection,
  type Role,
  type SectionAccess,
  type SectionKey,
} from "@/lib/section-access";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  section: SectionKey;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, section: "overview" },
  { to: "/catalog", label: "Strategies", icon: LineChart, section: "strategies" },
  { to: "/sweeps", label: "Sweeps", icon: Rocket, section: "sweeps" },
  { to: "/analytics", label: "Analytics", icon: Trophy, section: "analytics" },
  { to: "/tesseract", label: "Tesseract", icon: Boxes, section: "tesseract" },
  { to: "/polymarket", label: "Polymarket", icon: Target, section: "polymarket" },
  { to: "/sub35", label: "Sub35", icon: BadgeCent, section: "sub35" },
  { to: "/formula-lab", label: "Formula Lab", icon: Binary, section: "formulaLab" },
  { to: "/crucible", label: "Crucible", icon: FlaskConical, section: "crucible" },
  { to: "/screens", label: "Screens & Alerts", icon: Radar, section: "screens" },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen, section: "knowledge" },
  { to: "/live", label: "Live", icon: Zap, section: "live" },
  { to: "/settings", label: "Settings", icon: KeyRound, section: "settings" },
];

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsed: boolean;
  onCollapsedToggle: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose, collapsed, onCollapsedToggle }: SidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const { data: sectionAccess } = trpc.admin.sectionAccess.useQuery(undefined, {
    staleTime: 60_000,
  });
  const role = (me?.role as Role) ?? "viewer";

  const visibleItems = NAV_ITEMS.filter((item) =>
    canAccessSection(role, item.section, sectionAccess?.access as SectionAccess | undefined),
  );

  return (
    <aside
      className={cn(
        "bg-sidebar text-sidebar-foreground z-50 flex w-60 shrink-0 flex-col border-r transition-[transform,width] duration-200",
        // Mobile: fixed overlay, slides in/out. Desktop: static.
        "fixed inset-y-0 left-0 md:static md:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        collapsed ? "md:w-16" : "md:w-60",
      )}
    >
      <div className="h-16 border-b">
        <div className="flex h-full items-center gap-2 px-4 md:hidden">
          <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-lg">
            <Boxes className="h-4 w-4" />
          </div>
          <span className="font-semibold">Alchemy</span>
        </div>
        <button
          type="button"
          onClick={onCollapsedToggle}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          aria-expanded={!collapsed}
          title={`${collapsed ? "Expand" : "Collapse"} navigation (⌘B)`}
          className={cn(
            "hover:bg-sidebar-accent focus-visible:ring-ring hidden h-full w-full items-center rounded-none px-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset md:flex",
            collapsed ? "justify-center px-2" : "gap-2",
          )}
        >
          <span className="bg-primary text-primary-foreground flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <Boxes className="h-4 w-4" />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate font-semibold">Alchemy</span>
              <span className="text-muted-foreground text-xs font-normal">⌘B</span>
            </>
          )}
        </button>
      </div>

      <nav className={cn("flex-1 space-y-1 overflow-y-auto p-3", collapsed && "md:px-2")}>
        {visibleItems.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onMobileClose}
              aria-label={collapsed ? item.label : undefined}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                collapsed && "md:justify-center md:px-2",
                active
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <item.icon className={cn("h-4 w-4 shrink-0", collapsed && "md:h-5 md:w-5")} />
              <span className={cn("truncate", collapsed && "md:sr-only")}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {me && (
        <div
          className={cn("border-t p-4 text-sm", collapsed && "md:p-2")}
          title={collapsed ? `${me.name} · ${me.role}` : undefined}
        >
          <div className={cn(collapsed && "md:hidden")}>
            <p className="font-medium">{me.name}</p>
            <p className="text-muted-foreground text-xs">{me.role}</p>
          </div>
          {collapsed && (
            <div className="bg-sidebar-accent hidden h-10 items-center justify-center rounded-md font-mono text-xs font-semibold md:flex">
              {(me.name?.trim()?.[0] ?? me.role?.[0] ?? "J").toUpperCase()}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
