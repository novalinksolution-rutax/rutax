"use client";

/**
 * El listado de cuentas de todos los couriers, agrupado por courier.
 *
 * La columna que importa no es el correo: es **la marca**. Una cuenta sana no
 * necesita mirarse; las tres marcas son las únicas que piden acción, y por eso
 * el filtro de «solo con problemas» está a un clic y cada cabecera de courier
 * adelanta si hay algo por revisar sin necesidad de abrirla.
 *
 * Agrupado por `tenantId`, no por nombre de courier: dos couriers pueden
 * llamarse igual, y el nombre es solo lo que se muestra.
 */

import { useMemo, useState } from "react";
import { ChevronDown, Search, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BadgeEstado } from "@/components/ui/badge-estado";
import { FichaFila390 } from "@/components/ui/ficha-fila-390";
import { EmptyState } from "@/components/ui/empty-state";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { formatearFecha } from "@/lib/formato-cl";
import { cn } from "@/lib/utils";
import { DialogBajaCuenta } from "./dialog-baja-cuenta";
import { BotonReactivarCuenta } from "./boton-reactivar-cuenta";
import type {
  CuentaListada,
  EntidadSinCuenta,
  MarcaCuenta,
} from "@/modules/plataforma/panel-cuentas";

/** Qué significa cada marca, dicho para quien tiene que resolverla. */
const EXPLICACION: Record<MarcaCuenta, { texto: string; detalle: string; grave: boolean }> = {
  invitacion_en_conflicto: {
    texto: "Invitación conflictiva",
    detalle: "Si se canjea, sobrescribe el rol. Revócala.",
    grave: true,
  },
  sin_perfil: {
    texto: "Sin perfil",
    detalle: "Entra y no ve nada.",
    grave: true,
  },
  entidad_compartida: {
    texto: "Dos cuentas para la misma ficha",
    detalle: "Una es probablemente un error. Ambas entran como la misma persona.",
    grave: true,
  },
  invitado_sin_activar: {
    texto: "Invitación no canjeada",
    detalle: "",
    grave: false,
  },
};

const ROTULO_TIPO: Record<string, string> = {
  interno: "Equipo del courier",
  seller: "Seller",
  conductor: "Conductor",
  super_admin: "Plataforma",
};

const CLAVE_SIN_COURIER = "__sin_courier__";

function claveDeGrupo(tenantId: string | null): string {
  return tenantId ?? CLAVE_SIN_COURIER;
}

interface Grupo {
  tenantId: string | null;
  courierNombre: string;
  cuentas: CuentaListada[];
  sinCuenta: EntidadSinCuenta[];
}

interface GrupoVisible extends Grupo {
  cuentasVisibles: CuentaListada[];
  sinCuentaVisibles: EntidadSinCuenta[];
  totalProblemas: number;
}

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

/**
 * "Dar de baja" / "Reactivar", o nada si no corresponde:
 *  - `soporte_lectura` (o sin sesión válida) no ve ninguna acción.
 *  - Una cuenta de plataforma no se toca desde aquí (el backend la rechaza
 *    igual; ocultar el botón evita el viaje al servidor para nada).
 *  - Suspendida → Reactivar. El resto → Dar de baja.
 */
function AccionesCuenta({
  cuenta,
  puedeAccionar,
  autorNombre,
}: {
  cuenta: CuentaListada;
  puedeAccionar: boolean;
  autorNombre: string;
}) {
  if (!puedeAccionar || cuenta.tipoUsuario === "super_admin") {
    return <span className="text-muted-foreground">—</span>;
  }
  if (cuenta.estado === "suspendido") {
    return <BotonReactivarCuenta cuenta={cuenta} />;
  }
  return <DialogBajaCuenta cuenta={cuenta} autorNombre={autorNombre} />;
}

/** Fila de cuenta en escritorio. */
function FilaCuentaDesktop({
  cuenta,
  puedeAccionar,
  autorNombre,
}: {
  cuenta: CuentaListada;
  puedeAccionar: boolean;
  autorNombre: string;
}) {
  return (
    <tr className="border-t border-border align-top">
      <td className="p-3">
        <div className="font-mono text-xs">{cuenta.email}</div>
        {cuenta.nombreCompleto ? (
          <div className="text-muted-foreground">{cuenta.nombreCompleto}</div>
        ) : null}
      </td>
      <td className="p-3">
        {cuenta.tipoUsuario ? (ROTULO_TIPO[cuenta.tipoUsuario] ?? cuenta.tipoUsuario) : "—"}
        {cuenta.rol && cuenta.tipoUsuario === "interno" ? (
          <div className="text-xs text-muted-foreground">{cuenta.rol}</div>
        ) : null}
      </td>
      <td className="p-3">{cuenta.representaA ?? "—"}</td>
      <td className="p-3 text-muted-foreground">
        {cuenta.ultimoIngresoEn ? formatearFecha(cuenta.ultimoIngresoEn) : "Nunca entró"}
      </td>
      <td className="p-3">
        <Marcas marcas={cuenta.marcas} />
        {cuenta.marcas.length > 0 ? (
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            {EXPLICACION[cuenta.marcas[0]].detalle}
          </p>
        ) : null}
      </td>
      <td className="p-3">
        <AccionesCuenta cuenta={cuenta} puedeAccionar={puedeAccionar} autorNombre={autorNombre} />
      </td>
    </tr>
  );
}

/** Tarjeta de cuenta en angosto — misma pieza que couriers y bitácora. */
function FilaCuentaMovil({
  cuenta,
  puedeAccionar,
  autorNombre,
}: {
  cuenta: CuentaListada;
  puedeAccionar: boolean;
  autorNombre: string;
}) {
  const detalle = [
    cuenta.email,
    cuenta.representaA,
    cuenta.ultimoIngresoEn ? formatearFecha(cuenta.ultimoIngresoEn) : "Nunca entró",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <FichaFila390
        estado={
          <>
            <BadgeEstado
              variante="neutral"
              conPunto={false}
              texto={cuenta.tipoUsuario ? (ROTULO_TIPO[cuenta.tipoUsuario] ?? cuenta.tipoUsuario) : "—"}
            />
            {cuenta.marcas.map((m) => (
              <BadgeEstado
                key={m}
                variante={EXPLICACION[m].grave ? "destructive" : "warning"}
                texto={EXPLICACION[m].texto}
              />
            ))}
          </>
        }
        titulo={cuenta.nombreCompleto ?? cuenta.email}
        detalle={detalle}
      />
      <div>
        <AccionesCuenta cuenta={cuenta} puedeAccionar={puedeAccionar} autorNombre={autorNombre} />
      </div>
    </li>
  );
}

/**
 * Las fichas sin nadie que pueda entrar por ellas, dentro de su courier.
 * Sin acción: no hay una cuenta sobre la cual dar de baja o reactivar.
 */
function SeccionSinCuenta({ entidades }: { entidades: EntidadSinCuenta[] }) {
  if (entidades.length === 0) return null;
  return (
    <div className="border-t border-border">
      <p className="px-4 pt-3 text-xs font-medium text-muted-foreground">Sin cuenta</p>
      <ul className="divide-y divide-border">
        {entidades.map((e) => (
          <li key={`${e.tipo}-${e.id}`} className="flex items-center gap-3 px-4 py-2">
            <FichaFila390
              estado={
                <BadgeEstado
                  variante="neutral"
                  texto={e.tipo === "conductor" ? "Conductor" : "Seller"}
                  conPunto={false}
                />
              }
              clasificacion={e.estado}
              titulo={e.nombre}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function CabeceraGrupo({
  grupo,
  abierto,
  totalCuentasVisibles,
  onToggle,
}: {
  grupo: GrupoVisible;
  abierto: boolean;
  totalCuentasVisibles: number;
  onToggle: () => void;
}) {
  return (
    <CollapsibleTrigger asChild>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={abierto}
        className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30"
      >
        <span className="flex min-w-0 items-center gap-3">
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              abierto && "rotate-180",
            )}
            aria-hidden="true"
          />
          <span className="min-w-0 truncate text-sm font-medium">{grupo.courierNombre}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {totalCuentasVisibles} cuenta{totalCuentasVisibles === 1 ? "" : "s"}
          </span>
          {grupo.totalProblemas > 0 ? (
            <BadgeEstado
              variante="warning"
              texto={`${grupo.totalProblemas} por revisar`}
            />
          ) : null}
        </span>
      </button>
    </CollapsibleTrigger>
  );
}

export function TablaCuentas({
  cuentas,
  sinCuenta,
  puedeAccionar,
  autorNombre,
}: {
  cuentas: CuentaListada[];
  sinCuenta: EntidadSinCuenta[];
  /** `admin_total` con AAL2 en esta sesión. `soporte_lectura` no acciona. */
  puedeAccionar: boolean;
  autorNombre: string;
}) {
  const [filtro, setFiltro] = useState("");
  const [soloProblemas, setSoloProblemas] = useState(false);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  const texto = filtro.trim().toLowerCase();
  // Mientras se filtra (por texto o por "solo problemas"), lo que coincide se
  // muestra abierto: no tiene sentido filtrar y seguir teniendo que desplegar
  // uno por uno lo que ya se encontró.
  const forzarAbiertos = texto.length > 0 || soloProblemas;

  function alternar(clave: string) {
    if (forzarAbiertos) return;
    setExpandidos((prev) => {
      const siguiente = new Set(prev);
      if (siguiente.has(clave)) siguiente.delete(clave);
      else siguiente.add(clave);
      return siguiente;
    });
  }

  const gruposBase = useMemo<Grupo[]>(() => {
    const mapa = new Map<string, Grupo>();
    for (const c of cuentas) {
      const clave = claveDeGrupo(c.tenantId);
      let grupo = mapa.get(clave);
      if (!grupo) {
        grupo = {
          tenantId: c.tenantId,
          courierNombre: c.tenantId ? (c.courierNombre ?? "Courier sin nombre") : "Sin courier",
          cuentas: [],
          sinCuenta: [],
        };
        mapa.set(clave, grupo);
      }
      grupo.cuentas.push(c);
    }
    for (const e of sinCuenta) {
      const clave = claveDeGrupo(e.tenantId);
      let grupo = mapa.get(clave);
      if (!grupo) {
        grupo = { tenantId: e.tenantId, courierNombre: e.courierNombre, cuentas: [], sinCuenta: [] };
        mapa.set(clave, grupo);
      }
      grupo.sinCuenta.push(e);
    }
    return Array.from(mapa.values());
  }, [cuentas, sinCuenta]);

  const grupos = useMemo<GrupoVisible[]>(() => {
    const conVisibles = gruposBase.map((g) => {
      const cuentasVisibles = g.cuentas.filter((c) => {
        if (soloProblemas && c.marcas.length === 0) return false;
        if (!texto) return true;
        return (
          c.email.toLowerCase().includes(texto) ||
          (c.nombreCompleto ?? "").toLowerCase().includes(texto) ||
          (c.courierNombre ?? "").toLowerCase().includes(texto) ||
          (c.representaA ?? "").toLowerCase().includes(texto)
        );
      });
      const sinCuentaVisibles = g.sinCuenta.filter((e) => {
        if (!texto) return true;
        return (
          e.nombre.toLowerCase().includes(texto) || e.courierNombre.toLowerCase().includes(texto)
        );
      });
      return {
        ...g,
        cuentasVisibles,
        sinCuentaVisibles,
        totalProblemas: g.cuentas.filter((c) => c.marcas.length > 0).length,
      };
    });

    return conVisibles
      .filter((g) =>
        soloProblemas
          ? g.cuentasVisibles.length > 0
          : g.cuentasVisibles.length > 0 || g.sinCuentaVisibles.length > 0,
      )
      .sort((a, b) => {
        if (a.tenantId === null && b.tenantId !== null) return -1;
        if (a.tenantId !== null && b.tenantId === null) return 1;
        if (a.totalProblemas > 0 && b.totalProblemas === 0) return -1;
        if (a.totalProblemas === 0 && b.totalProblemas > 0) return 1;
        return a.courierNombre.localeCompare(b.courierNombre, "es");
      });
  }, [gruposBase, texto, soloProblemas]);

  const totalVisibles = grupos.reduce((acc, g) => acc + g.cuentasVisibles.length, 0);

  return (
    <div className="space-y-4">
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
          Solo las que tienen problemas
        </Button>
        <span className="text-sm text-muted-foreground">
          {totalVisibles} de {cuentas.length}
        </span>
      </div>

      {grupos.length === 0 ? (
        <EmptyState
          icon={soloProblemas ? ShieldCheck : Search}
          tono={soloProblemas ? "buen-estado" : "filtro"}
          titulo={soloProblemas ? "Nada por revisar" : "Ningún resultado"}
          descripcion={soloProblemas ? undefined : "Prueba con otro correo, nombre o courier."}
          accion={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFiltro("");
                setSoloProblemas(false);
              }}
            >
              Limpiar filtros
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {grupos.map((g) => {
            const clave = claveDeGrupo(g.tenantId);
            const abierto = forzarAbiertos || expandidos.has(clave);
            return (
              <Collapsible key={clave} open={abierto}>
                <div className="overflow-hidden rounded-lg border border-border">
                  <CabeceraGrupo
                    grupo={g}
                    abierto={abierto}
                    totalCuentasVisibles={g.cuentasVisibles.length}
                    onToggle={() => alternar(clave)}
                  />
                  <CollapsibleContent>
                    {/* Teléfono: tarjetas apiladas. */}
                    <ul className="divide-y divide-border border-t border-border sm:hidden">
                      {g.cuentasVisibles.map((c) => (
                        <FilaCuentaMovil
                          key={c.usuarioId}
                          cuenta={c}
                          puedeAccionar={puedeAccionar}
                          autorNombre={autorNombre}
                        />
                      ))}
                    </ul>

                    {/* Escritorio: tabla. */}
                    <div className="hidden overflow-x-auto sm:block">
                      <table className="w-full text-sm">
                        <thead className="border-t border-border bg-muted/40 text-left">
                          <tr>
                            <th className="p-3 font-medium">Correo</th>
                            <th className="p-3 font-medium">Tipo</th>
                            <th className="p-3 font-medium">Representa a</th>
                            <th className="p-3 font-medium">Último ingreso</th>
                            <th className="p-3 font-medium">Marca</th>
                            <th className="p-3 font-medium">
                              <span className="sr-only">Acciones</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.cuentasVisibles.map((c) => (
                            <FilaCuentaDesktop
                              key={c.usuarioId}
                              cuenta={c}
                              puedeAccionar={puedeAccionar}
                              autorNombre={autorNombre}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <SeccionSinCuenta entidades={g.sinCuentaVisibles} />
                  </CollapsibleContent>
                </div>
              </Collapsible>
            );
          })}
        </div>
      )}
    </div>
  );
}
