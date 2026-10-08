import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type StaffAccess = { ready: boolean; isStaff: boolean; signedIn: boolean };

async function lookupStaff(accessToken: string, userId: string): Promise<boolean> {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/is_staff`, {
    method: "POST",
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ _user_id: userId }),
  });
  if (!response.ok) return false;
  return (await response.json()) === true;
}

export function useStaffRole(): StaffAccess {
  const [access, setAccess] = useState<StaffAccess>({ ready: false, isStaff: false, signedIn: false });

  useEffect(() => {
    let cancel = false;

    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        if (!cancel) setAccess({ ready: true, isStaff: false, signedIn: false });
        return;
      }
      const isStaff = await lookupStaff(session.access_token, session.user.id).catch(() => false);
      if (!cancel) setAccess({ ready: true, isStaff, signedIn: true });
    };

    void load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      void load();
    });
    return () => {
      cancel = true;
      subscription.unsubscribe();
    };
  }, []);

  return access;
}
