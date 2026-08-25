"use client";

/**
 * El listado de cuentas de todos los couriers, con las que están mal marcadas.
 *
 * La columna que importa no es el correo: es **la marca**. Una cuenta sana no
 * necesita mirarse; las tres marcas son las únicas que piden acción, y por eso
 * el filtro de «solo con problemas» está a un clic.
 */

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { formatearFecha } from "@/lib/formato-cl";
import type {
  CuentaListada,
  EntidadSinCuenta,
  MarcaCuenta,
} from "@/modules/plataforma/panel-cuentas";

/** Qué significa cada marca, dicho para quien tiene que resolverla. */
const EXPLICACION: Record<MarcaCuenta, { texto: string; detalle: string; grave: boolean }> = {
  invitacion_en_conflicto: {
    texto: "Invitación va a pisar esta cuenta",
    detalle:
      "Hay una invitación pendiente a este correo de un tipo distinto. Si se canjea, el perfil se sobrescribe y la cuenta deja de ser lo que es. Revoca esa invitación.",
    grave: true,
  },
  sin_perfil: {
    texto: "Sin perfil",
    detalle:
      "Existe en Auth y ocupa el correo, pero no tiene perfil: puede iniciar sesión y no ve nada.",
    grave: true,
  },
  entidad_compartida: {
    texto: "Dos cuentas para la misma ficha",
    detalle:
      "Hay más de una cuenta apuntando al mismo seller o conductor. Cualquiera de las dos entra como esa persona, y la de más suele ser un descuido de una invitación repetida.",
    grave: true,
  },
  invitado_sin_activar: {
    texto: "Nunca activó",
    detalle:
      "Le llegó la invitación y no la canjeó. Un seller así tampoco puede dejar su WhatsApp, porque el número lo pone él desde su portal.",
    grave: false,
  },
};

const ROTULO_TIPO: Record<string, string> = {
  interno: "Equipo del courier",
  seller: "Seller",
  conductor: "Conductor",
  super_admin: "Plataforma",
};

function Marcas({ marcas }: { marcas: MarcaCuenta[] }) {
  if (marcas.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-1">
      {marcas.map((m) => (
        <div key={m}>
          <BadgeEstado
            variante={EXPLICACION[m].grave ? "destructive" : "warning"}
            texto={EXPLICACION[m].texto}
          />
        </div>
      ))}
    </div>
  );
}

export function TablaCuentas({
  cuentas,
  sinCuenta,
}: {
  cuentas: CuentaListada[];
  sinCuenta: EntidadSinCuenta[];
}) {
  const [filtro, setFiltro] = useState("");
  const [soloProblemas, setSoloProblemas] = useState(false);

  const texto = filtro.trim().toLowerCase();
  const visibles = cuentas.filter((c) => {
    if (soloProblemas && c.marcas.length === 0) return false;
    if (!texto) return true;
    return (
      c.email.toLowerCase().includes(texto) ||
      (c.nombreCompleto ?? "").toLowerCase().includes(texto) ||
      (c.courierNombre ?? "").toLowerCase().includes(texto) ||
      (c.representaA ?? "").toLowerCase().includes(texto)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar por correo, nombre, courier…"
          className="max-w-sm"
        />
        <Button
          variant={soloProblemas ? "default" : "outline"}
          size="sm"
          onClick={() => setSoloProblemas((v) => !v)}
        >
          Solo las que tienen algo
        </Button>
        <span className="text-sm text-muted-foreground">
          {visibles.length} de {cuentas.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left">
            <tr>
              <th className="p-3 font-medium">Correo</th>
              <th className="p-3 font-medium">Tipo</th>
              <th className="p-3 font-medium">Courier</th>
              <th className="p-3 font-medium">Representa a</th>
              <th className="p-3 font-medium">Último ingreso</th>
              <th className="p-3 font-medium">Marca</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((c) => (
              <tr key={c.usuarioId} className="border-t border-border align-top">
                <td className="p-3">
                  <div className="font-mono text-xs">{c.email}</div>
                  {c.nombreCompleto ? (
                    <div className="text-muted-foreground">{c.nombreCompleto}</div>
                  ) : null}
                </td>
                <td className="p-3">
                  {c.tipoUsuario ? (ROTULO_TIPO[c.tipoUsuario] ?? c.tipoUsuario) : "—"}
                  {c.rol && c.tipoUsuario === "interno" ? (
                    <div className="text-xs text-muted-foreground">{c.rol}</div>
                  ) : null}
                </td>
                <td className="p-3">{c.courierNombre ?? "—"}</td>
                <td className="p-3">{c.representaA ?? "—"}</td>
                <td className="p-3 text-muted-foreground">
                  {c.ultimoIngresoEn ? formatearFecha(c.ultimoIngresoEn) : "Nunca entró"}
                </td>
                <td className="p-3">
                  <Marcas marcas={c.marcas} />
                  {c.marcas.length > 0 ? (
                    <p className="mt-1 max-w-xs text-xs text-muted-foreground">
                      {EXPLICACION[c.marcas[0]].detalle}
                    </p>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        Las fichas sin nadie que pueda entrar por ellas. Va en su propia sección
        y no como una marca más porque **no son cuentas**: son lo contrario —
        gente que existe en el sistema y no tiene forma de entrar.
      */}
      {sinCuenta.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="font-medium">Fichas sin cuenta ({sinCuenta.length})</h2>
            <p className="text-sm text-muted-foreground">
              Existen como conductor o seller, pero nadie puede iniciar sesión por ellas. Un
              conductor así no puede usar la app; un seller así no puede entrar a su portal ni
              dejar su WhatsApp.
            </p>
          </div>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sinCuenta.map((e) => (
              <li key={`${e.tipo}-${e.id}`} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <BadgeEstado
                  variante="neutral"
                  texto={e.tipo === "conductor" ? "Conductor" : "Seller"}
                  conPunto={false}
                />
                <span className="font-medium">{e.nombre}</span>
                <span className="text-muted-foreground">· {e.courierNombre}</span>
                <span className="text-xs text-muted-foreground">({e.estado})</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
