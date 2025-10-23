import { Navigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useSelectedTeam } from "../context/SelectedTeamContext";

export default function MatchesPage() {
  const { selectedTeam } = useSelectedTeam();

  if (!selectedTeam) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <Navbar />
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">
          Partidos - {selectedTeam.short_name ?? selectedTeam.name}
        </h1>
        <p className="text-gray-600">
          Aquí podrás gestionar los partidos del equipo seleccionado.
        </p>
      </div>
    </>
  );
}