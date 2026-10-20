export type TipoIcono =
  | "sol" | "solnube" | "nube" | "lluvia" | "tormenta" | "viento" | "termometro"
  | "gota" | "rayo" | "luna" | "estructura" | "corredor";

export function Icono({ tipo, size = 40 }: { tipo: TipoIcono; size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" style={{ flex: "0 0 auto" }}>
      {tipo === "sol" && (
        <>
          <g stroke="#F5B400" strokeWidth="4" strokeLinecap="round">
            <path d="M32 6v7M32 51v7M6 32h7M51 32h7M13.6 13.6l5 5M45.4 45.4l5 5M13.6 50.4l5-5M45.4 18.6l5-5" />
          </g>
          <circle cx="32" cy="32" r="12" fill="#F5B400" />
        </>
      )}
      {tipo === "solnube" && (
        <>
          <g stroke="#F5B400" strokeWidth="3.5" strokeLinecap="round">
            <path d="M24 6v5M8 22h5M12.7 10.7l3.5 3.5M35.3 10.7l-3.5 3.5" />
          </g>
          <circle cx="24" cy="23" r="9" fill="#F5B400" />
          <path d="M24 52h26a9 9 0 0 0 1-18 13 13 0 0 0-25-3 10 10 0 0 0-2 21z" fill="#B9BEC6" />
        </>
      )}
      {tipo === "nube" && <path d="M18 48h28a11 11 0 0 0 1-22 15 15 0 0 0-29-4 13 13 0 0 0 0 26z" fill="#B9BEC6" />}
      {tipo === "lluvia" && (
        <>
          <path d="M18 38h28a11 11 0 0 0 1-22 15 15 0 0 0-29-4 13 13 0 0 0 0 26z" fill="#9AA0A8" />
          <g stroke="#2F80ED" strokeWidth="4" strokeLinecap="round">
            <path d="M22 45l-3 9M33 45l-3 9M44 45l-3 9" />
          </g>
        </>
      )}
      {tipo === "tormenta" && (
        <>
          <path d="M18 38h28a11 11 0 0 0 1-22 15 15 0 0 0-29-4 13 13 0 0 0 0 26z" fill="#5F656E" />
          <path d="M34 34l-10 15h8l-4 12 13-17h-8l5-10z" fill="#FFC20E" stroke="#111111" strokeWidth="1.5" strokeLinejoin="round" />
          <g stroke="#2F80ED" strokeWidth="3.5" strokeLinecap="round">
            <path d="M18 45l-2 6M50 45l-2 6" />
          </g>
        </>
      )}
      {tipo === "viento" && (
        <g fill="none" stroke="#4B5563" strokeWidth="4.5" strokeLinecap="round">
          <path d="M6 24h32a7 7 0 1 0-7-7M6 34h42a7 7 0 1 1-7 7M6 44h22" />
        </g>
      )}
      {tipo === "termometro" && (
        <>
          <rect x="26" y="6" width="12" height="38" rx="6" fill="#FFFFFF" stroke="#111111" strokeWidth="3" />
          <rect x="30" y="20" width="4" height="26" fill="#FF3B30" />
          <circle cx="32" cy="48" r="10" fill="#FF3B30" stroke="#111111" strokeWidth="3" />
        </>
      )}
      {tipo === "gota" && (
        <>
          <path d="M32 8s-15 19-15 30a15 15 0 0 0 30 0C47 27 32 8 32 8z" fill="#2F80ED" />
          <path d="M25 40a7 7 0 0 0 7 7" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {tipo === "rayo" && <path d="M38 4L14 36h14l-6 24 28-34H35l7-22z" fill="#FFC20E" stroke="#111111" strokeWidth="2.5" strokeLinejoin="round" />}
      {tipo === "luna" && <path d="M40 10a22 22 0 1 0 14 34A18 18 0 1 1 40 10z" fill="#9AA0A8" />}
      {tipo === "estructura" && (
        <>
          <g fill="none" stroke="#111111" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round">
            <path d="M10 58V14h44v44M10 24h44M10 14l10 10 10-10 10 10 10-10" />
          </g>
          <rect x="18" y="30" width="28" height="10" rx="2" fill="#FF6A1A" />
        </>
      )}
      {tipo === "corredor" && (
        <>
          <circle cx="38" cy="10" r="6" fill="#111111" />
          <g fill="none" stroke="#111111" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 26l10-6 10 6 6 10M32 20l-4 18 10 8 2 14M28 38l-8 10-10 2" />
          </g>
        </>
      )}
    </svg>
  );
}

/** Ícono del tiempo a partir de una fila de pronóstico */
export function iconoTiempo(p: { precip: number | null; cape: number | null; nubosidad: number | null; radiacion: number | null }, noche = false): TipoIcono {
  const pr = p.precip ?? 0;
  if (pr >= 1 && (p.cape ?? 0) >= 1000) return "tormenta";
  if (pr >= 0.5) return "lluvia";
  const nub = p.nubosidad ?? 0;
  if (nub >= 75) return "nube";
  if (noche) return "luna";
  if (nub >= 30) return "solnube";
  return "sol";
}
