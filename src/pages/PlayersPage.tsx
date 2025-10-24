import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useSelectedTeam } from "../context/SelectedTeamContext";
import LoadingIndicator from "../components/LoadingIndicator";
import { db, type Player } from "../services/dbLocal";
import { syncPlayers } from "../services/syncQueue";
import {
  exportTableToJSON,
  importTableFromJSON,
} from "../services/dataTransfer";
import { supabase } from "../services/dbCloud";

interface PlayerFormState {
  number: string;
  name: string;
  position: string;
  //active: boolean;
}

const INITIAL_FORM_STATE: PlayerFormState = {
  number: "",
  name: "",
  position: "",
  //active: true,
};

const POSITIONS = [
  "Portero",
  "Especialista Def.",
  "Extremo",
  "Pivote",
  "Primera Línea",
];

export default function PlayersPage() {
  const { selectedTeam } = useSelectedTeam();

  const [players, setPlayers] = useState<Player[]>([]);
  const [formState, setFormState] =
    useState<PlayerFormState>(INITIAL_FORM_STATE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingState, setEditingState] =
    useState<PlayerFormState>(INITIAL_FORM_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sortBy, setSortBy] = useState<"number" | "name" | "position">(
    "number"
  );

  const sortedPlayers = useMemo(() => {
    const sorted = [...players];

    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        break;
      case "position":
        sorted.sort((a, b) =>
          (a.position ?? "").localeCompare(b.position ?? "")
        );
        break;
      default:
        sorted.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
        break;
    }

    return sorted;
  }, [players, sortBy]);

  const resetFormState = useCallback(() => {
    setFormState(INITIAL_FORM_STATE);
  }, []);

  const loadPlayers = useCallback(async () => {
    if (!selectedTeam?.id) {
      setPlayers([]);
      return;
    }

    const playersFromDb = await db.players
      .where("team_id")
      .equals(selectedTeam.id)
      .filter((player) => !player.pending_delete)
      .toArray();

    setPlayers(playersFromDb);
  }, [selectedTeam?.id]);

  const syncPlayersForTeam = useCallback(async () => {
    if (!selectedTeam?.id) return;

    try {
      await syncPlayers(selectedTeam.id);
    } catch (error) {
      console.warn("Sincronización de jugadores fallida (offline?):", error);
    }
  }, [selectedTeam?.id]);

  useEffect(() => {
    let canceled = false;

    const initialize = async () => {
      if (!selectedTeam?.id) return;

      setIsLoading(true);
      try {
        await loadPlayers();
        await syncPlayersForTeam();
        await loadPlayers();
      } finally {
        if (!canceled) {
          setIsLoading(false);
        }
      }
    };

    void initialize();

    return () => {
      canceled = true;
    };
  }, [loadPlayers, selectedTeam?.id, syncPlayersForTeam]);

  useEffect(() => {
    if (editingId && !players.some((player) => player.id === editingId)) {
      setEditingId(null);
      setEditingState(INITIAL_FORM_STATE);
    }
  }, [players, editingId]);

  if (!selectedTeam) {
    return <Navigate to="/" replace />;
  }

  const handleFormChange = <K extends keyof PlayerFormState>(
    field: K,
    value: PlayerFormState[K]
  ) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditingChange = <K extends keyof PlayerFormState>(
    field: K,
    value: PlayerFormState[K]
  ) => {
    setEditingState((prev) => ({ ...prev, [field]: value }));
  };

  const parseNumber = (value: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const addPlayer = async () => {
    const name = formState.name.trim().toUpperCase();
    const number = parseNumber(formState.number);

    if (!name || number === null || !selectedTeam?.id) {
      return;
    }

    setIsProcessing(true);
    try {
      await db.players.add({
        id: crypto.randomUUID(),
        team_id: selectedTeam.id,
        name,
        number,
        position: formState.position.trim() || undefined,
        active: true,
        synced: false,
        pending_delete: false,
      });

      await loadPlayers();
      await syncPlayersForTeam();
      await loadPlayers();
      resetFormState();
    } finally {
      setIsProcessing(false);
    }
  };

  const startEditing = (player: Player) => {
    setEditingId(player.id ?? null);
    setEditingState({
      number: String(player.number ?? ""),
      name: player.name ?? "",
      position: player.position ?? "",
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingState(INITIAL_FORM_STATE);
  };

  const savePlayer = async () => {
    if (!editingId) return;

    const name = editingState.name.trim().toUpperCase();
    const number = parseNumber(editingState.number);

    if (!name || number === null) {
      return;
    }

    setIsProcessing(true);
    try {
      await db.players.update(editingId, {
        name,
        number,
        position: editingState.position.trim() || undefined,
        active: true,
        synced: false,
        pending_delete: false,
      });

      await loadPlayers();
      await syncPlayersForTeam();
      await loadPlayers();
      cancelEditing();
    } finally {
      setIsProcessing(false);
    }
  };

  const deletePlayer = async (player: Player) => {
    if (!player.id) return;

    setIsProcessing(true);
    try {
      if (!player.synced) {
        await db.players.delete(player.id);
      } else {
        await db.players.update(player.id, {
          pending_delete: true,
          synced: false,
        });
      }

      await loadPlayers();
      await syncPlayersForTeam();
      await loadPlayers();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="max-w-3xl mx-auto p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">
              Jugadores - {selectedTeam.short_name ?? selectedTeam.name}
            </h1>
            <p className="text-gray-600 text-sm">
              Gestiona el plantel del equipo seleccionado.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={async () => {
                setIsProcessing(true);
                try {
                  await exportTableToJSON("players");
                } finally {
                  setIsProcessing(false);
                }
              }}
              className="border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 px-3 py-2 rounded text-sm"
            >
              📤 Exportar
            </button>

            <label className="border border-gray-300 bg-gray-50 hover:bg-gray-100 text-gray-700 px-3 py-2 rounded text-sm cursor-pointer">
              📥 Importar
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  setIsProcessing(true);
                  try {
                    const { data: userData } = await supabase.auth.getUser();
                    const user_id = userData?.user?.id;
                    if (!user_id || !selectedTeam?.id) {
                      alert(
                        "❌ Falta usuario o equipo seleccionado. No se pudo importar."
                      );
                      return;
                    }
                    const count = await importTableFromJSON("players", file, {
                      setFields: { user_id, team_id: selectedTeam.id },
                      regenerateIds: true, // evita colisiones si importas de otro equipo/usuario
                      idField: "id",
                      map: (p: any) => ({
                        ...p,
                        // coherencia: nombre en MAYÚSCULAS, por si el JSON venía con otro formato
                        name: p.name?.toString().trim().toUpperCase(),
                      }),
                    });

                    // 🔄 Recarga la lista local y sincroniza con Supabase
                    await loadPlayers();
                    await syncPlayersForTeam();
                    await loadPlayers();

                    alert(`✅ Importados ${count} jugadores`);
                  } catch (err: any) {
                    console.error("❌ Error al importar:", err);
                    alert(`❌ Error al importar: ${err.message}`);
                  } finally {
                    // 🔁 Limpia el input para permitir volver a importar el mismo archivo si se quiere
                    setIsProcessing(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>
          </div>
        </div>

        <div className="mb-8 rounded border border-gray-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">Añadir jugador</h2>
          <div className="flex flex-wrap gap-3">
            <input
              className="border rounded px-3 py-2 w-24"
              placeholder="#"
              inputMode="numeric"
              value={formState.number}
              onChange={(e) => handleFormChange("number", e.target.value)}
            />
            <input
              className="border rounded px-3 py-2 flex-1 min-w-[10rem] uppercase"
              placeholder="Nombre"
              value={formState.name}
              onChange={(e) => handleFormChange("name", e.target.value)}
            />
            <select
              className="border rounded px-3 py-2 flex-1 min-w-[10rem]"
              value={formState.position}
              onChange={(e) => handleFormChange("position", e.target.value)}
            >
              <option value="">Selecciona posición</option>
              {POSITIONS.map((pos) => (
                <option key={pos} value={pos}>
                  {pos}
                </option>
              ))}
            </select>
            <button
              className="bg-blue-500 text-white px-4 py-2 rounded"
              onClick={() => void addPlayer()}
              disabled={isProcessing}
            >
              Añadir
            </button>
          </div>
        </div>
        {/* Botones de ordenación */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setSortBy("number")}
            className={`px-3 py-1.5 rounded border text-sm ${
              sortBy === "number"
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-700 hover:bg-gray-100 border-gray-300"
            }`}
          >
            Ordenar por dorsal
          </button>

          <button
            onClick={() => setSortBy("name")}
            className={`px-3 py-1.5 rounded border text-sm ${
              sortBy === "name"
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-700 hover:bg-gray-100 border-gray-300"
            }`}
          >
            Ordenar por nombre
          </button>

          <button
            onClick={() => setSortBy("position")}
            className={`px-3 py-1.5 rounded border text-sm ${
              sortBy === "position"
                ? "bg-blue-500 text-white border-blue-500"
                : "bg-white text-gray-700 hover:bg-gray-100 border-gray-300"
            }`}
          >
            Ordenar por posición
          </button>
        </div>

        {isLoading ? (
          <LoadingIndicator
            className="min-h-[30vh]"
            message="Cargando jugadores..."
          />
        ) : (
          <div className="space-y-4">
            {sortedPlayers.length === 0 ? (
              <p className="text-gray-500">
                Todavía no hay jugadores registrados.
              </p>
            ) : (
              <ul className="divide-y rounded border border-gray-200">
                {sortedPlayers.map((player) => (
                  <li
                    key={player.id}
                    className={`px-4 transition-all duration-300 ${
                      editingId === player.id ? "py-5 bg-gray-50" : "py-1"
                    }`}
                  >
                    {editingId === player.id ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          className="border rounded px-3 py-2 w-24"
                          placeholder="#"
                          inputMode="numeric"
                          value={editingState.number}
                          onChange={(e) =>
                            handleEditingChange("number", e.target.value)
                          }
                        />
                        <input
                          className="border rounded px-3 py-2 flex-1 min-w-[10rem] uppercase"
                          placeholder="Nombre"
                          value={editingState.name}
                          onChange={(e) =>
                            handleEditingChange("name", e.target.value)
                          }
                        />
                        <select
                          className="border rounded px-3 py-2 flex-1 min-w-[10rem]"
                          value={editingState.position}
                          onChange={(e) =>
                            handleEditingChange("position", e.target.value)
                          }
                        >
                          <option value="">Selecciona posición</option>
                          {POSITIONS.map((pos) => (
                            <option key={pos} value={pos}>
                              {pos}
                            </option>
                          ))}
                        </select>

                        <div className="flex gap-2">
                          <button
                            className="bg-green-500 text-white px-3 py-2 rounded"
                            onClick={() => void savePlayer()}
                            disabled={isProcessing}
                          >
                            Guardar
                          </button>
                          <button
                            className="border px-3 py-2 rounded"
                            onClick={cancelEditing}
                            disabled={isProcessing}
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3 flex-wrap sm:flex-nowrap">
                        {/* Información del jugador */}
                        <div className="flex items-center w-full sm:w-auto flex-1">
                          <span className="text-lg font-semibold w-12 text-right pr-2">
                            {player.number}
                          </span>

                          <span className="font-medium flex-1">
                            {player.name}
                          </span>

                          <span className="text-sm text-gray-600 w-40 text-left">
                            {player.position || "—"}
                          </span>
                        </div>

                        {/* Botones */}
                        <div className="flex gap-2 shrink-0">
                          <button
                            className="text-blue-600 hover:text-blue-800 px-3 py-1 text-sm"
                            onClick={() => startEditing(player)}
                            disabled={isProcessing}
                          >
                            Editar
                          </button>
                          <button
                            className="text-red-600 hover:text-red-800 px-3 py-1 text-sm"
                            onClick={() => void deletePlayer(player)}
                            disabled={isProcessing}
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isProcessing && !isLoading ? (
          <LoadingIndicator
            className="mt-8"
            message="Procesando datos..."
            aria-live="assertive"
          />
        ) : null}
      </div>
    </>
  );
}
