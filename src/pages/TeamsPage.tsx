import { useEffect, useState } from "react";
import { db, type Team } from "../services/dbLocal";
import Navbar from "../components/Navbar";
import { supabase } from "../services/dbCloud";
import { syncTeams } from "../services/syncQueue";

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");

  async function refreshTeamsForUser(userId: string | null | undefined) {
    if (!userId) {
      setTeams([]);
      return;
    }

    const teamsFromDb = await db.teams
      .where("user_id")
      .equals(userId)
      .toArray();
    setTeams(teamsFromDb);
  }

  useEffect(() => {
    let canceled = false;

    const initializeTeams = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const userId = data.user?.id ?? null;

        if (!canceled) {
          await refreshTeamsForUser(userId);
        }

        try {
          await syncTeams();
        } catch (error) {
          console.warn("Sincronización fallida (offline?):", error);
        }

        if (!canceled) {
          await refreshTeamsForUser(userId);
        }
      } catch (error) {
        console.error("Error al inicializar equipos:", error);
      }
    };

    void initializeTeams();

    return () => {
      canceled = true;
    };
  }, []);

  async function addTeam() {
    if (!name) return;

    const { data: userData } = await supabase.auth.getUser();
    const user_id = userData.user?.id;

    const newTeam = {
      id: crypto.randomUUID(),
      name,
      short_name: shortName,
      user_id: user_id,
      synced: false,
    };

    await db.teams.add(newTeam);

    try {
      await syncTeams(); // sincroniza si hay conexión
    } catch (error) {
      console.warn("Sincronización fallida (offline?):", error);
    }

    await refreshTeamsForUser(user_id ?? null);
    setName("");
    setShortName("");
  }

  return (
    <>
      <Navbar />
      <div className="max-w-md mx-auto p-4">
        <h1 className="text-2xl font-bold mb-3">Equipos</h1>

        <div className="flex gap-2 mb-4">
          <input
            className="border rounded px-2 py-1 flex-1"
            placeholder="Nombre del equipo"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className="border rounded px-2 py-1 w-24"
            placeholder="Abrev."
            value={shortName}
            onChange={(e) => setShortName(e.target.value)}
          />
          <button
            className="bg-blue-500 text-white px-3 py-1 rounded"
            onClick={addTeam}
          >
            +
          </button>
        </div>

        <ul className="divide-y">
          {teams.map((t) => (
            <li key={t.id} className="py-2">
              <span className="font-semibold">{t.name}</span>
              {t.short_name && (
                <span className="text-gray-500 ml-2">({t.short_name})</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
