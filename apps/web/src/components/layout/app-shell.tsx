import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  GitPullRequest,
  Inbox,
  User,
  Users,
  Coins,
  Menu,
  Moon,
  Sun,
  ShieldCheck,
  Database,
  Star,
  Settings2,
  Timer,
  Cpu,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/use-theme";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/issues", icon: GitPullRequest, label: "Issues" },
  { to: "/prs", icon: GitPullRequest, label: "PRs" },
  { to: "/inbox", icon: Inbox, label: "Inbox" },
  { to: "/settings/profile", icon: User, label: "Profile" },
  { to: "/settings/providers", icon: Cpu, label: "Providers" },
  { to: "/credits", icon: Coins, label: "Credits" },
];

const adminNavItems = [
  { to: "/admin/repos", icon: Database, label: "Repositories" },
  { to: "/admin/users", icon: Users, label: "Users" },
  { to: "/admin/prestige", icon: Star, label: "Prestige" },
  { to: "/admin/policy", icon: Settings2, label: "Policy" },
  { to: "/admin/scheduler", icon: Timer, label: "Scheduler" },
];

function SidebarNav() {
  const { user } = useAuth();

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <NavLink to="/dashboard" className="font-mono text-lg font-bold text-primary">
          ContribOS
        </NavLink>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton asChild>
                  <NavLink
                    to={item.to}
                    className={({ isActive }) =>
                      cn(isActive && "bg-sidebar-accent text-sidebar-accent-foreground")
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    <span>{item.label}</span>
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {user?.isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
              Admin
            </SidebarGroupLabel>
            <SidebarMenu>
              {adminNavItems.map((item) => (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        cn(isActive && "bg-sidebar-accent text-sidebar-accent-foreground")
                      }
                    >
                      <item.icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="border-t">
        <UserMenu />
      </SidebarFooter>
    </Sidebar>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const { toggle, isDark } = useTheme();

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-center gap-2 px-2">
        <Avatar className="h-8 w-8">
          <AvatarImage src={user?.avatarUrl} alt={user?.username} />
          <AvatarFallback>
            {user?.username?.slice(0, 2).toUpperCase() ?? "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-1 flex-col overflow-hidden">
          <span className="truncate text-sm font-medium">{user?.username}</span>
          <span className="truncate text-xs text-muted-foreground">
            {user?.tier ? `Tier ${user.tier}` : "—"}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={toggle}
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="flex-1 justify-start">
              Account
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>My Account</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <NavLink to="/settings/profile">Profile Settings</NavLink>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <NavLink to="/credits">Credits</NavLink>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} className="text-destructive">
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface AppShellProps {
  children: React.ReactNode;
  creditBalance?: number;
}

export function AppShell({ children, creditBalance = 0 }: AppShellProps) {
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-r bg-sidebar md:block">
        <SidebarNav />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-background px-4 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation menu">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SidebarNav />
            </SheetContent>
          </Sheet>
          <span className="font-mono font-bold text-primary">ContribOS</span>
          {creditBalance > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {creditBalance} credits
            </Badge>
          )}
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
