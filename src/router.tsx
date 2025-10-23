import { createBrowserRouter } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import TeamsPage from "./pages/TeamsPage";
import RequireAuth from "./components/RequireAuth";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/", element: <RequireAuth><TeamsPage /></RequireAuth>  },
]);
