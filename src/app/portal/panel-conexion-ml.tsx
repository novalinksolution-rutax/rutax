"use client";

/**
 * Panel de cuentas de Mercado Libre del seller — modelo 1:N (hasta
 * `MAX_CUENTAS_ML` cuentas, única fuente de verdad en conectar-ml/compartido).
 *
 * Reemplaza la tarjeta única 1:1 por una LISTA de tarjetas, una por conexión.
 * Traduce `estado_salud` a lenguaje humano (nunca expone strings internos ni
 * jerga: token/OAuth/refresh). Controles por tarjeta: "Reconectar" (solo si la
 * cuenta necesita atención/está desvinculada) y "Editar nombre" (alias). Bajo
 * la lista: "Agregar otra cuenta" mientras haya menos del tope; al llegarlo,
 * una nota informativa en vez del botón.
 *
 * "Agregar otra cuenta" pasa antes por un diálogo de aviso: Mercado Libre NO
 * soporta forzar selección de cuenta ni re-login (`prompt`/`select_account`/
 * `login_hint` no existen en su `/authorization`), así que conecta de
 * inmediato la cuenta que el seller tenga con sesión activa en el navegador.
 * El diálogo se lo explica ANTES de salir, para que no interprete "te
 * devolvió la misma cuenta" como que el sistema falló.
 *
 * Reglas de seguridad respetadas por diseño: el seller NUNCA escribe directo en
 * `conexiones_seller_ml`. Reconexión y alias van por server actions con
 * service_role + verificación de propiedad (ver conectar-ml/actions y actions).
 */

import { useState } from "react";
import { CheckCircle2, Clock, Loader2, Plus, ShieldAlert, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EstadoError } from "@/components/onboarding/estado-pantalla";
import { formatearFecha, formatearTiempoRelativo } from "@/lib/formato-cl";
import { MAX_CUENTAS_ML } from "./conectar-ml/compartido";
import { iniciarConexionMl } from "./conectar-ml/actions";
import { obtenerConexionesPropia, renombrarConexionMl, type ConexionMlSellerItem } from "./actions";

interface Props {
  conexionesIniciales: ConexionMlSellerItem[];
  errorInicial: string | null;
}

export function PanelConexionesMl({ conexionesIniciales, errorInicial }: Props) {
  const [conexiones, setConexiones] = useState<ConexionMlSellerItem[]>(conexionesIniciales);
  const [error, setError] = useState<string | null>(errorInicial);
  const [cargando, setCargando] = useState(false);
  const [accionandoId, setAccionandoId] = useState<string | null>(null); // "nueva" para alta
  const [errorAccion, setErrorAccion] = useState<string | null>(null);
  const [mostrarAvisoAgregar, setMostrarAvisoAgregar] = useState(false);

  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [valorEdit, setValorEdit] = useState("");
  const [errorEdit, setErrorEdit] = useState<string | null>(null);
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  async function recargar() {
    setCargando(true);
    setError(null);
    try {
      const resultado = await obtenerConexionesPropia();
      if (!resultado.ok) {
        setError(resultado.mensaje);
        return;
      }
      setConexiones(resultado.conexiones);
    } catch {
      // Falla de red o Server Action obsoleta (p. ej. tras un deploy nuevo):
      // igual liberamos el estado de carga y dejamos un mensaje accionable
      // en vez de dejar el spinner girando para siempre.
      setError("No pudimos cargar tus cuentas de Mercado Libre por un problema de conexión. Recarga la página e intenta de nuevo.");
    } finally {
      setCargando(false);
    }
  }

  async function iniciar(modo: "conexion_inicial" | "reconexion" | "agregar_cuenta", conexionId?: string) {
    const clave = conexionId ?? "nueva";
    if (accionandoId) return;
    setErrorAccion(null);
    setAccionandoId(clave);

    try {
      const resultado = await iniciarConexionMl(modo, conexionId);
      if (!resultado.ok || !resultado.urlAutorizacion) {
        setAccionandoId(null);
        setErrorAccion(
          resultado.mensaje ??
            "No pudimos iniciar la conexión con Mercado Libre por un problema de nuestro sistema. Intenta de nuevo en unos minutos.",
        );
        return;
      }
      window.location.assign(resultado.urlAutorizacion);
    } catch {
      // Si la Server Action rechaza (red caída, o quedó obsoleta tras un
      // despliegue nuevo) el botón NO debe quedar deshabilitado para
      // siempre con el spinner puesto — liberamos el estado y avisamos.
      setAccionandoId(null);
      setErrorAccion(
        "No pudimos conectar con Mercado Libre por un problema de conexión. Recarga la página e intenta de nuevo.",
      );
    }
  }

  function empezarEdicion(c: ConexionMlSellerItem) {
    setEditandoId(c.id);
    setValorEdit(c.alias ?? "");
    setErrorEdit(null);
  }

  async function guardarAlias(id: string) {
    if (guardandoEdit) return;
    setGuardandoEdit(true);
    setErrorEdit(null);
    try {
      const resultado = await renombrarConexionMl(id, valorEdit);
      if (!resultado.ok) {
        setErrorEdit(resultado.mensaje);
        return;
      }
      setConexiones((prev) => prev.map((c) => (c.id === id ? { ...c, alias: resultado.alias } : c)));
      setEditandoId(null);
    } catch {
      setErrorEdit("No pudimos guardar el nombre por un problema de conexión. Intenta de nuevo.");
    } finally {
      setGuardandoEdit(false);
    }
  }

  if (error && conexiones.length === 0) {
    return <EstadoError descripcion={error} onReintentar={recargar} reintentando={cargando} />;
  }

  const ordenadas = [...conexiones].sort((a, b) => prioridad(a.estadoSalud) - prioridad(b.estadoSalud));

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">Mis cuentas de Mercado Libre</h2>
        <p className="text-sm text-muted-foreground">
          Tus pedidos se sincronizan automáticamente desde estas cuentas.
        </p>
      </div>

      {conexiones.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 px-6 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Clock className="size-6" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">Todavía no conectaste ninguna cuenta de Mercado Libre</p>
              <p className="text-sm text-muted-foreground">
                Conéctala para que tus pedidos empiecen a sincronizarse automáticamente en este portal.
              </p>
            </div>
            <Button onClick={() => iniciar("conexion_inicial")} disabled={accionandoId !== null} size="lg">
              {accionandoId === "nueva" ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              {accionandoId === "nueva" ? "Te llevamos a Mercado Libre…" : "Conectar mi cuenta de Mercado Libre"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3" role="list">
          {ordenadas.map((c) => {
            const p = presentacion(c);
            const enEdicion = editandoId === c.id;
            return (
              <li key={c.id} role="listitem">
                <Card className={p.bordeTarjeta} aria-label={`Conexión: ${etiquetaCuenta(c)}`}>
                  <CardContent className="flex flex-col gap-3 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-3 text-left">
                      <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${p.fondoIcono}`}>
                        {p.icono}
                      </div>
                      <div className="space-y-1">
                        {enEdicion ? (
                          <div className="space-y-1.5">
                            <input
                              autoFocus
                              value={valorEdit}
                              maxLength={40}
                              onChange={(e) => setValorEdit(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void guardarAlias(c.id);
                                if (e.key === "Escape") setEditandoId(null);
                              }}
                              className="w-full max-w-64 rounded-md border border-input bg-background px-2 py-1 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                              placeholder="Nombre de la cuenta"
                              aria-label={`Editar nombre de ${etiquetaCuenta(c)}`}
                            />
                            <div className="flex items-center gap-2">
                              <Button size="sm" onClick={() => void guardarAlias(c.id)} disabled={guardandoEdit}>
                                {guardandoEdit ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}
                                Guardar
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditandoId(null)} disabled={guardandoEdit}>
                                Cancelar
                              </Button>
                            </div>
                            {errorEdit ? <p className="text-xs text-destructive">{errorEdit}</p> : null}
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <p className="font-medium text-foreground">{etiquetaCuenta(c)}</p>
                            <button
                              type="button"
                              onClick={() => empezarEdicion(c)}
                              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                            >
                              Editar nombre
                            </button>
                          </div>
                        )}
                        <p className="text-sm text-muted-foreground">{p.titulo}</p>
                        {p.detalle ? <p className="text-xs text-muted-foreground">{p.detalle}</p> : null}
                      </div>
                    </div>

                    {p.mostrarReconectar ? (
                      <Button
                        onClick={() => iniciar("reconexion", c.id)}
                        disabled={accionandoId !== null}
                        variant={p.tono === "critico" ? "default" : "outline"}
                        className="shrink-0"
                      >
                        {accionandoId === c.id ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
                        {accionandoId === c.id ? "Te llevamos a Mercado Libre…" : "Reconectar"}
                      </Button>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {conexiones.length > 0 && conexiones.length < MAX_CUENTAS_ML ? (
        <Button
          variant="outline"
          onClick={() => setMostrarAvisoAgregar(true)}
          disabled={accionandoId !== null}
          className="w-full sm:w-auto"
        >
          {accionandoId === "nueva" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
          {accionandoId === "nueva" ? "Te llevamos a Mercado Libre…" : "Agregar otra cuenta de Mercado Libre"}
        </Button>
      ) : null}

      {conexiones.length >= MAX_CUENTAS_ML ? (
        <p className="text-sm text-muted-foreground">Ya tienes {MAX_CUENTAS_ML} cuentas conectadas — ese es el límite máximo.</p>
      ) : null}

      {errorAccion ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertDescription>{errorAccion}</AlertDescription>
        </Alert>
      ) : null}

      <DialogAvisoAgregarCuenta
        open={mostrarAvisoAgregar}
        onOpenChange={setMostrarAvisoAgregar}
        onContinuar={() => {
          setMostrarAvisoAgregar(false);
          void iniciar("agregar_cuenta");
        }}
      />
    </section>
  );
}

/**
 * Aviso previo a "Agregar otra cuenta" — Mercado Libre no soporta forzar
 * re-login ni selección de cuenta en su `/authorization` (no existen
 * `prompt`/`select_account`/`login_hint`), así que conecta de inmediato la
 * cuenta que el seller ya tenga con sesión activa en ESTE navegador. Sin este
 * aviso, un seller que quiere agregar una cuenta distinta termina viendo
 * "¡Listo! Agregaste la cuenta correctamente" cuando en realidad ML le
 * devolvió la misma cuenta de siempre — el bug real que motivó este diálogo.
 *
 * Deliberadamente NO ofrece "copiar el enlace para abrirlo en una ventana
 * privada": la cookie httpOnly del `state` anti-CSRF (y la sesión del portal)
 * quedan en el navegador donde se generó el enlace — una ventana privada no
 * comparte cookies con la ventana normal, así que un enlace pegado ahí
 * fallaría la validación de `state` en el callback (o, antes de eso, no
 * tendría sesión de seller). La salida real es repetir el proceso COMPLETO
 * dentro de la ventana privada (entrar al portal ahí y volver a apretar el
 * botón), no reutilizar un enlace ya generado en otra ventana.
 */
function DialogAvisoAgregarCuenta({
  open,
  onOpenChange,
  onContinuar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinuar: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Vas a conectar la cuenta de este navegador</DialogTitle>
          <DialogDescription>
            Mercado Libre conecta automáticamente la cuenta con la que tengas la sesión iniciada ahora
            mismo en este navegador — no te va a dejar elegir otra en la pantalla siguiente.
          </DialogDescription>
        </DialogHeader>

        <div
          className="flex gap-3 rounded-lg border-2 border-warning/50 bg-warning/10 px-4 py-4 text-left"
          role="alert"
        >
          <TriangleAlert className="size-6 shrink-0 text-warning" aria-hidden="true" />
          <div className="space-y-1">
            <p className="font-semibold text-foreground">¿Quieres agregar una cuenta distinta?</p>
            <p className="text-sm text-foreground">
              Primero cierra la sesión de Mercado Libre en este navegador — entra a{" "}
              <a
                href="https://www.mercadolibre.cl"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                mercadolibre.cl
              </a>{" "}
              y cierra sesión — y vuelve a intentarlo. También puedes hacerlo desde una ventana de
              navegación privada o incógnito: inicia sesión ahí en tu portal y repite este mismo paso.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={onContinuar}>
            Continuar de todas formas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Prioridad de orden: lo que requiere acción primero. */
function prioridad(estado: ConexionMlSellerItem["estadoSalud"]): number {
  switch (estado) {
    case "desvinculada":
      return 0;
    case "atencion":
      return 1;
    case "pendiente":
      return 2;
    case "sana":
    default:
      return 3;
  }
}

/** Nombre visible de la cuenta: alias → nickname de ML → últimos 4 del user_id. */
function etiquetaCuenta(c: ConexionMlSellerItem): string {
  if (c.alias && c.alias.trim().length > 0) return c.alias;
  if (c.mlNickname && c.mlNickname.trim().length > 0) return c.mlNickname;
  if (c.mlUserId && c.mlUserId.length >= 4) return `Cuenta ···${c.mlUserId.slice(-4)}`;
  return "Cuenta de Mercado Libre";
}

interface Presentacion {
  icono: React.ReactNode;
  titulo: string;
  detalle: string | null;
  fondoIcono: string;
  bordeTarjeta: string;
  tono: "ok" | "neutro" | "atencion" | "critico";
  mostrarReconectar: boolean;
}

/** Traduce `estado_salud` a lenguaje humano — nunca expone jerga técnica. */
function presentacion(c: ConexionMlSellerItem): Presentacion {
  switch (c.estadoSalud) {
    case "sana":
      return {
        icono: <CheckCircle2 className="size-5" aria-hidden="true" />,
        titulo: "Conectada y sincronizando",
        detalle: c.ultimaSyncExitosaEn ? `Última sincronización: ${formatearTiempoRelativo(c.ultimaSyncExitosaEn)}` : null,
        fondoIcono: "bg-success/15 text-success",
        bordeTarjeta: "border-success/30",
        tono: "ok",
        mostrarReconectar: false,
      };
    case "pendiente":
      return {
        icono: <Clock className="size-5" aria-hidden="true" />,
        titulo: "Configurando…",
        detalle: "Esto es transitorio — no necesitas hacer nada por ahora.",
        fondoIcono: "bg-muted text-muted-foreground",
        bordeTarjeta: "border-border",
        tono: "neutro",
        mostrarReconectar: false,
      };
    case "atencion":
      return {
        icono: <TriangleAlert className="size-5" aria-hidden="true" />,
        titulo: "Necesita atención",
        detalle: "Es un problema operativo de nuestro lado o de Mercado Libre. Si persiste, reconéctala.",
        fondoIcono: "bg-warning/15 text-warning",
        bordeTarjeta: "border-warning/30",
        tono: "atencion",
        mostrarReconectar: true,
      };
    case "desvinculada":
    default:
      return {
        icono: <ShieldAlert className="size-5" aria-hidden="true" />,
        titulo: "Desconectada — reconéctala para seguir recibiendo tus pedidos",
        detalle: c.desconectadaDesde ? `Desde el ${formatearFecha(c.desconectadaDesde)}.` : null,
        fondoIcono: "bg-destructive/15 text-destructive",
        bordeTarjeta: "border-destructive/30",
        tono: "critico",
        mostrarReconectar: true,
      };
  }
}
