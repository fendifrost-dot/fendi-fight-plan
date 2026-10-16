import { Navigate } from "react-router-dom";
import AppNavigation from "@/components/AppNavigation";
import { AgentAccessCard } from "@/components/settings/AgentAccessCard";
import { useStaffRole } from "@/hooks/useStaffRole";

export default function Settings() {
  const access = useStaffRole();

  if (!access.ready) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <main className="container mx-auto px-4 py-8">
          <p className="text-sm text-muted-foreground">Checking access…</p>
        </main>
      </div>
    );
  }

  if (!access.signedIn) return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen bg-background">
      <AppNavigation />
      <main className="container mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="font-serif text-3xl font-semibold">Settings</h1>
          <p className="text-muted-foreground">Staff-only controls for Credit Compass.</p>
        </div>
        {access.isStaff ? (
          <AgentAccessCard />
        ) : (
          <p className="text-sm text-muted-foreground">Settings are available to staff accounts only.</p>
        )}
      </main>
    </div>
  );
}
