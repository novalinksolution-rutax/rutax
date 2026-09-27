"use client";

/**
 * El menú ⋯ de un seller: el mismo en la fila del listado y en el encabezado
 * de su ficha.
 *
 * Solo lista lo que aplica a ESE seller: «Copiar invitación» si tiene una
 * pendiente, «Sincronizar» si tiene cuentas de Mercado Libre, bloquear o
 * restaurar si se registró por el enlace. La acción con consecuencia va al
 * final, separada y en rojo, y pide confirmación.
 *
 * «Bloquear acceso» es el «suspender» que existe hoy en el sistema: le quita
 * la entrada al portal y a operar sin borrar nada (decisión del usuario,
 * 2026-09-27: no se crea un «suspender» aparte).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModalActoExplicito } from "@/components/ui/modal-acto-explicito";
import { useVistaPreviaLateral } from "@/components/ui/vista-previa-lateral";

import { obtenerInvitacionPendienteSeller, solicitarSincronizacionMlSeller } from "./actions";
import { bloquearSellerAction, desbloquearSellerAction } from "./_ficha/actions-membresia";

export interface SellerParaMenu {
  id: string;
  razonSocial: string;
  cuentasMl: { id: string; etiqueta: string }[];
  invitacionPendiente: boolean;
  /** `null` si nunca se registró por el enlace: no hay acceso que bloquear. */
  membresia: "activa" | "bloqueada" | null;
}

const CLASE_ITEM = "min-h-11 md:min-h-0";

export function MenuSeller({
  seller,
  puedeSincronizar,
  puedeInvitar,
  enFicha = false,
}: {
  seller: SellerParaMenu;
  puedeSincronizar: boolean;
  puedeInvitar: boolean;
  /** Dentro de la ficha no se ofrece «Ver ficha». */
  enFicha?: boolean;
}) {
  const router = useRouter();
  const vista = useVistaPreviaLateral();
  const [ocupado, iniciar] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [membresia, setMembresia] = useState(seller.membresia);

  function sincronizar() {
    iniciar(async () => {
      const resultados = await Promise.all(
        seller.cuentasMl.map((c) => solicitarSincronizacionMlSeller(c.id).catch(() => null)),
      );
      const fallidos = resultados.filter((r) => !r?.ok).length;
      if (fallidos === 0) toast.success(`Sincronizando ${seller.razonSocial}.`);
      else toast.error(`No se pudo sincronizar ${fallidos === 1 ? "una cuenta" : `${fallidos} cuentas`}.`);
    });
  }

  function copiarInvitacion() {
    iniciar(async () => {
      const r = await obtenerInvitacionPendienteSeller(seller.id);
      if (!r.ok) {
        toast.error(r.mensaje);
        return;
      }
      const enlace = `${window.location.origin}/invitacion/${r.token}`;
      try {
        await navigator.clipboard.writeText(enlace);
        toast.success(`Enlace copiado. Mándaselo a ${r.email}.`);
      } catch {
        toast.message("Copia este enlace:", { description: enlace, duration: 30_000 });
      }
    });
  }

  function cambiarAcceso() {
    const bloquear = membresia === "activa";
    iniciar(async () => {
      const r = bloquear
        ? await bloquearSellerAction(seller.id)
        : await desbloquearSellerAction(seller.id);
      setConfirmando(false);
      if (!r.ok) {
        toast.error(r.mensaje);
        return;
      }
      setMembresia(bloquear ? "bloqueada" : "activa");
      toast.success(bloquear ? "Acceso bloqueado." : "Acceso restaurado.");
      router.refresh();
    });
  }

  const puedeSinc = puedeSincronizar && seller.cuentasMl.length > 0;
  const puedeCopiar = puedeInvitar && seller.invitacionPendiente;
  const puedeAcceso = puedeInvitar && membresia !== null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={ocupado}
            aria-label={`Acciones de ${seller.razonSocial}`}
            className="size-11 shrink-0 md:size-8"
          >
            {ocupado ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <MoreHorizontal className="size-4" aria-hidden="true" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {!enFicha && vista ? (
            <DropdownMenuItem className={CLASE_ITEM} onSelect={() => vista.abrir(seller.id)}>
              Ver ficha
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem
            className={CLASE_ITEM}
            onSelect={() => router.push(`/operaciones?seller=${seller.id}`)}
          >
            Ver sus pedidos
          </DropdownMenuItem>
          {puedeSinc ? (
            <DropdownMenuItem className={CLASE_ITEM} onSelect={sincronizar}>
              Sincronizar {seller.cuentasMl.length === 1 ? "su cuenta" : "sus cuentas"}
            </DropdownMenuItem>
          ) : null}
          {puedeCopiar ? (
            <DropdownMenuItem className={CLASE_ITEM} onSelect={copiarInvitacion}>
              Copiar enlace de invitación
            </DropdownMenuItem>
          ) : null}
          {puedeAcceso ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={CLASE_ITEM}
                variant={membresia === "activa" ? "destructive" : "default"}
                onSelect={() => setConfirmando(true)}
              >
                {membresia === "activa" ? "Bloquear acceso" : "Restaurar acceso"}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <ModalActoExplicito
        open={confirmando}
        onOpenChange={setConfirmando}
        peldano={2}
        titulo={
          membresia === "activa"
            ? `Vas a bloquear el acceso de ${seller.razonSocial}`
            : `Vas a restaurar el acceso de ${seller.razonSocial}`
        }
        consecuencia={
          membresia === "activa"
            ? "No podrá entrar a su portal ni operar contigo. No se borra nada."
            : "Vuelve a entrar a su portal y a operar contigo."
        }
        variante={membresia === "activa" ? "destructive" : "primary"}
        cargando={ocupado}
        textoConfirmar={membresia === "activa" ? "Bloquear acceso" : "Restaurar acceso"}
        onConfirmar={cambiarAcceso}
      />
    </>
  );
}
