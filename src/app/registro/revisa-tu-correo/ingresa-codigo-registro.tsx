"use client";

/**
 * Envoltorio cliente del paso "ingresa tu código" en `/registro`. Reemplaza
 * a `reenviar-correo.tsx` (usaba `reenviarCorreoActivacion`, retirada en F1).
 *
 * El componente compartido (`IngresaCodigo`) no sabe nada de registro: acá se
 * le inyectan las dos Server Actions correctas (`verificarCodigoRegistro`,
 * `enviarCodigoRegistro`) y el destino tras el éxito.
 */

import { useRouter } from "next/navigation";
import { IngresaCodigo } from "@/components/identidad/ingresa-codigo";
import { enviarCodigoRegistro, verificarCodigoRegistro } from "../actions";

export function IngresaCodigoRegistro({ email }: { email: string }) {
  const router = useRouter();
  const correo = email.trim().toLowerCase();

  return (
    <IngresaCodigo
      email={correo}
      onVerificar={async (codigo) => {
        const resultado = await verificarCodigoRegistro(correo, codigo);
        return resultado.ok ? { ok: true } : { ok: false, mensaje: resultado.mensaje };
      }}
      onReenviar={() => enviarCodigoRegistro(correo)}
      onExito={() => {
        router.push("/");
        router.refresh();
      }}
    />
  );
}
