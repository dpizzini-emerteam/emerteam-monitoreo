import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHashRouter, Navigate, Outlet, RouterProvider, useLocation, useParams, useRouteError } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import "./estilos.css";
import { miRol, supabase, type RolEquipo } from "./datos";
import { Login } from "./paginas/Login";
import { Eventos } from "./paginas/Eventos";
import { EventoVista } from "./paginas/EventoVista";
import { Equipo } from "./paginas/Equipo";
import { Comando } from "./paginas/Comando";
import { Informe } from "./paginas/Informe";
import { GuiaPagina } from "./paginas/GuiaPagina";
import { Pie } from "./componentes/Pie";

// Una pestaña abierta desde antes de una actualización pide archivos de la versión anterior, que ya no existen:
// se recarga una sola vez para tomar la versión nueva (la marca evita un bucle si el problema es otro).
const MARCA = "mon-recarga-version";
function recargarPorVersion(): boolean {
  try {
    const ultima = Number(sessionStorage.getItem(MARCA) ?? 0);
    if (Date.now() - ultima < 30_000) return false;
    sessionStorage.setItem(MARCA, String(Date.now()));
  } catch { /* sin almacenamiento: se recarga igual */ }
  window.location.reload();
  return true;
}
const esVersionVieja = (e: unknown) =>
  /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk/i.test(String((e as Error)?.message ?? e));
window.addEventListener("vite:preloadError", (ev) => { if (recargarPorVersion()) ev.preventDefault(); });

// El formulario carga el mapa: se descarga solo cuando se usa
const EventoForm = lazy(() =>
  import("./paginas/EventoForm").then((m) => ({ default: m.EventoForm })).catch((e) => {
    if (esVersionVieja(e) && recargarPorVersion()) return new Promise<never>(() => {});
    throw e;
  }));

function RedirDashboard() {
  const { id } = useParams();
  return <Navigate to={`/evento/${id}/dashboard`} replace />;
}

function ErrorPagina() {
  const error = useRouteError();
  const vieja = esVersionVieja(error);
  useEffect(() => { if (vieja) recargarPorVersion(); }, [vieja]);
  return (
    <main className="contenedor" style={{ padding: "48px 16px", maxWidth: 560 }}>
      <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", textTransform: "uppercase" }}>
        {vieja ? "La web se actualizó" : "No se pudo mostrar esta página"}
      </h1>
      <p>{vieja
        ? "Hay una versión nueva. Recargá la página para seguir."
        : "Ocurrió un error inesperado. Recargá la página; si se repite, avisá al equipo EMERTEAM."}</p>
      <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button className="boton primario" onClick={() => window.location.reload()}>Recargar</button>
        <a className="boton" href="#/">Ir al inicio</a>
      </p>
    </main>
  );
}

/** admin: integra el equipo EMERTEAM (ve todo); editor: además edita y administra el equipo */
export type Ctx = { session: Session; admin: boolean; editor: boolean };

function Cargando() {
  return (
    <div style={{ minHeight: "60vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--texto2, #666)", fontSize: 16 }}>
      Cargando…
    </div>
  );
}

function Raiz() {
  const enComando = useLocation().pathname.endsWith("/dashboard");
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

  if (session === undefined || (session && rol === undefined)) return <Cargando />;
  if (!session) return <Login />;
  return (
    <>
      <Suspense fallback={null}>
        <Outlet context={{ session, admin: rol !== null, editor: rol === "editor" } satisfies Ctx} />
      </Suspense>
      {!enComando && <Pie />}
    </>
  );
}

const router = createHashRouter([
  {
    path: "/",
    element: <Raiz />,
    errorElement: <ErrorPagina />,
    children: [
      { index: true, element: <Eventos /> },
      { path: "evento/nuevo", element: <EventoForm /> },
      { path: "evento/:id/editar", element: <EventoForm /> },
      { path: "evento/:id/dashboard", element: <Comando /> },
      { path: "evento/:id/comando", element: <RedirDashboard /> },
      { path: "evento/:id/informe", element: <Informe /> },
      { path: "evento/:id/:pestana?", element: <EventoVista /> },
      { path: "equipo", element: <Equipo /> },
      { path: "guia", element: <GuiaPagina /> },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
