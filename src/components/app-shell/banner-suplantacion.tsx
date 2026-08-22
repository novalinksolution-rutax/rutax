"use client";

/**
 * BannerSuplantacion — el aviso de que estás mirando la cuenta de otra empresa.
 *
 * POR QUÉ VIVE EN EL MARCO Y NO EN UNA PANTALLA
 * ---------------------------------------------------------------------------
 * Regla 7 del sistema de diseño: **vive en el marco; no se colapsa, no se
 * oculta al hacer scroll, no se vuelve un ícono.** Antes vivía dentro de
 * `/admin/couriers/[tenantId]/soporte/page.tsx` porque el layout del backstage
 * no exponía un slot de banner — y eso tenía dos agujeros reales:
 *
 *   1. La propia rama de error de esa página retornaba **sin el banner**, así
 *      que con la ventana de soporte todavía viva alguien podía quedarse sin el
 *      contador y sin el botón de salir.
 *   2. Cualquier excepción que escalara a `src/app/error.tsx` —que es raíz y
 *      reemplaza el shell entero— lo borraba igual.
 *
 * Ahora lo pinta `admin/layout.tsx` para TODAS las pantallas del backstage
 * mientras la ventana esté abierta, no solo para la de soporte.
 *
 * EL ÚNICO ELEMENTO QUE NO CAMBIA ENTRE TEMAS
 * ---------------------------------------------------------------------------
 * Usa `--rx-impersonation-*`, que `rx-tokens.css` declara **fuera de los cuatro
 * temas** a propósito: si el equipo trabaja de noche y el banner se atenuara,
 * dejaría de gritar justo cuando más cansado está quien lo mira.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

import { accionTerminarSoporte } from "@/app/admin/couriers/[tenantId]/soporte-actions";

const FORMATEADOR_HORA_SANTIAGO = new Intl.DateTimeFormat("es-CL", {
  timeZone: "America/Santiago",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** `mm:ss` restantes — nunca negativo (se satura en `0:00`). */
function formatearRestante(msRestante: number): string {
  const segundos = Math.max(0, Math.floor(msRestante / 1000));
  const mm = Math.floor(segundos / 60);
  const ss = segundos % 60;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

interface Props {
  tenantId: string;
  nombreCourier: string;
  /** ISO 8601 — `SesionSoporte.expiraEn`. */
  expiraEn: string;
}

export function BannerSuplantacion({ tenantId, nombreCourier, expiraEn }: Props) {
  const router = useRouter();
  const expiraEnMs = new Date(expiraEn).getTime();

  const [msRestante, setMsRestante] = useState(() => expiraEnMs - Date.now());
  // Se dispara UNA vez al cruzar el umbral de "queda poco" — evita spamear al
  // lector de pantalla con un `aria-live` que cambiara cada segundo.
  const [avisoUrgente, setAvisoUrgente] = useState(false);

  useEffect(() => {
    const ACTUALIZA_CADA_MS = 1000;
    const UMBRAL_URGENTE_MS = 60_000;

    const intervalo = setInterval(() => {
      const restante = expiraEnMs - Date.now();
      setMsRestante(restante);

      if (restante <= UMBRAL_URGENTE_MS && restante > 0) {
        setAvisoUrgente(true);
      }

      if (restante <= 0) {
        clearInterval(intervalo);
        // La ventana ya expiró — refresca para que el servidor la corte.
        router.refresh();
      }
    }, ACTUALIZA_CADA_MS);

    return () => clearInterval(intervalo);
  }, [expiraEnMs, router]);

  const expirado = msRestante <= 0;
  const horaLimite = FORMATEADOR_HORA_SANTIAGO.format(new Date(expiraEnMs));

  return (
    <div
      role="region"
      aria-label="Modo soporte activo"
      // `top-14` en móvil porque ahí el shell tiene su cabecera de 56 px; en
      // escritorio no hay cabecera y el banner es lo primero.
      className="sticky top-14 z-30 border-b lg:top-0"
      style={{
        minHeight: "var(--rx-impersonation-h)",
        background: "var(--rx-impersonation-bg)",
        color: "var(--rx-impersonation-fg)",
        borderColor: "var(--rx-impersonation-bg)",
      }}
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
          <span>
            Viendo como <strong>{nombreCourier}</strong> · modo soporte (solo lectura) · termina a
            las {horaLimite}
          </span>
          <span
            className="font-mono text-xs tabular-nums"
            style={{ color: "var(--rx-impersonation-soft)" }}
            aria-hidden="true"
          >
            ({expirado ? "0:00" : formatearRestante(msRestante)})
          </span>
          {/* Aviso accesible: solo se anuncia una vez, al cruzar el minuto final. */}
          <span role="status" aria-live="polite" className="sr-only">
            {avisoUrgente && !expirado
              ? "Queda menos de un minuto para que termine el modo soporte."
              : ""}
          </span>
        </div>

        <form action={accionTerminarSoporte.bind(null, tenantId)} className="shrink-0">
          <button
            type="submit"
            className="rounded-ctrl border px-2.5 py-1 text-xs font-medium transition-opacity hover:opacity-80"
            style={{
              borderColor: "var(--rx-impersonation-soft)",
              color: "var(--rx-impersonation-fg)",
            }}
          >
            Salir del modo soporte
          </button>
        </form>
      </div>
    </div>
  );
}
