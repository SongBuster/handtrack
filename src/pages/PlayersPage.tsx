import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useSelectedTeam } from "../context/SelectedTeamContext";
import LoadingIndicator from "../components/LoadingIndicator";
import Modal from "../components/Modal";
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
  const [formState, setFormState] = useState<PlayerFormState>(INITIAL_FORM_STATE);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activePlayerId, setActivePlayerId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sortBy, setSortBy] = useState<"number" | "name" | "position">("number");

  const sortedPlayers = useMemo(() => {
    const sorted = [...players];

    switch (sortBy) {
      case "name":
        sorted.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
        break;
      case "position":
        sorted.sort((a, b) => (a.position ?? "").localeCompare(b.position ?? ""));
        break;
      default:
        sorted.sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
        break;
    }

    return sorted;
  }, [players, sortBy]);

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

  if (!selectedTeam) {
    return <Navigate to="/" replace />;
  }

  const openCreateModal = () => {
    setModalMode("create");
    setFormState(INITIAL_FORM_STATE);
    setActivePlayerId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (player: Player) => {
    setModalMode("edit");
    setFormState({
      number: String(player.number ?? ""),
      name: player.name ?? "",
      position: player.position ?? "",
    });
    setActivePlayerId(player.id ?? null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setActivePlayerId(null);
    setFormState(INITIAL_FORM_STATE);
  };

  const handleFormChange = <K extends keyof PlayerFormState>(
    field: K,
    value: PlayerFormState[K],
  ) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const parseNumber = (value: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const name = formState.name.trim().toUpperCase();
    const number = parseNumber(formState.number);

    if (!name || number === null || !selectedTeam?.id) {
      return;
    }

    setIsProcessing(true);
    try {
      if (modalMode === "create") {
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
      } else {
        if (!activePlayerId) {
          return;
        }

        await db.players.update(activePlayerId, {
          name,
          number,
          position: formState.position.trim() || undefined,
          active: true,
          synced: false,
          pending_delete: false,
        });
      }

      await loadPlayers();
      await syncPlayersForTeam();
      await loadPlayers();
      closeModal();
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

    const isSubmitDisabled =
    isProcessing ||
    !selectedTeam?.id ||
    formState.name.trim().length === 0 ||
    parseNumber(formState.number) === null;

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-3xl p-4">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Jugadores - {selectedTeam.short_name ?? selectedTeam.name}
            </h1>
            <p className="text-sm text-gray-600">Gestiona el plantel del equipo seleccionado.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={openCreateModal}
              className="rounded bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              disabled={isProcessing}
              type="button"
            >
              Añadir jugador
            </button>

            <button
              onClick={async () => {
                setIsProcessing(true);
                try {
                  await exportTableToJSON("players");
                } finally {
                  setIsProcessing(false);
                }
              }}
              className="rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100"
              disabled={isProcessing}
              type="button"
            >
              📤 Exportar
            </button>

            <label
              className={`rounded border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-100 ${
                isProcessing ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              }`}
            >
              📥 Importar
              <input
                type="file"
                accept="application/json"
                className="hidden"
                disabled={isProcessing}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;

                  setIsProcessing(true);
                  try {
                    const { data: userData } = await supabase.auth.getUser();
                    const user_id = userData?.user?.id;
                    if (!user_id || !selectedTeam?.id) {
                      alert("❌ Falta usuario o equipo seleccionado. No se pudo importar.");
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
                    setIsProcessing(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>
          </div>
        </div>

        <div className="mb-6 flex gap-2">
          <button
            onClick={() => setSortBy("number")}
            className={`rounded border px-3 py-1.5 text-sm ${
              sortBy === "number"
                ? "border-blue-500 bg-blue-500 text-white"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
            }`}
            type="button"
          >
            Ordenar por dorsal
          </button>

          <button
            onClick={() => setSortBy("name")}
            className={`rounded border px-3 py-1.5 text-sm ${
              sortBy === "name"
                ? "border-blue-500 bg-blue-500 text-white"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
            }`}
            type="button"
          >
            Ordenar por nombre
          </button>

          <button
            onClick={() => setSortBy("position")}
            className={`rounded border px-3 py-1.5 text-sm ${
              sortBy === "position"
                ? "border-blue-500 bg-blue-500 text-white"
                : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
            }`}
            type="button"
          >
            Ordenar por posición
          </button>
        </div>

        {isLoading ? (
          <LoadingIndicator className="min-h-[30vh]" message="Cargando jugadores..."/>
        ) : (
          <div className="space-y-4">
            {sortedPlayers.length === 0 ? (
               <p className="text-gray-500">Todavía no hay jugadores registrados.</p>
            ) : (
              <ul className="divide-y rounded border border-gray-200 bg-white">
                {sortedPlayers.map((player) => (
                  <li key={player.id} className="px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <span className="w-12 text-right text-lg font-semibold text-gray-800">
                          {player.number}
                        </span>
                        <span className="flex-1 font-medium text-gray-900">{player.name}</span>
                        <span className="w-40 text-sm text-gray-600">
                          {player.position || "—"}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="rounded px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50"
                          onClick={() => openEditModal(player)}
                          disabled={isProcessing}
                          type="button"
                        >
                          Editar
                        </button>
                        <button
                          className="rounded px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
                          onClick={() => void deletePlayer(player)}
                          disabled={isProcessing}
                          type="button"
                        >
                          Eliminar
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {isProcessing && !isLoading ? (
          <LoadingIndicator className="mt-8" message="Procesando datos..." aria-live="assertive" />
        ) : null}
      </div>

      {isModalOpen ? (
        <Modal
          title={modalMode === "create" ? "Añadir jugador" : "Editar jugador"}
          onClose={closeModal}
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700" htmlFor="player-number">
                  Dorsal
                </label>
                <input
                  id="player-number"
                  className="rounded border px-3 py-2"
                  placeholder="#"
                  inputMode="numeric"
                  value={formState.number}
                  onChange={(event) => handleFormChange("number", event.target.value)}
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2 sm:col-span-1">
                <label className="text-sm font-medium text-gray-700" htmlFor="player-position">
                  Posición
                </label>
                <select
                  id="player-position"
                  className="rounded border px-3 py-2"
                  value={formState.position}
                  onChange={(event) => handleFormChange("position", event.target.value)}
                >
                  <option value="">Selecciona posición</option>
                  {POSITIONS.map((pos) => (
                    <option key={pos} value={pos}>
                      {pos}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700" htmlFor="player-name">
                Nombre
              </label>
              <input
                id="player-name"
                className="rounded border px-3 py-2 uppercase"
                placeholder="Nombre"
                value={formState.name}
                onChange={(event) => handleFormChange("name", event.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="rounded px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitDisabled}
                className={`rounded px-4 py-2 text-sm font-medium ${
                  isSubmitDisabled
                    ? "cursor-not-allowed bg-blue-200 text-blue-700"
                    : "bg-blue-500 text-white transition-colors hover:bg-blue-600"
                }`}
              >
                {modalMode === "create" ? "Crear" : "Guardar"}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
