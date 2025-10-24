import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from "react";
import { Navigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useSelectedTeam } from "../context/SelectedTeamContext";
import LoadingIndicator from "../components/LoadingIndicator";
import { db, type Match } from "../services/dbLocal";
import { syncMatches } from "../services/syncQueue";

interface MatchFormState {
  rival_name: string;
  date: string;
  location: string;
  competition: string;
  is_home: "home" | "away";
}

const INITIAL_FORM_STATE: MatchFormState = {
  rival_name: "",
  date: "",
  location: "",
  competition: "",
  is_home: "home",
};

function normalizeOptional(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export default function MatchesPage() {
  const { selectedTeam } = useSelectedTeam();

    const [matches, setMatches] = useState<Match[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [formState, setFormState] =
    useState<MatchFormState>(INITIAL_FORM_STATE);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingState, setEditingState] =
    useState<MatchFormState>(INITIAL_FORM_STATE);
  const [sortBy, setSortBy] = useState<"date" | "rival">("date");

  const loadMatches = useCallback(async () => {
    if (!selectedTeam?.id) {
      setMatches([]);
      return;
    }

    const matchesFromDb = await db.matches
      .where("my_team_id")
      .equals(selectedTeam.id)
      .filter((match) => !match.pending_delete)
      .toArray();

    setMatches(matchesFromDb);
  }, [selectedTeam?.id]);

  const syncMatchesForTeam = useCallback(async () => {
    if (!selectedTeam?.id) return;

    try {
      await syncMatches(selectedTeam.id);
    } catch (error) {
      console.warn("Sincronización de partidos fallida (offline?):", error);
    }
  }, [selectedTeam?.id]);

  useEffect(() => {
    let canceled = false;

    const initialize = async () => {
      if (!selectedTeam?.id) return;
      setIsLoading(true);
      try {
        await loadMatches();
        await syncMatchesForTeam();
        await loadMatches();
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
  }, [loadMatches, selectedTeam?.id, syncMatchesForTeam]);

  useEffect(() => {
    if (editingId && !matches.some((match) => match.id === editingId)) {
      setEditingId(null);
      setEditingState(INITIAL_FORM_STATE);
    }
  }, [matches, editingId]);

  const sortedMatches = useMemo(() => {
    const sorted = [...matches];

    if (sortBy === "rival") {
      sorted.sort((a, b) =>
        (a.rival_name ?? "").localeCompare(b.rival_name ?? "")
      );
    } else {
      sorted.sort((a, b) => {
        const aDate = a.date ?? "";
        const bDate = b.date ?? "";
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1;
        if (!bDate) return -1;
        return bDate.localeCompare(aDate);
      });
    }

    return sorted;
  }, [matches, sortBy]);
  
  if (!selectedTeam) {
    return <Navigate to="/" replace />;
  }

  type MatchFormChangeHandler = <K extends keyof MatchFormState>(
    field: K,
    value: MatchFormState[K]
  ) => void;

  const handleFormChange: MatchFormChangeHandler = (field, value) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditingChange: MatchFormChangeHandler = (field, value) => {
    setEditingState((prev) => ({ ...prev, [field]: value }));
  };

  const handleBooleanChange = (
    event: ChangeEvent<HTMLInputElement>,
    handler: MatchFormChangeHandler
  ) => {
    const value = event.target.value === "home" ? "home" : "away";
    handler("is_home", value as MatchFormState["is_home"]);
  };

  const addMatch = async () => {
    const rival = formState.rival_name.trim().toUpperCase();

    if (!selectedTeam?.id || rival.length === 0) {
      return;
    }

    setIsProcessing(true);
    try {
      await db.matches.add({
        id: crypto.randomUUID(),
        my_team_id: selectedTeam.id,
        rival_name: rival,
        is_home: formState.is_home === "home",
        date: formState.date || undefined,
        location: normalizeOptional(formState.location),
        competition: normalizeOptional(formState.competition),
        active: true,
        current_time_ms: 0,
        synced: false,
        pending_delete: false,
      });

      await loadMatches();
      await syncMatchesForTeam();
      await loadMatches();
      setFormState(INITIAL_FORM_STATE);
    } finally {
      setIsProcessing(false);
    }
  };

  const startEditing = (match: Match) => {
    setEditingId(match.id ?? null);
    setEditingState({
      rival_name: match.rival_name ?? "",
      date: match.date ?? "",
      location: match.location ?? "",
      competition: match.competition ?? "",
      is_home: match.is_home ? "home" : "away",
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingState(INITIAL_FORM_STATE);
  };

  const saveMatch = async () => {
    if (!editingId) return;

    const rival = editingState.rival_name.trim().toUpperCase();
    if (rival.length === 0) {
      return;
    }

    setIsProcessing(true);
    try {
      await db.matches.update(editingId, {
        rival_name: rival,
        date: editingState.date || undefined,
        location: normalizeOptional(editingState.location),
        competition: normalizeOptional(editingState.competition),
        is_home: editingState.is_home === "home",
        synced: false,
        pending_delete: false,
      });

      await loadMatches();
      await syncMatchesForTeam();
      await loadMatches();
      cancelEditing();
    } finally {
      setIsProcessing(false);
    }
  };

  const deleteMatch = async (match: Match) => {
    if (!match.id) return;

    setIsProcessing(true);
    try {
      if (!match.synced) {
        await db.matches.delete(match.id);
      } else {
        await db.matches.update(match.id, {
          pending_delete: true,
          synced: false,
        });
      }

      await loadMatches();
      await syncMatchesForTeam();
      await loadMatches();
    } finally {
      setIsProcessing(false);
    }
  };

  const markAsFinished = async (match: Match) => {
    if (!match.id) return;

    setIsProcessing(true);
    try {
      await db.matches.update(match.id, {
        active: false,
        synced: false,
        pending_delete: false,
      });

      await loadMatches();
      await syncMatchesForTeam();
      await loadMatches();
    } finally {
      setIsProcessing(false);
    }
  };
  
  return (
    <>
      <Navbar />
      <div className="max-w-4xl mx-auto p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold">
              Partidos - {selectedTeam.short_name ?? selectedTeam.name}
            </h1>
            <p className="text-gray-600 text-sm">
              Gestiona los partidos programados y su estado.
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setSortBy("date")}
              className={`px-3 py-1.5 rounded border text-sm ${
                sortBy === "date"
                  ? "bg-blue-500 text-white border-blue-500"
                  : "bg-white text-gray-700 hover:bg-gray-100 border-gray-300"
              }`}
            >
              Ordenar por fecha
            </button>

            <button
              onClick={() => setSortBy("rival")}
              className={`px-3 py-1.5 rounded border text-sm ${
                sortBy === "rival"
                  ? "bg-blue-500 text-white border-blue-500"
                  : "bg-white text-gray-700 hover:bg-gray-100 border-gray-300"
              }`}
            >
              Ordenar por rival
            </button>
          </div>
        </div>

        <div className="mb-8 rounded border border-gray-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">Añadir partido</h2>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <input
              className="border rounded px-3 py-2 uppercase"
              placeholder="Rival"
              value={formState.rival_name}
              onChange={(e) => handleFormChange("rival_name", e.target.value)}
            />

            <div className="flex items-center gap-3">
              <label className="text-sm font-medium text-gray-600">Local</label>
              <input
                type="radio"
                name="new-match-home"
                value="home"
                checked={formState.is_home === "home"}
                onChange={(event) => handleBooleanChange(event, handleFormChange)}
              />
              <label className="text-sm font-medium text-gray-600">Visitante</label>
              <input
                type="radio"
                name="new-match-home"
                value="away"
                checked={formState.is_home === "away"}
                onChange={(event) => handleBooleanChange(event, handleFormChange)}
              />
            </div>

            <input
              type="date"
              className="border rounded px-3 py-2"
              value={formState.date}
              onChange={(e) => handleFormChange("date", e.target.value)}
            />

            <input
              className="border rounded px-3 py-2"
              placeholder="Competición"
              value={formState.competition}
              onChange={(e) => handleFormChange("competition", e.target.value)}
            />

            <input
              className="border rounded px-3 py-2 sm:col-span-2"
              placeholder="Lugar"
              value={formState.location}
              onChange={(e) => handleFormChange("location", e.target.value)}
            />
          </div>
          <button
            className="mt-4 bg-blue-500 text-white px-4 py-2 rounded"
            onClick={() => void addMatch()}
            disabled={isProcessing}
          >
            Añadir partido
          </button>
        </div>

        {isLoading ? (
          <LoadingIndicator
            className="min-h-[30vh]"
            message="Cargando partidos..."
          />
        ) : (
          <div className="space-y-4">
            {sortedMatches.length === 0 ? (
              <p className="text-gray-500">
                Todavía no hay partidos registrados.
              </p>
            ) : (
              <ul className="divide-y rounded border border-gray-200">
                {sortedMatches.map((match) => (
                  <li
                    key={match.id}
                    className={`px-4 transition-all duration-300 ${
                      editingId === match.id ? "py-5 bg-gray-50" : "py-3"
                    }`}
                  >
                    {editingId === match.id ? (
                      <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
                        <input
                          className="border rounded px-3 py-2 uppercase"
                          placeholder="Rival"
                          value={editingState.rival_name}
                          onChange={(e) =>
                            handleEditingChange("rival_name", e.target.value)
                          }
                        />

                        <div className="flex items-center gap-3">
                          <label className="text-sm font-medium text-gray-600">
                            Local
                          </label>
                          <input
                            type="radio"
                            name={`edit-match-home-${match.id}`}
                            value="home"
                            checked={editingState.is_home === "home"}
                            onChange={(event) =>
                              handleBooleanChange(event, handleEditingChange)
                            }
                          />
                          <label className="text-sm font-medium text-gray-600">
                            Visitante
                          </label>
                          <input
                            type="radio"
                            name={`edit-match-home-${match.id}`}
                            value="away"
                            checked={editingState.is_home === "away"}
                            onChange={(event) =>
                              handleBooleanChange(event, handleEditingChange)
                            }
                          />
                        </div>

                        <input
                          type="date"
                          className="border rounded px-3 py-2"
                          value={editingState.date}
                          onChange={(e) =>
                            handleEditingChange("date", e.target.value)
                          }
                        />

                        <input
                          className="border rounded px-3 py-2"
                          placeholder="Competición"
                          value={editingState.competition}
                          onChange={(e) =>
                            handleEditingChange("competition", e.target.value)
                          }
                        />

                        <input
                          className="border rounded px-3 py-2 sm:col-span-2"
                          placeholder="Lugar"
                          value={editingState.location}
                          onChange={(e) =>
                            handleEditingChange("location", e.target.value)
                          }
                        />

                        <div className="flex gap-2 sm:col-span-2">
                          <button
                            className="bg-green-500 text-white px-3 py-2 rounded"
                            onClick={() => void saveMatch()}
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
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-lg font-semibold">
                              {match.rival_name}
                            </h3>
                            {match.active ? null : (
                              <span className="text-xs bg-gray-800 text-white px-2 py-1 rounded">
                                Finalizado
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600">
                            {match.competition || "Competición pendiente"}
                          </p>
                          <p className="text-sm text-gray-500">
                            {match.date
                              ? new Date(match.date).toLocaleDateString()
                              : "Fecha pendiente"}
                            {" • "}
                            {match.is_home ? "Local" : "Visitante"}
                            {match.location ? ` • ${match.location}` : ""}
                          </p>
                        </div>

                        <div className="flex gap-2 flex-wrap">
                          {match.active && (
                            <button
                              className="text-green-600 hover:text-green-800 px-3 py-1 text-sm"
                              onClick={() => void markAsFinished(match)}
                              disabled={isProcessing}
                            >
                              Marcar finalizado
                            </button>
                          )}
                          <button
                            className="text-blue-600 hover:text-blue-800 px-3 py-1 text-sm"
                            onClick={() => startEditing(match)}
                            disabled={isProcessing}
                          >
                            Editar
                          </button>
                          <button
                            className="text-red-600 hover:text-red-800 px-3 py-1 text-sm"
                            onClick={() => void deleteMatch(match)}
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