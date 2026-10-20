import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Outlet, RouterProvider } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import "./estilos.css";
import { esAdmin, supabase } from "./datos";
import { Login } from "./paginas/Login";
import { Eventos } from "./paginas/Eventos";
import { EventoVista } from "./paginas/EventoVista";
import { Pie } from "./componentes/Pie";

// El formulario carga el mapa: se descarga solo cuando se usa
const EventoForm = lazy(() => import("./paginas/EventoForm").then((m) => ({ default: m.EventoForm })));

export type Ctx = { session: Session; admin: boolean };

function Raiz() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) esAdmin().then(setAdmin);
  }, [session]);

  if (session === undefined) return null;
  if (!session) return <Login />;
  return (
    <>
      <Suspense fallback={null}>
        <Outlet context={{ session, admin } satisfies Ctx} />
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
      { path: "evento/:id", element: <EventoVista /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
