"use client";

import { useState, useTransition, useRef } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Copy, Check, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import {
  accionCrearApiKey,
  accionRevocarApiKey,
} from "./acciones";

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

function formatearFecha(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

interface AlertaClave {
  clave: string;
  copiado: boolean;
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
      setAlerta({ clave: resultado.clave ?? '', copiado: false });
    });
  }

  function handleCopiar() {
    if (!alerta) return;
    navigator.clipboard.writeText(alerta.clave).then(() => {
      setAlerta((prev) => prev ? { ...prev, copiado: true } : prev);
    });
  }

  function handleEntendido() {
    setAlerta(null);
    setOpen(false);
    onCreada();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setAlerta(null); setError(null); } setOpen(v); }}>
      <DialogTrigger asChild>
        <Button size="sm">Nueva API key</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva API key</DialogTitle>
        </DialogHeader>

        {alerta ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                Copia esta clave ahora — no se mostrará de nuevo.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={alerta.clave}
                className="font-mono text-sm"
                aria-label="API key generada"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleCopiar}
                aria-label="Copiar clave"
              >
                {alerta.copiado ? (
                  <Check className="size-4 text-green-600" />
                ) : (
                  <Copy className="size-4" />
                )}
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={handleEntendido}>Entendido</Button>
            </DialogFooter>
          </div>
        ) : (
          <form ref={formRef} onSubmit={handleSubmit} className="space-y-5">
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
                  <label key={p.valor} className="flex items-center gap-2.5 text-sm cursor-pointer">
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

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={isPending}>
                  Cancelar
                </Button>
              </DialogClose>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creando..." : "Crear key"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function FilaApiKey({ row }: { row: ApiKeyRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRevocar() {
    if (!window.confirm(`¿Revocar la API key "${row.nombre}"? Esta acción no se puede deshacer.`)) return;
    startTransition(async () => {
      await accionRevocarApiKey(row.id);
      router.refresh();
    });
  }

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-3 font-medium">{row.nombre}</td>
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-muted-foreground">{row.prefijo}…</span>
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
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={isPending}
          onClick={handleRevocar}
        >
          {isPending ? "Revocando..." : "Revocar"}
        </Button>
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
        <th className="px-4 py-2"><span className="sr-only">Acciones</span></th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">API Keys</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Credenciales para integraciones externas. Cada key tiene permisos acotados.
          </p>
        </div>
        <DialogCrearKey onCreada={() => router.refresh()} />
      </div>

      {apiKeys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          tono="arranque"
          titulo="Sin API keys"
          descripcion="Crea tu primera API key para conectar sistemas externos a Rutax."
          accion={<DialogCrearKey onCreada={() => router.refresh()} />}
        />
      ) : (
        <div className="space-y-4">
          {activas.length > 0 && (
            <section aria-label="API keys activas">
              <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" aria-label="API keys activas">
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
            <section aria-label="API keys revocadas">
              <button
                type="button"
                onClick={() => setMostrarRevocadas((v) => !v)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {mostrarRevocadas ? "Ocultar" : "Mostrar"} revocadas ({revocadas.length})
              </button>
              {mostrarRevocadas && (
                <div className="mt-2 overflow-hidden rounded-xl border bg-card opacity-60 shadow-sm">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm" aria-label="API keys revocadas">
                      {encabezadoTabla}
                      <tbody className="divide-y divide-border">
                        {revocadas.map((k) => (
                          <tr key={k.id} className="text-muted-foreground">
                            <td className="px-4 py-2.5">{k.nombre}</td>
                            <td className="px-4 py-2.5">
                              <span className="font-mono text-xs">{k.prefijo}…</span>
                            </td>
                            <td className="px-4 py-2.5">
                              <div className="flex flex-wrap gap-1">
                                {k.permisos.map((p) => (
                                  <Badge key={p} variant="outline" className="font-mono text-xs">
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
