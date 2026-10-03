"use client";

/**
 * Panel de tiendas Shopify del seller, hermano de `panel-conexion-ml.tsx`.
 *
 * La diferencia de fondo con el de ML no es visual: allá el seller aprieta un
 * botón y Mercado Libre se encarga del resto. Acá tiene que ir a su propio admin
 * de Shopify, crear una app, marcar cuatro permisos y volver con sus credenciales. Ese
 * es el paso donde este flujo se rompe en la vida real, así que la pantalla
 * dedica más espacio a explicarlo que a mostrar el estado — y cuando falta un
 * permiso, lo nombra en vez de decir "faltan permisos".
 */

import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Plus, RefreshCw, Store, TriangleAlert } from "lucide-react";
import { BotonConfirmado } from "@/components/ui/boton-confirmado";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatearTiempoRelativo } from "@/lib/formato-cl";
import { SCOPES_REQUERIDOS } from "@/modules/integraciones/shopify/tipos";
import {
  conectarTiendaShopify,
  desconectarTiendaShopify,
  reconectarTiendaShopify,
  sincronizarTiendaShopify,
  type ConexionShopifySeller,
} from "./acciones-shopify";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { tonoSaludConexion } from "@/components/ui/tarjeta-salud-conexion";
import { TEXTO_SALUD_CONEXION } from "@/lib/ui/traduccion-estados";

// ⚠️ Acá vivían DOS mapas propios para los mismos cuatro estados que ya tenían
// nombre en `traduccion-estados.ts` y otra redacción todavía en el panel de ML.
// Tres vocabularios para cuatro estados, y el seller **ve dos de ellos en la
// misma pantalla**: su cuenta de ML «necesita atención» y su tienda Shopify
// está «con problemas» — dos nombres para lo mismo, uno al lado del otro.
// Ahora los dos paneles usan `TarjetaSaludConexion`.

const VENTANA_ENFRIAMIENTO_SYNC_MS = 60_000;

export function PanelConexionesShopify({
  conexionesIniciales,
}: {
  conexionesIniciales: ConexionShopifySeller[];
}) {
  const [abierto, setAbierto] = useState<null | { modo: "alta" } | { modo: "reconexion"; conexion: ConexionShopifySeller }>(
    null,
  );
  const [desconectandoId, setDesconectandoId] = useState<string | null>(null);
  // Keyed por id: con varias tiendas, un solo string pintaría el error de una
  // en la fila de la otra.
  const [errorPorId, setErrorPorId] = useState<Record<string, string>>({});

  // «Sincronizar ahora», con el mismo control que el panel de ML: un disparo a
  // la vez y un enfriamiento de un minuto por tienda para que el botón no
  // invite a apretarlo diez veces. La deduplicación real vive en el servidor
  // (llave de idempotencia por minuto en `solicitarSincronizacionShopify`).
  const [sincronizandoId, setSincronizandoId] = useState<string | null>(null);
  const [enEnfriamientoIds, setEnEnfriamientoIds] = useState<Set<string>>(new Set());
  const [pedidaPorId, setPedidaPorId] = useState<Record<string, boolean>>({});

  async function sincronizar(id: string) {
    if (sincronizandoId || enEnfriamientoIds.has(id)) return;
    setSincronizandoId(id);
    setErrorPorId((prev) => {
      const { [id]: _, ...resto } = prev;
      return resto;
    });
    try {
      const r = await sincronizarTiendaShopify(id);
      if (r.ok) setPedidaPorId((prev) => ({ ...prev, [id]: true }));
      else setErrorPorId((prev) => ({ ...prev, [id]: r.mensaje }));
    } catch {
      // La Server Action puede rechazar (red caída, deploy nuevo): el botón no
      // puede quedar colgado en el spinner sin decir nada.
      setErrorPorId((prev) => ({ ...prev, [id]: "No pudimos pedir la sincronización. Inténtalo de nuevo en unos minutos." }));
    } finally {
      setSincronizandoId(null);
      setEnEnfriamientoIds((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setEnEnfriamientoIds((prev) => {
          const copia = new Set(prev);
          copia.delete(id);
          return copia;
        });
      }, VENTANA_ENFRIAMIENTO_SYNC_MS);
    }
  }

  async function desconectar(id: string) {
    setDesconectandoId(id);
    setErrorPorId((prev) => {
      const { [id]: _, ...resto } = prev;
      return resto;
    });
    const r = await desconectarTiendaShopify(id);
    setDesconectandoId(null);
    if (!r.ok) setErrorPorId((prev) => ({ ...prev, [id]: r.mensaje }));
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Store className="size-4 text-muted-foreground" aria-hidden />
              Mis tiendas Shopify
            </h2>
            {conexionesIniciales.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Conecta tu tienda y tus pedidos entran solos.
              </p>
            ) : null}
          </div>
          <Button size="sm" variant="outline" onClick={() => setAbierto({ modo: "alta" })}>
            <Plus data-icon="inline-start" aria-hidden />
            Conectar tienda
          </Button>
        </div>

        {conexionesIniciales.length === 0 ? null : (
          <ul className="space-y-2">
            {conexionesIniciales.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-medium text-foreground">
                    {c.alias ?? c.nombreTienda ?? c.shopDomain}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.shopDomain}
                    {c.desconectadaPorPersona
                      ? ""
                      : c.ultimaSyncExitosaEn
                        ? ` · al día ${formatearTiempoRelativo(c.ultimaSyncExitosaEn)}`
                        : " · sin sincronizar todavía"}
                  </p>
                  {c.filtroEtiqueta ? (
                    <p className="truncate text-xs text-muted-foreground">
                      Solo pedidos con la etiqueta <span className="font-medium">{c.filtroEtiqueta}</span>
                    </p>
                  ) : null}
                  {errorPorId[c.id] ? (
                    <p role="alert" className="text-xs text-destructive">{errorPorId[c.id]}</p>
                  ) : pedidaPorId[c.id] ? (
                    <p role="status" className="text-xs text-muted-foreground">
                      Tus pedidos aparecerán en unos minutos.
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* 🔴 La que apagó el propio seller NO se pinta como avería.
                      Comparte `desvinculada` con el token revocado —es el estado
                      que corta la ingesta— pero decirle «Desconectada» en tono
                      de alarma a quien acaba de apagarla es reportarle como
                      problema lo que hizo queriendo. */}
                  {c.desconectadaPorPersona ? (
                    <DistintivoEstado tono="neutral" etiqueta="Desconectada por ti" />
                  ) : (
                    <DistintivoEstado
                      tono={tonoSaludConexion(c.estadoSalud)}
                      etiqueta={TEXTO_SALUD_CONEXION[c.estadoSalud]}
                    />
                  )}
                  {/* Solo sobre tiendas encendidas: el job salta la apagada o
                      desvinculada, y ofrecerlo prometería un efecto que no
                      ocurre. Condicional y no `hidden`: las utilidades de
                      `display` del botón le ganan al atributo. */}
                  {c.activa && c.estadoSalud !== "desvinculada" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void sincronizar(c.id)}
                      disabled={sincronizandoId !== null || enEnfriamientoIds.has(c.id)}
                      loading={sincronizandoId === c.id}
                      aria-label={`Sincronizar ahora los pedidos de ${c.alias ?? c.nombreTienda ?? c.shopDomain}`}
                    >
                      {sincronizandoId === c.id ? null : <RefreshCw data-icon="inline-start" aria-hidden />}
                      Sincronizar ahora
                    </Button>
                  ) : null}
                  {/* Sobre una tienda sana es ruido: solo donde hay algo que reponer. */}
                  {c.desconectadaPorPersona || c.estadoSalud !== "sana" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setAbierto({ modo: "reconexion", conexion: c })}
                    >
                      <KeyRound data-icon="inline-start" aria-hidden />
                      Reconectar
                    </Button>
                  ) : null}

                  {/* Peldaño 3 · hay que escribir el dominio de la tienda. No
                      porque sea catastrófico —los pedidos ya traídos se quedan y
                      volver es pegar las credenciales otra vez— sino porque el error de
                      este flujo no es «desconectar sin querer», es
                      **desconectar la tienda equivocada** de una lista donde
                      todas se llaman parecido. Escribirla obliga a leer cuál.

                      Solo se ofrece sobre lo que está encendido: apagar lo ya
                      apagado no cambia nada y sugeriría que sí. */}
                  {c.desconectadaPorPersona ? null : (
                    <BotonConfirmado
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      etiqueta="Desconectar"
                      deshabilitado={desconectandoId !== null}
                      cargando={desconectandoId === c.id}
                      peldano={3}
                      confirmacion={{ frase: c.shopDomain }}
                      titulo={`Vas a desconectar «${c.alias ?? c.nombreTienda ?? c.shopDomain}»`}
                      consecuencia={
                        <>
                          <strong>Dejamos de traer los pedidos de esta tienda.</strong> Los que ya
                          entraron se quedan como están, y puedes volver a conectarla cuando quieras
                          — hay que pegar las credenciales otra vez.
                          <br />
                          <br />
                          Esto <strong>no</strong> desinstala la app de tu tienda: eso se hace desde
                          tu propio panel de Shopify.
                        </>
                      }
                      resumen={[
                        { etiqueta: "Tienda", valor: c.shopDomain, mono: true },
                        ...(c.filtroEtiqueta
                          ? [{ etiqueta: "Filtro de etiqueta", valor: c.filtroEtiqueta }]
                          : []),
                      ]}
                      textoConfirmar="Desconectar la tienda"
                      varianteModal="destructive"
                      onConfirmar={() => void desconectar(c.id)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {abierto ? (
        <DialogoTienda
          estado={abierto}
          onCerrar={() => setAbierto(null)}
        />
      ) : null}
    </Card>
  );
}

function DialogoTienda({
  estado,
  onCerrar,
}: {
  estado: { modo: "alta" } | { modo: "reconexion"; conexion: ConexionShopifySeller };
  onCerrar: () => void;
}) {
  const esAlta = estado.modo === "alta";
  const [shopDomain, setShopDomain] = useState(esAlta ? "" : estado.conexion.shopDomain);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [etiqueta, setEtiqueta] = useState(esAlta ? "" : (estado.conexion.filtroEtiqueta ?? ""));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scopesFaltantes, setScopesFaltantes] = useState<string[]>([]);

  async function enviar() {
    setEnviando(true);
    setError(null);
    setScopesFaltantes([]);

    const resultado = esAlta
      ? await conectarTiendaShopify({
          shopDomain,
          clientId,
          clientSecret,
          filtroEtiqueta: etiqueta.trim() || null,
        })
      : await reconectarTiendaShopify({ conexionId: estado.conexion.id, clientId, clientSecret });

    setEnviando(false);
    if (resultado.ok) {
      onCerrar();
      return;
    }
    setError(resultado.mensaje);
    setScopesFaltantes(resultado.scopesFaltantes ?? []);
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{esAlta ? "Conectar tu tienda Shopify" : "Reconectar la tienda"}</DialogTitle>
          <DialogDescription>Se hace desde el admin de tu tienda.</DialogDescription>
        </DialogHeader>

        {/* Los pasos van también al reconectar: quien reconecta suele ser
            quien borró o rehízo la app, y necesita el mismo camino. Desde el
            1-ene-2026 Shopify ya no deja crear apps en el admin: se crean en
            el Dev Dashboard, y el acceso son dos valores, no un token. */}
        <ol className="list-decimal space-y-1.5 rounded-md bg-muted/50 px-5 py-3 text-sm text-muted-foreground">
          <li>
            Entra a <span className="font-medium text-foreground">Configuración → Apps → Desarrollar apps</span> y
            elige <span className="font-medium text-foreground">Crear apps en el Dev Dashboard</span>.
          </li>
          <li>
            Crea una app llamada <span className="font-medium text-foreground">Rutax</span> y, en su versión, marca
            estos permisos:
            <ul className="mt-1 space-y-0.5">
              {SCOPES_REQUERIDOS.map((s) => (
                <li key={s}>
                  <code className="rounded bg-background px-1 py-0.5 text-xs text-foreground">{s}</code>
                </li>
              ))}
            </ul>
          </li>
          <li>
            Aprieta <span className="font-medium text-foreground">Lanzar</span> y después{" "}
            <span className="font-medium text-foreground">Instalar app</span>.
          </li>
          <li>
            En <span className="font-medium text-foreground">Credenciales</span> de la app, copia el{" "}
            <span className="font-medium text-foreground">ID de cliente</span> y el{" "}
            <span className="font-medium text-foreground">Secreto del cliente</span>.
          </li>
        </ol>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="shopify-dominio">Dominio de tu tienda</Label>
            <Input
              id="shopify-dominio"
              value={shopDomain}
              disabled={!esAlta || enviando}
              onChange={(e) => setShopDomain(e.target.value)}
              placeholder="mi-tienda.myshopify.com"
              autoComplete="off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shopify-client-id">ID de cliente</Label>
            <Input
              id="shopify-client-id"
              value={clientId}
              disabled={enviando}
              onChange={(e) => setClientId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shopify-client-secret">Secreto del cliente</Label>
            <Input
              id="shopify-client-secret"
              // `password` para que no quede a la vista de quien pase por detrás
              // ni lo capture un gestor de contraseñas como si fuera un usuario.
              type="password"
              value={clientSecret}
              disabled={enviando}
              onChange={(e) => setClientSecret(e.target.value)}
              autoComplete="off"
            />
          </div>

          {esAlta ? (
            <div className="space-y-1.5">
              <Label htmlFor="shopify-etiqueta">
                Etiqueta para filtrar <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id="shopify-etiqueta"
                value={etiqueta}
                disabled={enviando}
                onChange={(e) => setEtiqueta(e.target.value)}
                placeholder="rutax"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Si la dejas vacía, tomamos todos tus pedidos sin despachar que estén dentro de la zona de reparto.
                Si pones una etiqueta, solo tomamos los pedidos que la lleven en Shopify.
              </p>
            </div>
          ) : null}
        </div>

        {error ? (
          <Alert variant="destructive">
            <TriangleAlert aria-hidden />
            <AlertDescription className="space-y-1.5">
              <p>{error}</p>
              {scopesFaltantes.length > 0 ? (
                <ul className="space-y-0.5">
                  {scopesFaltantes.map((s) => (
                    <li key={s}>
                      <code className="rounded bg-background px-1 py-0.5 text-xs">{s}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={enviar} disabled={
              enviando ||
              clientId.trim().length === 0 ||
              clientSecret.trim().length === 0 ||
              shopDomain.trim().length === 0
            }>
            {enviando ? (
              <>
                <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden />
                Comprobando…
              </>
            ) : (
              <>
                <CheckCircle2 data-icon="inline-start" aria-hidden />
                {esAlta ? "Conectar" : "Reconectar"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
