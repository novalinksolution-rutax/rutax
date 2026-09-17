"use client";

/**
 * "Dar de baja" una cuenta, desde `/admin/cuentas`.
 *
 * Reusa `ModalActoExplicito` — la ceremonia única del producto para acciones
 * de peso. Acá el peso varía por cuenta y se sabe recién al abrir el diálogo:
 * `previsualizarBajaCuentaAction` (100% lectura) dice si el veredicto es
 * eliminar (irreversible → peldaño 3, confirmación tipeada del correo) o
 * desactivar (reversible → peldaño 1), o si está bloqueada (último dueño
 * activo, cuenta de plataforma). Mientras se resuelve, el botón de confirmar
 * queda deshabilitado — nunca se ofrece una acción sin saber cuál es.
 */

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ModalActoExplicito, type ComprobanteActo } from "@/components/ui/modal-acto-explicito";
import { formatearFechaHora } from "@/lib/formato-cl";
import type { CuentaListada } from "@/modules/plataforma/panel-cuentas";
import type { PrevisualizacionBaja } from "@/modules/plataforma/baja-cuentas";
import { darDeBajaCuentaAction, previsualizarBajaCuentaAction } from "./acciones";

export function DialogBajaCuenta({
  cuenta,
  autorNombre,
}: {
  cuenta: CuentaListada;
  autorNombre: string;
}) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [preview, setPreview] = useState<PrevisualizacionBaja | null>(null);
  const [errorConfirmar, setErrorConfirmar] = useState<string | null>(null);
  const [comprobante, setComprobante] = useState<ComprobanteActo | null>(null);
  const [isPending, startTransition] = useTransition();

  const cargarPreview = useCallback(() => {
    setCargandoPreview(true);
    setPreview(null);
    void (async () => {
      const resultado = await previsualizarBajaCuentaAction(cuenta.usuarioId);
      setPreview(resultado);
      setCargandoPreview(false);
    })();
  }, [cuenta.usuarioId]);

  useEffect(() => {
    // El fetch actualiza estado dentro de su propio callback async, nunca de
    // forma síncrona en el render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (abierto) cargarPreview();
  }, [abierto, cargarPreview]);

  function handleConfirmar() {
    if (!preview || preview.ok === false) return;
    setErrorConfirmar(null);
    const accionEsperada = preview.accionPrevista;
    startTransition(async () => {
      const resultado = await darDeBajaCuentaAction(cuenta.usuarioId, accionEsperada);
      if (resultado.ok) {
        setComprobante({
          tono: "balanced",
          titulo: resultado.accion === "eliminada" ? "Cuenta eliminada" : "Cuenta desactivada",
          cuerpo:
            resultado.accion === "eliminada"
              ? `Se eliminó ${cuenta.email} y sus conexiones.`
              : `${cuenta.email} quedó desactivada.`,
        });
        router.refresh();
      } else {
        setErrorConfirmar(resultado.motivo);
      }
    });
  }

  const eliminada = preview?.ok === true && preview.accionPrevista === "eliminada";
  const bloqueada = preview !== null && preview.ok === false;
  const otrosCouriersActivos = preview?.ok === true ? preview.otrosCouriersActivos : 0;

  const avisos: { tono: "attention" | "fault"; texto: React.ReactNode }[] = [];
  if (bloqueada && preview && preview.ok === false) {
    avisos.push({ tono: "fault", texto: preview.motivo });
  }
  if (otrosCouriersActivos > 0) {
    avisos.push({
      tono: "attention",
      texto: `Sigue activo en ${otrosCouriersActivos} courier${otrosCouriersActivos === 1 ? "" : "s"} más. Solo afecta a este.`,
    });
  }
  if (errorConfirmar) {
    avisos.push({ tono: "fault", texto: errorConfirmar });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        Dar de baja
      </Button>

      <ModalActoExplicito
        open={abierto}
        onOpenChange={(o) => {
          setAbierto(o);
          if (!o) {
            setComprobante(null);
            setErrorConfirmar(null);
          }
        }}
        peldano={eliminada ? 3 : 1}
        titulo={`Dar de baja a ${cuenta.email}`}
        consecuencia={
          cargandoPreview || !preview
            ? null
            : preview.ok === false
              ? "No se puede dar de baja esta cuenta."
              : preview.accionPrevista === "eliminada"
                ? "Se elimina permanentemente."
                : "Se desactiva la cuenta. Se puede reactivar."
        }
        confirmacion={eliminada ? { frase: cuenta.email } : undefined}
        autor={{ nombre: autorNombre, cuando: formatearFechaHora(new Date()) }}
        avisos={avisos}
        cargando={isPending}
        confirmDeshabilitado={cargandoPreview || !preview || preview.ok === false}
        textoConfirmar={eliminada ? "Eliminar cuenta" : "Dar de baja"}
        variante={eliminada ? "destructive" : "primary"}
        comprobante={comprobante}
        onConfirmar={handleConfirmar}
      >
        {cargandoPreview ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : null}
      </ModalActoExplicito>
    </>
  );
}
