import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { SelectedTeamProvider } from "./context/SelectedTeamContext";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <SelectedTeamProvider>
        <RouterProvider router={router} />
      </SelectedTeamProvider>      
    </div>
  );
}
