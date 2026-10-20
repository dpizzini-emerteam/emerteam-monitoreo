import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, Outlet, RouterProvider } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import "./estilos.css";
import { miRol, supabase, type RolEquipo } from "./datos";
import { Login } from "./paginas/Login";
import { Eventos } from "./paginas/Eventos";
import { EventoVista } from "./paginas/EventoVista";
import { Equipo } from "./paginas/Equipo";
import { Pie } from "./componentes/Pie";

// El formulario carga el mapa: se descarga solo cuando se usa
const EventoForm = lazy(() => import("./paginas/EventoForm").then((m) => ({ default: m.EventoForm })));

/** admin: integra el equipo EMERTEAM (ve todo); editor: además edita y administra el equipo */
export type Ctx = { session: Session; admin: boolean; editor: boolean };

function Raiz() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [rol, setRol] = useState<RolEquipo | null | undefined>(undefined); // undefined: cargando

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      // Limpia de la barra el código o token del enlace de ingreso
      const u = new URL(window.location.href);
      if (u.searchParams.has("code") || /access_token|error_description/.test(u.hash)) {
        window.history.replaceState(null, "", u.origin + u.pathname + "#/");
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user.email) miRol(session.user.email).then(setRol);
  }, [session]);

  if (session === undefined) return null;
  if (!session) return <Login />;
  if (rol === undefined) return null;
  return (
    <>
      <Suspense fallback={null}>
        <Outlet context={{ session, admin: rol !== null, editor: rol === "editor" } satisfies Ctx} />
      </Suspense>
      <Pie />
    </>
  );
}

const router = createHashRouter([
  {
    path: "/",
    element: <Raiz />,
    children: [
      { index: true, element: <Eventos /> },
      { path: "evento/nuevo", element: <EventoForm /> },
      { path: "evento/:id/editar", element: <EventoForm /> },
      { path: "evento/:id/:pestana?", element: <EventoVista /> },
      { path: "equipo", element: <Equipo /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
