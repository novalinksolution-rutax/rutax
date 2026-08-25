"use client";

/**
 * «Invitar seller» — desde el listado, mirando a quién ya tienes.
 * =============================================================================
 *
 * Invitar era una navegación completa a `/sellers/invitar`. El costo no es el
 * clic: es que **se pierde de vista la lista justo cuando hace falta**. La
 * pregunta que trae a alguien acá suele ser «¿ya invité a este?», y la respuesta
 * está en la tabla de atrás.
 *
 * ⚠️ **La página no se retira.** Sigue siendo una URL compartible —el onboarding
 * enlaza a ella desde su pantalla de cierre— y el formulario es el mismo
 * archivo, montado en los dos sitios. Duplicarlo sería tener dos validaciones
 * de RUT que se separan sin que nadie lo note.
 *
 * Va en el ancho `normal` de 430 px: son cuatro campos cortos, no el alta de
 * same-day.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PanelAccion } from "@/components/ui/panel-accion";
import { FormularioInvitarSeller } from "./invitar/formulario-invitar-seller";

export function PanelInvitarSeller({ etiqueta = "Invitar seller" }: { etiqueta?: string }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);

  return (
    <PanelAccion
      abierto={abierto}
      onOpenChange={setAbierto}
      titulo="Invitar a un seller"
      subtitulo="Le llega un correo para entrar a su portal y conectar sus cuentas."
      disparador={
        <Button size="sm" className="shrink-0">
          <UserPlus className="size-4 shrink-0" aria-hidden="true" />
          {etiqueta}
        </Button>
      }
    >
      <FormularioInvitarSeller
        conTarjeta={false}
        onInvitado={() => {
          setAbierto(false);
          // La lista de atrás tiene que mostrar al seller nuevo: si no, la
          // acción parece no haber pasado.
          router.refresh();
        }}
      />
    </PanelAccion>
  );
}
