import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Team } from "../services/dbLocal";

interface SelectedTeamContextValue {
  selectedTeam: Pick<Team, "id" | "name" | "short_name"> | null;
  selectTeam: (team: Team) => void;
  clearTeam: () => void;
}

const SelectedTeamContext = createContext<SelectedTeamContextValue | undefined>(
  undefined
);

const STORAGE_KEY = "handtrack:selected-team";

export function SelectedTeamProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [selectedTeam, setSelectedTeam] = useState<
    Pick<Team, "id" | "name" | "short_name"> | null
  >(() => {
    if (typeof window === "undefined") return null;

    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored
        ? (JSON.parse(stored) as SelectedTeamContextValue["selectedTeam"])
        : null;
    } catch (error) {
      console.warn("No se pudo recuperar el equipo seleccionado", error);
      return null;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (selectedTeam) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedTeam));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, [selectedTeam]);

  const selectTeam = useCallback((team: Team) => {
    if (!team.id) return;

    setSelectedTeam({
      id: team.id,
      name: team.name,
      short_name: team.short_name,
    });
  }, []);

  const clearTeam = useCallback(() => {
    setSelectedTeam(null);
  }, []);

  const value = useMemo(
    () => ({
      selectedTeam,
      selectTeam,
      clearTeam,
    }),
    [selectedTeam, selectTeam, clearTeam]
  );

  return (
    <SelectedTeamContext.Provider value={value}>
      {children}
    </SelectedTeamContext.Provider>
  );
}

export function useSelectedTeam() {
  const context = useContext(SelectedTeamContext);
  if (!context) {
    throw new Error(
      "useSelectedTeam debe usarse dentro de un SelectedTeamProvider"
    );
  }

  return context;
}