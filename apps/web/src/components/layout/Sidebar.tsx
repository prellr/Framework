import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, StickyNote, Shield, Boxes, type LucideIcon } from "lucide-react";
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
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, minRole: "viewer" },
  { to: "/notes", label: "Notes", icon: StickyNote, minRole: "viewer" },
  { to: "/admin", label: "Admin", icon: Shield, minRole: "admin" },
];

interface SidebarProps {
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({ mobileOpen, onMobileClose }: SidebarProps) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: me } = trpc.admin.me.useQuery(undefined, { staleTime: 60_000 });
  const myRank = ROLE_RANK[(me?.role as Role) ?? "viewer"] ?? 0;

  const visibleItems = NAV_ITEMS.filter((item) => myRank >= ROLE_RANK[item.minRole]);

  return (
    <aside
      className={cn(
        "z-50 flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-transform",
        // Mobile: fixed overlay, slides in/out. Desktop: static.
        "fixed inset-y-0 left-0 md:static md:translate-x-0",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      )}
    >
      <div className="flex h-16 items-center gap-2 border-b px-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Boxes className="h-4 w-4" />
        </div>
        <span className="font-semibold">Framework</span>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleItems.map((item) => {
          const active = pathname === item.to || pathname.startsWith(item.to + "/");
          return (
            <Link
              key={item.to}
              to={item.to}
              onClick={onMobileClose}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {me && (
        <div className="border-t p-4 text-sm">
          <p className="font-medium">{me.name}</p>
          <p className="text-xs text-muted-foreground">{me.role}</p>
        </div>
      )}
    </aside>
  );
}
