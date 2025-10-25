import type { FormEvent, ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useSelectedTeam } from "../context/SelectedTeamContext";
import LoadingIndicator from "../components/LoadingIndicator";
import Modal from "../components/Modal";
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

type ModalMode = "create" | "edit";

function normalizeOptional(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export default function MatchesPage() {
  const { selectedTeam } = useSelectedTeam();

  const [matches, setMatches] = useState<Match[]>([]);
  const [matchForm, setMatchForm] = useState<MatchFormState>(INITIAL_FORM_STATE);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
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

  if (!selectedTeam) {
    return <Navigate to="/" replace />;
  }

  const sortedMatches = useMemo(() => {
    const sorted = [...matches];

    if (sortBy === "rival") { 
      sorted.sort((a, b) =>  (a.rival_name ?? "").localeCompare(b.rival_name ?? ""));
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

  const openCreateModal = () => {
    setModalMode("create");
    setMatchForm(INITIAL_FORM_STATE);
    setActiveMatchId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (match: Match) => {
    setModalMode("edit");
    setMatchForm({
      rival_name: match.rival_name ?? "",
      date: match.date ?? "",
      location: match.location ?? "",
      competition: match.competition ?? "",
      is_home: match.is_home ? "home" : "away",
    });
    setActiveMatchId(match.id ?? null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setActiveMatchId(null);
    setMatchForm(INITIAL_FORM_STATE);  
  };

  const handleChange = <K extends keyof MatchFormState>(
    field: K,
    value: MatchFormState[K],
  ) => {
    setMatchForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleHomeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value === "home" ? "home" : "away";
    handleChange("is_home", value);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const rival = matchForm.rival_name.trim().toUpperCase();
    if (!selectedTeam?.id || rival.length === 0) {
      return;
    }

    setIsProcessing(true);
    try {
      if (modalMode === "create") {
        await db.matches.add({
          id: crypto.randomUUID(),
          my_team_id: selectedTeam.id,
          rival_name: rival,
          is_home: matchForm.is_home === "home",
          date: matchForm.date || undefined,
          location: normalizeOptional(matchForm.location),
          competition: normalizeOptional(matchForm.competition),
          active: true,
          current_time_ms: 0,
          synced: false,
          pending_delete: false,
        });
      } else {
        if (!activeMatchId) {
          return;
        }

        await db.matches.update(activeMatchId, {
          rival_name: rival,
          date: matchForm.date || undefined,
          location: normalizeOptional(matchForm.location),
          competition: normalizeOptional(matchForm.competition),
          is_home: matchForm.is_home === "home",
          synced: false,
          pending_delete: false,
        });
      }

      await loadMatches();
      await syncMatchesForTeam();
      await loadMatches();
      closeModal();
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

  const isSubmitDisabled =
    isProcessing || !selectedTeam?.id || matchForm.rival_name.trim().length === 0;

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-4xl p-4">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">
              Partidos - {selectedTeam.short_name ?? selectedTeam.name}
            </h1>
            <p className="text-sm text-gray-600">Gestiona los partidos programados y su estado.</p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={openCreateModal}
              className="rounded bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
              disabled={isProcessing}
              type="button"
            >
              Crear partido
            </button>

            <button
              onClick={() => setSortBy("date")}
              className={`rounded border px-3 py-1.5 text-sm ${
                sortBy === "date"
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
              }`}
              type="button"
            >
              Ordenar por fecha
            </button>

            <button
              onClick={() => setSortBy("rival")}
              className={`rounded border px-3 py-1.5 text-sm ${
                sortBy === "rival"
                  ? "border-blue-500 bg-blue-500 text-white"
                  : "border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
              }`}
              type="button"
            >
              Ordenar por rival
            </button>
          </div>
        </div>

        {isLoading ? (
          <LoadingIndicator className="min-h-[30vh]" message="Cargando partidos..." />
        ) : (
          <div className="space-y-4">
            {sortedMatches.length === 0 ? (
              <p className="text-gray-500">Todavía no hay partidos registrados.</p>
            ) : (
              <ul className="divide-y rounded border border-gray-200 bg-white">
                {sortedMatches.map((match) => (
                  <li key={match.id} className="px-4 py-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-900">{match.rival_name}</h3>
                          {match.active ? null : (
                            <span className="rounded bg-gray-800 px-2 py-1 text-xs text-white">Finalizado</span>
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

                      <div className="flex flex-wrap gap-2">
                        {match.active ? (                            
                          <button
                            className="rounded px-3 py-1 text-sm font-medium text-green-600 hover:bg-green-50"
                            onClick={() => void markAsFinished(match)}
                            disabled={isProcessing}
                            type="button"
                          >
                            Marcar finalizado
                          </button>
                        ) : null}
                         <button
                          className="rounded px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50"
                          onClick={() => openEditModal(match)}
                          disabled={isProcessing}
                          type="button"
                        >
                          Editar
                        </button>
                        <button
                          className="rounded px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
                          onClick={() => void deleteMatch(match)}
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
          title={modalMode === "create" ? "Crear partido" : "Editar partido"}
          onClose={closeModal}
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2 sm:col-span-2">
                <label className="text-sm font-medium text-gray-700" htmlFor="match-rival">
                  Rival
                </label>
                <input
                  id="match-rival"
                  className="rounded border px-3 py-2 uppercase"
                  placeholder="Rival"
                  value={matchForm.rival_name}
                  onChange={(event) => handleChange("rival_name", event.target.value)}
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700" htmlFor="match-date">
                  Fecha
                </label>
                <input
                  id="match-date"
                  type="date"
                  className="rounded border px-3 py-2"
                  value={matchForm.date}
                  onChange={(event) => handleChange("date", event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-gray-700">Condición</span>
                <div className="flex items-center gap-3 rounded border px-3 py-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="match-home"
                      value="home"
                      checked={matchForm.is_home === "home"}
                      onChange={handleHomeChange}
                    />
                    Local
                  </label>
                  <label className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="match-home"
                      value="away"
                      checked={matchForm.is_home === "away"}
                      onChange={handleHomeChange}
                    />
                    Visitante
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700" htmlFor="match-competition">
                  Competición
                </label>
                <input
                  id="match-competition"
                  className="rounded border px-3 py-2"
                  placeholder="Competición"
                  value={matchForm.competition}
                  onChange={(event) => handleChange("competition", event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2 sm:col-span-2">
                <label className="text-sm font-medium text-gray-700" htmlFor="match-location">
                  Lugar
                </label>
                <input
                  id="match-location"
                  className="rounded border px-3 py-2"
                  placeholder="Lugar"
                  value={matchForm.location}
                  onChange={(event) => handleChange("location", event.target.value)}
                />
              </div>
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
