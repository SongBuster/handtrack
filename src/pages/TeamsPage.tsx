import { useEffect, useState } from "react";
import { db, type Team } from "../services/dbLocal";
import Navbar from "../components/Navbar";
import LoadingIndicator from "../components/LoadingIndicator";
import { supabase } from "../services/dbCloud";
import { syncTeams } from "../services/syncQueue";
import { useSelectedTeam } from "../context/SelectedTeamContext";

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingShortName, setEditingShortName] = useState("");
  const { selectedTeam, selectTeam, clearTeam } = useSelectedTeam();
  const [isLoading, setIsLoading] = useState(true);


  async function refreshTeamsForUser(userId: string | null | undefined) {
    if (!userId) {
      setTeams([]);
      return;
    }

    const teamsFromDb = await db.teams
      .where("user_id")
      .equals(userId)
      .and((team) => team.pending_delete || false === false)
      .toArray();
    setTeams(teamsFromDb);
  }

  async function refreshCurrentUserTeams() {
    const { data } = await supabase.auth.getUser();
    await refreshTeamsForUser(data.user?.id ?? null);
  }

  useEffect(() => {
    let canceled = false;

    const initializeTeams = async () => {
      setIsLoading(true);
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
      } finally {
        if (!canceled) {
          setIsLoading(false);
        }
      }
    };

    void initializeTeams();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    if (selectedTeam && !teams.some((team) => team.id === selectedTeam.id)) {
      clearTeam();
    }
  }, [teams, selectedTeam, clearTeam]);

  async function addTeam() {
    if (!name.trim()) return;

    const { data: userData } = await supabase.auth.getUser();
    const user_id = userData.user?.id;

    if (!user_id) return;

    const newTeam = {
      id: crypto.randomUUID(),
      name: name.trim(),
      short_name: shortName.trim().toUpperCase() || undefined,
      user_id: user_id,
      synced: false,
      pending_delete: false,
    };

    await db.teams.add(newTeam);

    try {
      await syncTeams(); // sincroniza si hay conexión
    } catch (error) {
      console.warn("Sincronización fallida (offline?):", error);
    }

    await refreshCurrentUserTeams();
    setName("");
    setShortName("");
  }

  function startEditing(team: Team) {
    setEditingId(team.id ?? null);
    setEditingName(team.name);
    setEditingShortName(team.short_name?.toUpperCase() ?? "");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditingName("");
    setEditingShortName("");
  }

  async function saveEditing(teamId: string | undefined) {
    if (!teamId) return;
    if (!editingName.trim()) return;

    await db.teams.update(teamId, {
      name: editingName.trim(),
      short_name: editingShortName.trim().toUpperCase() || undefined,
      synced: false,
    });

    try {
      await syncTeams();
    } catch (error) {
      console.warn("Sincronización fallida (offline?):", error);
    }

    await refreshCurrentUserTeams();
    cancelEditing();
  }

  async function deleteTeam(team: Team) {
    if (!team.id) return;

    if (editingId === team.id) {
      cancelEditing();
    }

    if (selectedTeam?.id === team.id) {
      clearTeam();
    }    

    if (!team.synced) {
      await db.teams.delete(team.id);
    } else {
      await db.teams.update(team.id, { pending_delete: true, synced: false });
    }

    try {
      await syncTeams();
    } catch (error) {
      console.warn("Sincronización fallida (offline?):", error);
    }

    await refreshCurrentUserTeams();
  }

  if (isLoading) {
    return (
      <>
        <Navbar />
        <LoadingIndicator className="min-h-[50vh]" message="Cargando equipos..." />
      </>
    );
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
            className="border rounded px-2 py-1 w-24 uppercase"
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
            <li
              key={t.id}
              className={`py-2 px-2 flex items-center gap-2 rounded cursor-pointer transition ${
                selectedTeam?.id === t.id
                  ? "bg-blue-50 border border-blue-200"
                  : "hover:bg-gray-50"
              }`}
              onClick={() => {
                if (editingId !== t.id) {
                  selectTeam(t);
                }
              }}
            >
              {editingId === t.id ? (
                <>
                  <input
                    className="border rounded px-2 py-1 flex-1"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                  />
                  <input
                    className="border rounded px-2 py-1 w-24 uppercase"
                    value={editingShortName}
                    onChange={(e) => setEditingShortName(e.target.value)}
                  />
                  <button
                    className="bg-green-500 text-white px-3 py-1 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      void saveEditing(t.id);
                    }}
                  >
                    Guardar
                  </button>
                  <button
                    className="border px-3 py-1 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      cancelEditing();
                    }}
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <span className="font-semibold">{t.name}</span>
                    {t.short_name && (
                      <span className="text-gray-500 ml-2">({t.short_name})</span>
                    )}
                  </div>
                  <button
                    className="text-blue-600 px-2 py-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(t);
                    }}
                  >
                    Editar
                  </button>
                  <button
                    className="text-red-600 px-2 py-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteTeam(t);
                    }}
                  >
                    Eliminar
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
