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
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc";

type Role = "viewer" | "operator" | "manager" | "admin";

const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  operator: 1,
  manager: 2,
  admin: 3,
};

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Minimum role required to see this item */
  minRole: Role;
}

// Add your app's sections here. minRole hides the item from lower roles;
// the actual enforcement is server-side in the tRPC procedures plus the
// route-level requireRole() in router.tsx.
const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Overview", icon: LayoutDashboard, minRole: "viewer" },
  { to: "/catalog", label: "Strategies", icon: LineChart, minRole: "viewer" },
  { to: "/sweeps", label: "Sweeps", icon: Rocket, minRole: "operator" },
  { to: "/analytics", label: "Analytics", icon: Trophy, minRole: "viewer" },
  { to: "/tesseract", label: "Tesseract", icon: Boxes, minRole: "viewer" },
  { to: "/polymarket", label: "Polymarket", icon: Target, minRole: "viewer" },
  { to: "/formula-lab", label: "Formula Lab", icon: Binary, minRole: "viewer" },
  { to: "/crucible", label: "Crucible", icon: FlaskConical, minRole: "viewer" },
  { to: "/screens", label: "Screens & Alerts", icon: Radar, minRole: "viewer" },
  { to: "/knowledge", label: "Knowledge", icon: BookOpen, minRole: "viewer" },
  { to: "/live", label: "Live", icon: Zap, minRole: "viewer" },
  { to: "/settings", label: "Settings", icon: KeyRound, minRole: "viewer" },
];

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
  collapsed: boolean;
  onCollapsedToggle: () => void;
}

export function Sidebar({
  mobileOpen,
  onMobileClose,
  collapsed,
  onCollapsedToggle,
}: SidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const myRank = ROLE_RANK[(me?.role as Role) ?? "viewer"] ?? 0;

  const visibleItems = NAV_ITEMS.filter((item) => myRank >= ROLE_RANK[item.minRole]);

  return (
    <aside
      className={cn(
        "z-50 flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[transform,width] duration-200",
        // Mobile: fixed overlay, slides in/out. Desktop: static.
        "fixed inset-y-0 left-0 md:static md:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
        collapsed ? "md:w-16" : "md:w-60",
      )}
    >
      <div className="h-16 border-b">
        <div className="flex h-full items-center gap-2 px-4 md:hidden">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
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
            "hidden h-full w-full items-center rounded-none px-4 text-left transition-colors hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:flex",
            collapsed ? "justify-center px-2" : "gap-2",
          )}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Boxes className="h-4 w-4" />
          </span>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate font-semibold">Alchemy</span>
              <span className="text-xs font-normal text-muted-foreground">⌘B</span>
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
            <p className="text-xs text-muted-foreground">{me.role}</p>
          </div>
          {collapsed && (
            <div className="hidden h-10 items-center justify-center rounded-md bg-sidebar-accent font-mono text-xs font-semibold md:flex">
              {(me.name?.trim()?.[0] ?? me.role?.[0] ?? "J").toUpperCase()}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
