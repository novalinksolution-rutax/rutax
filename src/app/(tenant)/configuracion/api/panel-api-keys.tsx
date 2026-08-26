"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelAccion } from "@/components/ui/panel-accion";
import { BotonConfirmado } from "@/components/ui/boton-confirmado";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { accionCrearApiKey, accionRevocarApiKey } from "./acciones";
import { formatearFecha } from "@/lib/formato-cl";
import { CredencialUnaSolaVez } from "@/components/ui/credencial-una-sola-vez";

export interface ApiKeyRow {
  id: string;
  nombre: string;
  prefijo: string;
  permisos: string[];
  estado: "activa" | "revocada";
  ultimaLlamadaEn: string | null;
  creadaEn: string;
}

const PERMISOS_DISPONIBLES: { valor: string; etiqueta: string }[] = [
  { valor: "pedidos:leer", etiqueta: "Pedidos: leer" },
  { valor: "liquidaciones:leer", etiqueta: "Liquidaciones: leer" },
  { valor: "webhooks:gestionar", etiqueta: "Webhooks: gestionar" },
];

function formatearFechaRelativa(iso: string | null): string {
  if (!iso) return "Nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const dias = Math.floor(diff / 86_400_000);
  if (dias === 0) return "Hoy";
  if (dias === 1) return "Ayer";
  if (dias < 30) return `Hace ${dias} días`;
  const meses = Math.floor(dias / 30);
  return `Hace ${meses} mes${meses > 1 ? "es" : ""}`;
}

interface AlertaClave {
  clave: string;
}

function DialogCrearKey({ onCreada }: { onCreada: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [alerta, setAlerta] = useState<AlertaClave | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const resultado = await accionCrearApiKey(formData);
      if (!resultado.ok) {
        setError(resultado.mensaje ?? null);
        return;
      }
      formRef.current?.reset();
      setAlerta({ clave: resultado.clave ?? "" });
    });
  }

  function handleEntendido() {
    setAlerta(null);
    setOpen(false);
    onCreada();
  }

  return (
    /* Panel y no modal centrado: en teléfono el modal dejaba la clave —el
       texto que hay que copiar AHORA porque no se vuelve a mostrar— en una
       caja de 512 px con scroll propio. El panel es hoja inferior ahí y lateral
       en escritorio. */
    <PanelAccion
      abierto={open}
      onOpenChange={(v: boolean) => {
        if (!v) {
          setAlerta(null);
          setError(null);
        }
        setOpen(v);
      }}
      disparador={<Button size="sm">Nueva clave</Button>}
      titulo="Nueva clave de API"
      subtitulo="Para que tus propios sistemas lean y escriban en Rutax."
    >
      {alerta ? (
        /* ⚠️ REGLA 31 · «mostrada · copiada · advertencia PREVIA».
             Las dos primeras estaban; la tercera no. El aviso «copia esta
             clave ahora» aparecía junto a la clave YA generada, así que quien
             apretó «Crear» no sabía que abría una puerta de un solo sentido.
             Ahora la advertencia va antes, en el formulario.
             Y el botón de «Entendido» estaba habilitado desde el primer
             instante: un clic de más y la credencial se perdía para siempre,
             sin nada que lo impidiera. */
        <CredencialUnaSolaVez
          valor={alerta.clave}
          etiqueta="Tu clave"
          consecuencia={
            <>
              Si la pierdes no se puede recuperar: hay que revocar esta y crear
              otra, y cambiarla en todo lo que la use.
            </>
          }
          onConfirmar={handleEntendido}
        />
      ) : (
        <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
          {/* La advertencia PREVIA (regla 31): se dice antes de crear, no
                después de tener la clave en pantalla. */}
          <p className="border border-line bg-bg-sunken px-3 py-2.5 text-xs leading-relaxed text-fg-muted">
            La clave se muestra{" "}
            <strong className="text-fg">una sola vez</strong>, al crearla. Tenla
            a mano dónde vas a pegarla antes de continuar.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="nombre-key">Nombre</Label>
            <Input
              id="nombre-key"
              name="nombre"
              required
              placeholder="ej. ERP Producción"
              autoComplete="off"
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Permisos</legend>
            <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
              {PERMISOS_DISPONIBLES.map((p) => (
                <label
                  key={p.valor}
                  className="flex items-center gap-2.5 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    name={p.valor}
                    className="size-4 rounded border-border accent-primary"
                  />
                  <span className="font-mono text-xs">{p.valor}</span>
                  <span className="text-muted-foreground">— {p.etiqueta}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Creando…" : "Crear la clave"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              Volver
            </Button>
          </div>
        </form>
      )}
    </PanelAccion>
  );
}

function FilaApiKey({ row }: { row: ApiKeyRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRevocar() {
    startTransition(async () => {
      await accionRevocarApiKey(row.id);
      router.refresh();
    });
  }

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 font-medium">{row.nombre}</td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground">
          {row.prefijo}…
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {row.permisos.map((p) => (
            <Badge key={p} variant="outline" className="font-mono text-xs">
              {p}
            </Badge>
          ))}
        </div>
      </td>
      <td className="hidden px-4 py-3 text-sm text-muted-foreground sm:table-cell">
        {formatearFechaRelativa(row.ultimaLlamadaEn)}
      </td>
      <td className="hidden px-4 py-3 text-sm text-muted-foreground md:table-cell">
        {formatearFecha(row.creadaEn)}
      </td>
      <td className="px-4 py-3 text-right">
        {/* Regla 37: ninguna acción se confirma con un diálogo del navegador.
            Un `confirm()` no puede decir la consecuencia —cabe una pregunta y
            nada más— y sus botones dicen «Aceptar» y «Cancelar» en el idioma
            del sistema operativo, donde «Cancelar» significa otra cosa. */}
        <BotonConfirmado
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          deshabilitado={isPending}
          cargando={isPending}
          etiqueta="Revocar"
          // P3 · escribir, no P2: así lo tiene escrito el sistema de mensajes
          // (`integraciones.revocarClave.conf`). Una primera versión la dejó en
          // peldaño 2, y no alcanza — el error de este flujo no es «revocar sin
          // querer», es **revocar la clave equivocada** de una lista donde
          // todas se llaman parecido y solo se ven cuatro caracteres del
          // prefijo. Escribir el nombre es lo único que obliga a leer cuál.
          peldano={3}
          confirmacion={{ frase: row.nombre }}
          titulo={`Vas a revocar «${row.nombre}»`}
          consecuencia={
            <>
              Todo lo que use esta clave{" "}
              <strong>deja de funcionar al instante</strong> y no se puede
              reactivar: hay que crear otra y cambiarla donde esté puesta. Si no
              sabes qué la usa, revisa antes.
            </>
          }
          resumen={[
            { etiqueta: "Nombre", valor: row.nombre },
            { etiqueta: "Prefijo", valor: `${row.prefijo}…`, mono: true },
          ]}
          textoConfirmar="Revocar la clave"
          varianteModal="destructive"
          onConfirmar={handleRevocar}
        />
      </td>
    </tr>
  );
}

export function PanelApiKeys({ apiKeys }: { apiKeys: ApiKeyRow[] }) {
  const router = useRouter();
  const activas = apiKeys.filter((k) => k.estado === "activa");
  const revocadas = apiKeys.filter((k) => k.estado === "revocada");
  const [mostrarRevocadas, setMostrarRevocadas] = useState(false);

  const encabezadoTabla = (
    <thead>
      <tr className="border-b bg-muted/40 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <th className="px-4 py-2">Nombre</th>
        <th className="px-4 py-2">Prefijo</th>
        <th className="px-4 py-2">Permisos</th>
        <th className="hidden px-4 py-2 sm:table-cell">Última llamada</th>
        <th className="hidden px-4 py-2 md:table-cell">Creada</th>
        <th className="px-4 py-2">
          <span className="sr-only">Acciones</span>
        </th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Claves de API</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Con qué tus propios sistemas se identifican ante Rutax. Cada clave lleva sus
            permisos acotados.
          </p>
        </div>
        <DialogCrearKey onCreada={() => router.refresh()} />
      </div>

      {apiKeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          tono="arranque"
          titulo="Todavía no tienes claves"
          descripcion="Crea la primera para conectar tus propios sistemas a Rutax."
          accion={<DialogCrearKey onCreada={() => router.refresh()} />}
        />
      ) : (
        <div className="space-y-4">
          {activas.length > 0 && (
            <section aria-label="Claves de API activas">
              <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                <div className="overflow-x-auto">
                  <table
                    className="w-full text-sm"
                    aria-label="Claves de API activas"
                  >
                    {encabezadoTabla}
                    <tbody className="divide-y divide-border">
                      {activas.map((k) => (
                        <FilaApiKey key={k.id} row={k} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {revocadas.length > 0 && (
            <section aria-label="Claves de API revocadas">
              <button
                type="button"
                onClick={() => setMostrarRevocadas((v) => !v)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {mostrarRevocadas ? "Ocultar" : "Mostrar"} revocadas (
                {revocadas.length})
              </button>
              {mostrarRevocadas && (
                <div className="mt-2 overflow-hidden rounded-lg border bg-card opacity-60 shadow-sm">
                  <div className="overflow-x-auto">
                    <table
                      className="w-full text-sm"
                      aria-label="Claves de API revocadas"
                    >
                      {encabezadoTabla}
                      <tbody className="divide-y divide-border">
                        {revocadas.map((k) => (
                          <tr key={k.id} className="text-muted-foreground">
                            <td className="px-4 py-2.5">{k.nombre}</td>
                            <td className="px-4 py-2.5">
                              <span className="font-mono text-xs">
                                {k.prefijo}…
                              </span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {k.permisos.map((p) => (
                                  <Badge
                                    key={p}
                                    variant="outline"
                                    className="font-mono text-xs"
                                  >
                                    {p}
                                  </Badge>
                                ))}
                              </div>
                            </td>
                            <td className="hidden px-4 py-2.5 text-xs sm:table-cell">
                              {formatearFechaRelativa(k.ultimaLlamadaEn)}
                            </td>
                            <td className="hidden px-4 py-2.5 text-xs md:table-cell">
                              {formatearFecha(k.creadaEn)}
                            </td>
                            <td className="px-4 py-2.5" />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
