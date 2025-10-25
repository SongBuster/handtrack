import { Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "../services/dbCloud";
import { db } from "../services/dbLocal";
import { useSelectedTeam } from "../context/SelectedTeamContext";

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const { selectedTeam, clearTeam } = useSelectedTeam();

  const linkClass = (path: string) =>
    `px-4 py-2 rounded-md ${
      pathname === path
        ? "bg-blue-500 text-white"
        : "text-blue-500 hover:bg-blue-100"
    }`;

  const renderNavLink = (path: string, label: string, requiresTeam = false) => {
    if (requiresTeam && !selectedTeam) {
      return (
        <span className="px-4 py-2 rounded-md bg-gray-100 text-gray-400 cursor-not-allowed">
          {label}
        </span>
      );
    }

    return (
      <Link to={path} className={linkClass(path)}>
        {label}
      </Link>
    );
  };

  // 🔍 Recuperar usuario actual
  useEffect(() => {
    const fetchUser = async () => {
      const { data } = await supabase.auth.getUser();
      setUserEmail(data.user?.email ?? null);
    };

    fetchUser();

    // Escuchar cambios de sesión (por si cambia de usuario)
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUserEmail(session?.user?.email ?? null);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  async function handleLogout() {
    try {
      // 🧹 Limpieza selectiva de datos (sin cerrar la base)
      await Promise.all([
        db.teams.clear(),
        db.players.clear(),
        db.matches.clear(),
        db.situations.clear(),
        db.sections.clear(),
        db.tags.clear(),
        db.screens.clear(),
        db.match_screens.clear(),
        db.screen_situations.clear(),
        db.screen_situation_sections.clear(),
        db.screen_section_tags.clear(),
        // si más adelante añadimos plays u otras tablas, también aquí
      ]);
      console.log("🧹 Datos locales limpiados");
    } catch (err) {
      console.error("Error al limpiar base local:", err);
    }

    await supabase.auth.signOut();
    clearTeam();
    navigate("/login", { replace: true });
  }

  return (
   <nav className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 p-3 bg-white shadow">
      <div className="flex flex-col gap-1">
        <div className="flex gap-2">
          {renderNavLink("/", "Equipos")}
          {renderNavLink("/situations", "Etiquetas", false)}
          {renderNavLink("/players", "Jugadores", true)}
          {renderNavLink("/matches", "Partidos", true)}
          
        </div>
        <p
          className={`text-xs ${
            selectedTeam ? "text-gray-600" : "text-gray-400"
          }`}
        >
          {selectedTeam
            ? `Equipo seleccionado: ${
                selectedTeam.short_name ?? selectedTeam.name
              }`
            : "Selecciona un equipo para gestionar jugadores y partidos"}
        </p>
      </div>

      <div className="flex flex-col items-end">
        <button
          onClick={handleLogout}
          className="text-red-600 hover:text-red-800 text-sm font-semibold"
        >
          Cerrar sesión
        </button>

        {userEmail && <p className="text-xs text-gray-500 mt-1">{userEmail}</p>}
      </div>
    </nav>
  );
}
