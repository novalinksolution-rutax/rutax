"use client";

/**
 * Los datos de contacto del conductor: RUT, teléfono y correo.
 * =============================================================================
 * La ficha del conductor no mostraba «ni número ni correo» (encargo del usuario,
 * 2026-08-25). Era literal: la pantalla consultaba `id, nombre_completo, estado`
 * y nada más, así que el RUT también estaba en la base sin llegar nunca a
 * pantalla.
 *
 * -----------------------------------------------------------------------------
 * TELÉFONO Y CORREO SE EDITAN EN SITIOS DISTINTOS, Y NO ES UNA INCONSISTENCIA
 * -----------------------------------------------------------------------------
 * El **teléfono** es una columna de `identidad.conductores`: lo escribe el
 * courier y se edita acá mismo.
 *
 * El **correo** no. Es la identidad con la que la persona entra a la app —vive
 * en `auth.users`— y cambiarlo es cambiar con qué credencial inicia sesión, no
 * corregir una ficha. Por eso acá se muestra y no se toca: el camino real es
 * revocar el acceso e invitar de nuevo, que es lo que hace la sección de abajo.
 * Un lápiz junto al correo prometería algo que no puede cumplir.
 *
 * El editor del teléfono es `../editor-telefono`, compartido con la nómina:
 * el mismo campo hace falta en las dos pantallas, y duplicarlo garantizaba que
 * una se quedara atrás con validaciones distintas para lo mismo.
 */

import { Phone, Mail, IdCard } from "lucide-react";
import { EditorTelefonoConductor } from "../editor-telefono";

/** De dónde salió el correo, porque las dos procedencias NO significan lo mismo. */
export type OrigenCorreo =
  /**
   * Tiene cuenta: es el correo con el que entra a la app.
   * `cuentasDeMas` > 0 significa que hay MÁS de una cuenta para este mismo
   * conductor — una anomalía real, no un caso teórico. Se muestra en vez de
   * elegir una en silencio: el courier tiene que saber que esa persona puede
   * entrar por dos puertas.
   */
  | { tipo: "cuenta"; email: string; cuentasDeMas: number }
  /** Se le invitó y no ha canjeado: el correo es una intención, no una cuenta. */
  | { tipo: "invitacion_pendiente"; email: string }
  /** Ni cuenta ni invitación vigente. */
  | { tipo: "sin_cuenta" };

function Campo({
  icono,
  etiqueta,
  children,
}: {
  icono: React.ReactNode;
  etiqueta: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-fg-subtle" aria-hidden="true">
        {icono}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11.5px] uppercase tracking-wide text-fg-subtle">{etiqueta}</p>
        <div className="mt-0.5 text-sm text-fg">{children}</div>
      </div>
    </div>
  );
}

export function DatosContactoConductor({
  conductorId,
  rut,
  telefono,
  origenCorreo,
  puedeEditar,
}: {
  conductorId: string;
  rut: string;
  /** E.164 sin `+`, o `null` si nunca se cargó. */
  telefono: string | null;
  origenCorreo: OrigenCorreo;
  /** `asignar_y_reasignar_pedidos`. Sin esto el teléfono se ve pero no se toca. */
  puedeEditar: boolean;
}) {
  return (
    <section
      aria-label="Datos de contacto"
      className="rounded-lg border border-border bg-bg-raised p-4"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo icono={<IdCard className="size-4" />} etiqueta="RUT">
          <span className="rx-num tabular-nums">{rut}</span>
        </Campo>

        <Campo icono={<Phone className="size-4" />} etiqueta="Teléfono">
          <EditorTelefonoConductor
            conductorId={conductorId}
            telefono={telefono}
            puedeEditar={puedeEditar}
          />
        </Campo>

        <Campo icono={<Mail className="size-4" />} etiqueta="Correo">
          {origenCorreo.tipo === "sin_cuenta" ? (
            <span className="text-fg-muted">Sin cuenta</span>
          ) : (
            <div className="min-w-0">
              {/* `break-all`: un correo largo no debe ensanchar la tarjeta ni
                  desbordar en teléfono. */}
              <a
                href={`mailto:${origenCorreo.email}`}
                className="block break-all underline decoration-dotted underline-offset-4 hover:text-brand"
              >
                {origenCorreo.email}
              </a>
              {origenCorreo.tipo === "invitacion_pendiente" ? (
                <p className="mt-0.5 text-[12.5px] text-attention-fg">
                  Invitación sin aceptar — todavía no es una cuenta.
                </p>
              ) : null}
              {origenCorreo.tipo === "cuenta" && origenCorreo.cuentasDeMas > 0 ? (
                <p className="mt-0.5 text-[12.5px] text-attention-fg">
                  {origenCorreo.cuentasDeMas === 1
                    ? "Hay otra cuenta más para este mismo conductor."
                    : `Hay otras ${origenCorreo.cuentasDeMas} cuentas para este mismo conductor.`}{" "}
                  Puede entrar por cualquiera.
                </p>
              ) : null}
            </div>
          )}
        </Campo>
      </div>
    </section>
  );
}
