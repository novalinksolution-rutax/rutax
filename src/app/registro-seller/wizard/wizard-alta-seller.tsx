"use client";

/**
 * Wizard de alta de seller por autoservicio (RF-010 rediseño).
 * =============================================================================
 * Cinco pasos — empresa, contacto, bodega, WhatsApp de retiro, fuentes — cada
 * uno persistido por su propia Server Action en la cookie firmada del wizard
 * (`borrador-wizard-seller.ts`). NADA se escribe en la base hasta el último
 * paso (`finalizarAltaSellerAction` → `commitAltaSellerAutoservicio`), así que
 * abandonar el wizard a la mitad no deja filas huérfanas.
 *
 * Progreso resumible: si el visitante recarga o vuelve más tarde,
 * `estadoInicial` (traído por el servidor con `obtenerEstadoWizardSellerAction`)
 * ya trae los pasos completados, y el wizard abre en el primero que falte.
 *
 * La dirección de la bodega usa el buscador con autocompletado compartido
 * (`CampoDireccion`): al elegir de la lista, la coordenada y la comuna quedan
 * resueltas en el momento. Si se teclea sin elegir, el geocoding corre igual,
 * SÍNCRONO, en `guardarPasoBodegaAction`; una bodega sin ubicar se guarda de
 * todos modos y el courier la corrige después.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, CheckCircle2, MapPin, ShieldAlert, Truck, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { esRutValido } from "@/modules/identidad/rut";
import { enmascararRut, limpiarMascaraRut } from "@/lib/formato-cl";
import { formatearTelefonoLegible, normalizarTelefonoE164 } from "@/lib/telefono-cl";
import { cn } from "@/lib/utils";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { CampoDireccion } from "@/components/ui/campo-direccion";
import { comunaDelCatalogo } from "@/app/(tenant)/operaciones/nuevo/reglas-alta";
import { FUENTES_DECLARABLES } from "@/modules/identidad/alta-seller-autoservicio";
import type { EstadoWizardAltaSeller, FuenteWizardSeller } from "@/lib/identidad/borrador-wizard-seller";
import {
  finalizarAltaSellerAction,
  guardarPasoBodegaAction,
  guardarPasoContactoAction,
  guardarPasoEmpresaAction,
  guardarPasoFuentesAction,
  resolverDireccionSellerAction,
  sugerirDireccionSellerAction,
} from "./actions";

const MENSAJE_RUT_INVALIDO = "El dígito verificador no corresponde a este RUT.";
const MENSAJE_RUT_FORMATO = "Ingresa el RUT con el formato 12.345.678-9.";

/**
 * Los cuatro pasos con su ícono y su título. El título vive ACÁ y no dentro de
 * cada formulario porque ahora lo encabeza la banda de cabecera: tener dos
 * fuentes de verdad («Tu bodega» arriba, «Dónde retira el conductor» abajo) era
 * justo la duplicación que se retiró.
 */
const PASOS = [
  { icono: Building2, titulo: "Los datos de tu empresa" },
  { icono: User, titulo: "Tu contacto" },
  { icono: MapPin, titulo: "Dónde retira el conductor" },
  { icono: Truck, titulo: "De dónde vienen tus pedidos" },
] as const;

/** Same-day: la fuente que todo seller tiene sin conectar nada. Fija, siempre elegida. */
const FUENTE_FIJA: FuenteWizardSeller = "rutax_manual";

/** El paso por el que hay que abrir, según lo que ya esté guardado. */
function pasoInicial(estado: EstadoWizardAltaSeller): number {
  if (!estado.empresa) return 0;
  // El paso de contacto guarda el número Y el WhatsApp de retiro. Se exige que
  // ambos estén: un borrador viejo (de antes de fusionar los pasos) puede tener
  // contacto sin whatsapp — en ese caso hay que volver al paso de contacto a
  // capturar el número, o el commit final fallaría por whatsapp faltante.
  if (!estado.contacto || !estado.whatsapp) return 1;
  if (!estado.bodega) return 2;
  return 3;
}

export function WizardAltaSeller({
  estadoInicial,
  nombreFantasia,
}: {
  estadoInicial: EstadoWizardAltaSeller;
  nombreFantasia: string;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState(() => pasoInicial(estadoInicial));

  // ── Paso 0 · Empresa ──────────────────────────────────────────────────────
  const [razonSocial, setRazonSocial] = useState(estadoInicial.empresa?.razonSocial ?? "");
  const [rut, setRut] = useState(estadoInicial.empresa?.rut ? enmascararRut(estadoInicial.empresa.rut) : "");
  const [aceptaDatos, setAceptaDatos] = useState(estadoInicial.empresa?.aceptaConsentimientoDatos ?? false);
  const [errorRut, setErrorRut] = useState<string | null>(null);

  // ── Paso 1 · Contacto + WhatsApp de retiro (mismo número) ─────────────────
  const [nombreContacto, setNombreContacto] = useState(estadoInicial.contacto?.nombreContacto ?? "");
  const [telefonoContacto, setTelefonoContacto] = useState(
    estadoInicial.contacto?.telefono ?? estadoInicial.whatsapp?.telefono ?? "",
  );
  const [aceptaWhatsapp, setAceptaWhatsapp] = useState(estadoInicial.whatsapp?.acepta ?? false);
  const [errorTelefono, setErrorTelefono] = useState<string | null>(null);

  // ── Paso 2 · Bodega ───────────────────────────────────────────────────────
  /**
   * En el alta el seller tiene UNA bodega: pedirle que la bautice es trabajo sin
   * recompensa. Nace con un nombre por defecto y la renombra desde el portal el
   * día que abra la segunda. El borrador conserva el nombre si ya venía puesto.
   */
  const nombreBodega = estadoInicial.bodega?.nombre?.trim() || "Bodega principal";
  const [direccionBodega, setDireccionBodega] = useState(estadoInicial.bodega?.direccion ?? "");
  const [comunaBodega, setComunaBodega] = useState(estadoInicial.bodega?.comuna ?? "");
  const [latBodega, setLatBodega] = useState<number | null>(estadoInicial.bodega?.lat ?? null);
  const [longBodega, setLongBodega] = useState<number | null>(estadoInicial.bodega?.long ?? null);
  const [direccionBodegaElegida, setDireccionBodegaElegida] = useState(
    estadoInicial.bodega?.lat != null && estadoInicial.bodega?.long != null,
  );
  const [instruccionesBodega, setInstruccionesBodega] = useState(estadoInicial.bodega?.instruccionesAcceso ?? "");

  // ── Paso 3 · Fuentes ──────────────────────────────────────────────────────
  // Same-day (despacho propio de Rutax) no requiere conectar ninguna cuenta, así
  // que todo seller lo tiene: nace elegida y fija (no se puede desmarcar).
  const [fuentes, setFuentes] = useState<FuenteWizardSeller[]>(() => {
    const iniciales = new Set<FuenteWizardSeller>(estadoInicial.fuentes ?? []);
    iniciales.add(FUENTE_FIJA);
    return Array.from(iniciales);
  });

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorFinal, setErrorFinal] = useState<{ tipo: string; mensaje: string } | null>(null);

  function irA(indice: number) {
    setError(null);
    setPaso(indice);
  }

  function manejarCambioRut(v: string) {
    setRut(enmascararRut(v));
    setErrorRut(null);
  }

  function validarRutAlPerderFoco() {
    const limpio = limpiarMascaraRut(rut);
    if (!limpio) return;
    if (!/^[0-9]{1,8}-[0-9kK]$/.test(limpio)) {
      setErrorRut(MENSAJE_RUT_FORMATO);
      return;
    }
    if (!esRutValido(limpio)) setErrorRut(MENSAJE_RUT_INVALIDO);
  }

  /** Al salir del campo, deja el número en la forma que WhatsApp necesita — o avisa. */
  function normalizarWhatsappAlPerderFoco() {
    const bruto = telefonoContacto.trim();
    if (!bruto) {
      setErrorTelefono(null);
      return;
    }
    const r = normalizarTelefonoE164(bruto);
    if (r.valido) {
      setTelefonoContacto(formatearTelefonoLegible(r.telefonoE164));
      setErrorTelefono(null);
    } else {
      setErrorTelefono("Escríbelo como +56 9 1234 5678.");
    }
  }

  async function guardarEmpresa(e: FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setError(null);
    setGuardando(true);
    const r = await guardarPasoEmpresaAction({
      razonSocial,
      rut: limpiarMascaraRut(rut),
      aceptaConsentimientoDatos: aceptaDatos,
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    irA(1);
  }

  async function guardarContacto(e: FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setError(null);
    setGuardando(true);
    const r = await guardarPasoContactoAction({
      nombreContacto,
      telefono: telefonoContacto,
      acepta: aceptaWhatsapp,
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    irA(2);
  }

  async function guardarBodega(e: FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setError(null);
    setGuardando(true);
    const r = await guardarPasoBodegaAction({
      nombre: nombreBodega,
      direccion: direccionBodega,
      comuna: comunaBodega,
      instruccionesAcceso: instruccionesBodega || undefined,
      // El contacto de bodega ya no se pide en el alta (el paso anterior captura
      // nombre y WhatsApp del seller); se conserva lo que traiga el borrador.
      contactoNombre: estadoInicial.bodega?.contactoNombre || undefined,
      contactoTelefono: estadoInicial.bodega?.contactoTelefono || undefined,
      // Si eligió del buscador, la coordenada ya viene resuelta y la Server
      // Action la usa tal cual (no re-geocodifica).
      lat: latBodega ?? undefined,
      long: longBodega ?? undefined,
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    irA(3);
  }

  function alternarFuente(f: FuenteWizardSeller) {
    if (f === FUENTE_FIJA) return; // Same-day siempre incluida.
    setFuentes((actual) => (actual.includes(f) ? actual.filter((x) => x !== f) : [...actual, f]));
  }

  async function terminar(e: FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setError(null);
    setErrorFinal(null);

    if (fuentes.length === 0) {
      setError("Selecciona al menos una fuente de pedidos para continuar.");
      return;
    }

    setGuardando(true);
    const rFuentes = await guardarPasoFuentesAction({ fuentes });
    if (!rFuentes.ok) {
      setGuardando(false);
      setError(rFuentes.mensaje);
      return;
    }

    const rFinal = await finalizarAltaSellerAction();
    setGuardando(false);
    if (!rFinal.ok) {
      setErrorFinal({ tipo: rFinal.tipo, mensaje: rFinal.mensaje });
      return;
    }

    router.push("/portal");
  }

  const total = PASOS.length;
  const IconoPaso = PASOS[paso].icono;

  // La regla de acento de 2px del borde superior es el ÚNICO subrayado del
  // sistema (rx-tokens §8). El ADN NO tiene sombras: la jerarquía se construye
  // con escalón de fondo, borde y esa regla.
  return (
    <div className="w-full max-w-xl border border-line border-t-2 border-t-primary bg-bg-raised">
      <header className="flex flex-col gap-3 border-b border-line-subtle bg-bg-inset px-5 py-4 sm:px-6">
        <div className="flex items-baseline justify-between gap-4">
          {/* `--rx-text-9` existe exactamente para esto: etiqueta mono en caja
              alta con tracking. Antes era mono a 12.5px en caja baja. */}
          <p className="rx-num text-[length:var(--rx-text-9)] font-semibold tracking-[var(--rx-track-caps)] text-fg-muted uppercase">
            Paso {paso + 1} de {total}
          </p>
          <p className="truncate text-[length:var(--rx-text-11)] text-fg-muted">{nombreFantasia}</p>
        </div>

        {/* Progreso por TRAMOS, no barra: el sistema marca con reglas de 2px
            (`--rx-border-mark`), no con píldoras redondeadas. */}
        <div className="flex gap-1" aria-hidden="true">
          {PASOS.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-0.5 flex-1 transition-colors duration-(--motion-base) ease-standard",
                i <= paso ? "bg-primary" : "bg-line-subtle",
              )}
            />
          ))}
        </div>

        <h2 className="font-heading flex items-center gap-2 text-[length:var(--rx-text-19)] leading-tight font-semibold tracking-[var(--rx-track-heading)] text-fg">
          <IconoPaso className="size-[18px] shrink-0 text-accent-text" aria-hidden="true" />
          {PASOS[paso].titulo}
        </h2>
      </header>

      {/* Los campos van al alto de fila del PORTAL (52px), la superficie a la
          que este seller está entrando. Estaban en 32px: densidad de backstage,
          bajo el objetivo táctil mínimo de 44px. */}
      <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 [&_input:not([type=checkbox])]:h-(--rx-row-portal)">
        {error ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* Los pasos entran con el mismo gesto que el resto del sistema
          (`empty-state.tsx`): el wizard era la unica superficie sin movimiento,
          y sin el los 4 pasos se sustituyen de golpe, sin senal de avance.
          `key={paso}` re-dispara la animacion en cada cambio; la duracion sale
          del token `--motion-base` y `motion-reduce` la anula. */}
      <div
        key={paso}
        className="animate-in fade-in-0 slide-in-from-right-2 ease-out [animation-duration:var(--motion-base)] motion-reduce:animate-none"
      >
        {/* ── Paso 0 · Empresa ── */}
      {paso === 0 ? (
        <form onSubmit={guardarEmpresa} noValidate className="space-y-4">

          <div className="space-y-1.5">
            <Label htmlFor="razonSocial">Razón social</Label>
            <Input
              id="razonSocial"
              autoFocus
              placeholder="Ej: Comercial Andes Limitada"
              value={razonSocial}
              onChange={(e) => setRazonSocial(e.target.value)}
              disabled={guardando}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rut">RUT</Label>
            <Input
              id="rut"
              inputMode="text"
              placeholder="12.345.678-9"
              value={rut}
              onChange={(e) => manejarCambioRut(e.target.value)}
              onBlur={validarRutAlPerderFoco}
              disabled={guardando}
              aria-invalid={Boolean(errorRut)}
              required
            />
            {errorRut ? <p className="text-sm text-destructive">{errorRut}</p> : null}
          </div>

          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              checked={aceptaDatos}
              onCheckedChange={(v) => setAceptaDatos(v === true)}
              disabled={guardando}
              className="mt-0.5"
            />
            <span>
              Acepto el tratamiento de mis datos según la{" "}
              <a href="/privacidad" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                política de privacidad
              </a>{" "}
              de Rutax.
            </span>
          </label>

          <Button type="submit" loading={guardando} disabled={!aceptaDatos} className="h-(--rx-row-portal) w-full">
            Continuar
          </Button>
        </form>
      ) : null}

      {/* ── Paso 1 · Contacto ── */}
      {paso === 1 ? (
        <form onSubmit={guardarContacto} noValidate className="space-y-4">

          <div className="space-y-1.5">
            <Label htmlFor="nombreContacto">Tu nombre</Label>
            <Input
              id="nombreContacto"
              autoFocus
              placeholder="Ej: María Pérez"
              value={nombreContacto}
              onChange={(e) => setNombreContacto(e.target.value)}
              disabled={guardando}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="telefonoContacto">Número de WhatsApp</Label>
            <Input
              id="telefonoContacto"
              type="tel"
              inputMode="tel"
              placeholder="+56 9 1234 5678"
              value={telefonoContacto}
              onChange={(e) => {
                setTelefonoContacto(e.target.value);
                setErrorTelefono(null);
              }}
              onBlur={normalizarWhatsappAlPerderFoco}
              disabled={guardando}
              aria-invalid={Boolean(errorTelefono)}
              required
            />
            {errorTelefono ? (
              <p className="text-xs text-destructive">{errorTelefono}</p>
            ) : (
              <p className="text-xs text-fg-subtle">
                A este número te avisamos cuando el conductor retira tus pedidos.
              </p>
            )}
          </div>

          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              checked={aceptaWhatsapp}
              onCheckedChange={(v) => setAceptaWhatsapp(v === true)}
              disabled={guardando}
              className="mt-0.5"
            />
            <span>
              Autorizo a que me avisen por este WhatsApp sobre el retiro de mis pedidos, según la{" "}
              <a href="/privacidad" target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                política de privacidad
              </a>
              .
            </span>
          </label>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => irA(0)} disabled={guardando} className="h-(--rx-row-portal)">
              Volver
            </Button>
            <Button
              type="submit"
              loading={guardando}
              disabled={!aceptaWhatsapp || Boolean(errorTelefono)}
              className="h-(--rx-row-portal) flex-1"
            >
              Continuar
            </Button>
          </div>
        </form>
      ) : null}

      {/* ── Paso 2 · Bodega ── */}
      {paso === 2 ? (
        <form onSubmit={guardarBodega} noValidate className="space-y-4">


          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="direccionBodega">Dirección</Label>
              <CampoDireccion
                id="direccionBodega"
                valor={direccionBodega}
                elegida={direccionBodegaElegida}
                placeholder="Calle y número"
                required
                onCambio={(v) => {
                  setDireccionBodega(v);
                  // Teclear tras haber elegido invalida la coordenada: ya no
                  // corresponde a lo que dice el campo.
                  if (direccionBodegaElegida) {
                    setDireccionBodegaElegida(false);
                    setLatBodega(null);
                    setLongBodega(null);
                  }
                }}
                onElegir={(d) => {
                  setDireccionBodega(d.direccionCorta ?? d.direccion);
                  // La comuna la llena la dirección elegida — pero solo si cae en
                  // el catálogo de la RM (el Select no acepta otra).
                  const comuna = comunaDelCatalogo(d.comuna);
                  if (comuna && (COMUNAS_RM as readonly string[]).includes(comuna)) {
                    setComunaBodega(comuna);
                  }
                  setLatBodega(d.lat);
                  setLongBodega(d.long);
                  setDireccionBodegaElegida(d.lat != null && d.long != null);
                }}
                buscar={sugerirDireccionSellerAction}
                resolver={resolverDireccionSellerAction}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comunaBodega">Comuna</Label>
              <Select
                value={comunaBodega}
                onValueChange={(v) => setComunaBodega(v)}
                disabled={guardando}
              >
                <SelectTrigger id="comunaBodega" className="w-full data-[size=default]:h-(--rx-row-portal)">
                  <SelectValue placeholder="Selecciona una comuna" />
                </SelectTrigger>
                <SelectContent>
                  {COMUNAS_RM.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="instruccionesBodega">Instrucciones de acceso (opcional)</Label>
            <Textarea
              id="instruccionesBodega"
              rows={2}
              placeholder="Portón lateral, timbre 2. Preguntar por Marcela."
              value={instruccionesBodega}
              onChange={(e) => setInstruccionesBodega(e.target.value)}
              disabled={guardando}
            />
            <p className="text-xs text-fg-subtle">
              Esto lo lee el conductor en su app. No va en la etiqueta del paquete.
            </p>
          </div>


          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => irA(1)} disabled={guardando} className="h-(--rx-row-portal)">
              Volver
            </Button>
            <Button type="submit" loading={guardando} className="h-(--rx-row-portal) flex-1">
              Continuar
            </Button>
          </div>
        </form>
      ) : null}

      {/* ── Paso 3 · Fuentes ── */}
      {paso === 3 ? (
        <form onSubmit={terminar} noValidate className="space-y-4">
          {/* "Podrás conectar la cuenta correspondiente después, desde tu portal" narraba
              mecánica interna: al seller, en este momento, no le sirve saber dónde se
              conecta después. Queda solo la restricción que gobierna el botón. */}
          <p className="text-sm leading-relaxed text-fg-muted">Elige al menos una.</p>

          <div className="space-y-2">
            {FUENTES_DECLARABLES.map((f) => {
              const fija = f === FUENTE_FIJA;
              return (
                <label
                  key={f}
                  className={cn(
                    // Alto de fila del portal y estado elegido con el par teñido
                    // del ADN (accent-deep + accent-line): antes las tres filas
                    // eran cajas idénticas a un input y no se leían elegibles.
                    "flex min-h-(--rx-row-portal) items-center gap-2.5 border px-3 text-sm",
                    "transition-colors duration-(--motion-fast) ease-standard",
                    (fija ? true : fuentes.includes(f))
                      ? "border-accent-line bg-accent-deep"
                      : "border-line hover:border-fg-muted",
                    fija ? "cursor-default" : "cursor-pointer",
                  )}
                >
                  <Checkbox
                    checked={fija ? true : fuentes.includes(f)}
                    onCheckedChange={() => alternarFuente(f)}
                    disabled={guardando || fija}
                  />
                  <span className={cn("font-medium", fija ? "text-fg-muted" : "text-fg")}>
                    {etiquetaFuentePedido(f)}
                  </span>
                  {fija ? <span className="ml-auto text-xs text-fg-subtle">Incluido</span> : null}
                </label>
              );
            })}
          </div>

          {errorFinal ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{errorFinal.mensaje}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => irA(2)} disabled={guardando} className="h-(--rx-row-portal)">
              Volver
            </Button>
            <Button type="submit" loading={guardando} className="h-(--rx-row-portal) flex-1">
              {!guardando && <CheckCircle2 className="size-4" aria-hidden="true" />}
              Terminar y activar mi cuenta
            </Button>
          </div>
        </form>
        ) : null}
        </div>
      </div>
    </div>
  );
}
