import { NavLink } from "react-router-dom";
import { ClipboardList, FileSearch, Scale, Zap } from "lucide-react";
import AutomationBadge from "@/components/AutomationBadge";

const AppNavigation = () => {
  return (
    <nav className="w-full border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo/Brand */}
          <a href="/" className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-primary" />
            <span className="font-serif text-xl font-semibold text-gold-gradient">
              Credit Compass
            </span>
          </a>

          {/* Navigation Links + Automation Badge */}
          <div className="flex items-center gap-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`
              }
            >
              <FileSearch className="w-4 h-4" />
              <span className="hidden sm:inline">Credit Report Analyzer</span>
              <span className="sm:hidden">Analyzer</span>
            </NavLink>

            <NavLink
              to="/disputes"
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`
              }
            >
              <Scale className="w-4 h-4" />
              <span className="hidden sm:inline">Dispute & Response Engine</span>
              <span className="sm:hidden">Disputes</span>
            </NavLink>

            <NavLink
              to="/intake"
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`
              }
            >
              <ClipboardList className="w-4 h-4" />
              <span className="hidden sm:inline">Intake</span>
              <span className="sm:hidden">Intake</span>
            </NavLink>

            <div className="hidden sm:block ml-2">
              <AutomationBadge />
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default AppNavigation;
