import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "../services/dbCloud";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    let unsub: (() => void) | undefined;

    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
    });

    unsub = () => sub.subscription.unsubscribe();
    return () => unsub?.();
  }, []);

  if (loading || hasSession === null) return <div className="p-10 text-center">Cargando…</div>;
  if (!hasSession) return <Navigate to="/login" replace />;

  return <>{children}</>;
}
