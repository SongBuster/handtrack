import { createBrowserRouter } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import TeamsPage from "./pages/TeamsPage";
import PlayersPage from "./pages/PlayersPage";
import MatchesPage from "./pages/MatchesPage";
import SituationsPage from "./pages/SituationsPage";
import RequireAuth from "./components/RequireAuth";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: <RequireAuth><TeamsPage /></RequireAuth>  },
  { path: "/players", element: <RequireAuth><PlayersPage /></RequireAuth> },
  { path: "/matches", element: <RequireAuth><MatchesPage /></RequireAuth> },
  { path: "/situations", element: <RequireAuth><SituationsPage /></RequireAuth> },
]);
