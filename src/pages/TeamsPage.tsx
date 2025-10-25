import { FormEvent } from "react";
import { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import Modal from "../components/Modal";
import { db, type Team } from "../services/dbLocal";
import LoadingIndicator from "../components/LoadingIndicator";
import { supabase } from "../services/dbCloud";
import { syncTeams } from "../services/syncQueue";
import { useSelectedTeam } from "../context/SelectedTeamContext";

interface TeamFormState {
  name: string;
  shortName: string;
}

type ModalMode = "create" | "edit";

const DEFAULT_FORM_STATE: TeamFormState = {
  name: "",
  shortName: "",
};

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamForm, setTeamForm] = useState<TeamFormState>(DEFAULT_FORM_STATE);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
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

  const openCreateModal = () => {
    setModalMode("create");
    setTeamForm(DEFAULT_FORM_STATE);
    setActiveTeamId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (team: Team) => {
    setModalMode("edit");
    setTeamForm({
      name: team.name ?? "",
      shortName: team.short_name?.toUpperCase() ?? "",
    });
    setActiveTeamId(team.id ?? null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setActiveTeamId(null);
    setTeamForm(DEFAULT_FORM_STATE);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = teamForm.name.trim();
    if (!trimmedName) {
      return;
    }

    setIsProcessing(true);
    try {
      if (modalMode === "create") {
        const { data: userData } = await supabase.auth.getUser();
        const user_id = userData.user?.id;

        if (!user_id) {
          return;
        }

        const newTeam = {
          id: crypto.randomUUID(),
          name: trimmedName,
          short_name: teamForm.shortName.trim().toUpperCase() || undefined,
          user_id,
          synced: false,
          pending_delete: false,
        } satisfies Team;

        await db.teams.add(newTeam);
      } else {
        if (!activeTeamId) {
          return;
        }

        await db.teams.update(activeTeamId, {
          name: trimmedName,
          short_name: teamForm.shortName.trim().toUpperCase() || undefined,
          synced: false,
        });

        if (selectedTeam?.id === activeTeamId) {
          const updatedTeam = await db.teams.get(activeTeamId);
          if (updatedTeam) {
            selectTeam(updatedTeam);
          }
        }
      }

      try {
        await syncTeams();
      } catch (error) {
        console.warn("Sincronización fallida (offline?):", error);
      }

      await refreshCurrentUserTeams();
      closeModal();
    } finally {
      setIsProcessing(false);
    }
  };

  async function deleteTeam(team: Team) {
    if (!team.id) return;

    setIsProcessing(true);
    try {
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
    } finally {
      setIsProcessing(false);
    }
  }

  const isSubmitDisabled =
    isProcessing || teamForm.name.trim().length === 0;

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
      <div className="mx-auto max-w-2xl p-4">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold">Equipos</h1>
          <button
            type="button"
            onClick={openCreateModal}
            className="self-start rounded bg-blue-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-600"
          >
            Crear equipo
          </button>
        </div>

        {teams.length === 0 ? (
          <p className="rounded border border-dashed border-gray-300 p-6 text-center text-gray-500">
            Todavía no hay equipos registrados.
          </p>
        ) : (
          <ul className="divide-y rounded border border-gray-200 bg-white shadow-sm">
            {teams.map((team) => (
              <li
                key={team.id}
                className={`flex items-center justify-between gap-3 px-4 py-3 transition-colors ${
                  selectedTeam?.id === team.id
                    ? "bg-blue-50"
                    : "hover:bg-gray-50"
                }`}
                onClick={() => selectTeam(team)}
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-gray-800">{team.name}</span>
                  {team.short_name ? (
                    <span className="text-sm text-gray-500">{team.short_name}</span>
                  ) : null}
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded px-3 py-1 text-sm font-medium text-blue-600 hover:bg-blue-50"
                    onClick={(event) => {
                      event.stopPropagation();
                      openEditModal(team);
                    }}
                    disabled={isProcessing}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="rounded px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteTeam(team);
                    }}
                    disabled={isProcessing}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {isModalOpen ? (
        <Modal
          title={modalMode === "create" ? "Crear equipo" : "Editar equipo"}
          onClose={closeModal}
          className="max-w-md"
        >
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700" htmlFor="team-name">
                Nombre
              </label>
              <input
                id="team-name"
                className="rounded border px-3 py-2"
                placeholder="Nombre del equipo"
                value={teamForm.name}
                onChange={(event) =>
                  setTeamForm((prev) => ({ ...prev, name: event.target.value }))
                }
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700" htmlFor="team-short-name">
                Abreviatura
              </label>
              <input
                id="team-short-name"
                className="rounded border px-3 py-2 uppercase"
                placeholder="Abrev."
                value={teamForm.shortName}
                onChange={(event) =>
                  setTeamForm((prev) => ({
                    ...prev,
                    shortName: event.target.value.toUpperCase(),
                  }))
                }
                maxLength={10}
              />
              <p className="text-xs text-gray-500">
                Opcional. Se usará en tablas y listados cortos.
              </p>
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
