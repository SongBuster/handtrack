import { Navigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useSelectedTeam } from "../context/SelectedTeamContext";

export default function PlayersPage() {
  const { selectedTeam } = useSelectedTeam();

  if (!selectedTeam) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <Navbar />
      <div className="max-w-3xl mx-auto p-4">
        <h1 className="text-2xl font-bold mb-4">
          Jugadores - {selectedTeam.short_name ?? selectedTeam.name}
        </h1>
        <p className="text-gray-600">
          Aquí podrás gestionar los jugadores del equipo seleccionado.
        </p>
      </div>
    </>
  );
}