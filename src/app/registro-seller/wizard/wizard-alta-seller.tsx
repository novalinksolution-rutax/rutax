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
 * El geocoding de la bodega es SÍNCRONO en la Server Action — este componente
 * solo manda dirección + comuna y muestra lo que la acción devuelve
 * (`geoResuelta`), nunca llama a un proveedor de mapas por su cuenta.
 */

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  Check,
  CheckCircle2,
  Loader2,
  MapPin,
  Phone,
  ShieldAlert,
  TriangleAlert,
  Truck,
  User,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
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
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { etiquetaFuentePedido } from "@/lib/ui/etiqueta-fuente-pedido";
import { FUENTES_DECLARABLES } from "@/modules/identidad/alta-seller-autoservicio";
import type { EstadoWizardAltaSeller, FuenteWizardSeller } from "@/lib/identidad/borrador-wizard-seller";
import {
  finalizarAltaSellerAction,
  guardarPasoBodegaAction,
  guardarPasoContactoAction,
  guardarPasoEmpresaAction,
  guardarPasoFuentesAction,
  guardarPasoWhatsappAction,
} from "./actions";

const MENSAJE_RUT_INVALIDO = "El dígito verificador no corresponde a este RUT.";
const MENSAJE_RUT_FORMATO = "Ingresa el RUT con el formato 12.345.678-9.";

const TITULOS_PASO = ["Tu empresa", "Tu contacto", "Tu bodega", "WhatsApp de retiro", "Tus fuentes de pedidos"];

/** El paso por el que hay que abrir, según lo que ya esté guardado. */
function pasoInicial(estado: EstadoWizardAltaSeller): number {
  if (!estado.empresa) return 0;
  if (!estado.contacto) return 1;
  if (!estado.bodega) return 2;
  if (!estado.whatsapp) return 3;
  return 4;
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

  // ── Paso 1 · Contacto ─────────────────────────────────────────────────────
  const [nombreContacto, setNombreContacto] = useState(estadoInicial.contacto?.nombreContacto ?? "");
  const [telefonoContacto, setTelefonoContacto] = useState(estadoInicial.contacto?.telefono ?? "");

  // ── Paso 2 · Bodega ───────────────────────────────────────────────────────
  const [nombreBodega, setNombreBodega] = useState(estadoInicial.bodega?.nombre ?? "");
  const [direccionBodega, setDireccionBodega] = useState(estadoInicial.bodega?.direccion ?? "");
  const [comunaBodega, setComunaBodega] = useState(estadoInicial.bodega?.comuna ?? "");
  const [instruccionesBodega, setInstruccionesBodega] = useState(estadoInicial.bodega?.instruccionesAcceso ?? "");
  const [contactoNombreBodega, setContactoNombreBodega] = useState(estadoInicial.bodega?.contactoNombre ?? "");
  const [contactoTelefonoBodega, setContactoTelefonoBodega] = useState(
    estadoInicial.bodega?.contactoTelefono ?? "",
  );
  const [bodegaGuardada, setBodegaGuardada] = useState(Boolean(estadoInicial.bodega));
  const [geoResuelta, setGeoResuelta] = useState<boolean | null>(
    estadoInicial.bodega ? estadoInicial.bodega.geoEstado === "resuelto" : null,
  );

  // ── Paso 3 · WhatsApp ─────────────────────────────────────────────────────
  const [telefonoWhatsapp, setTelefonoWhatsapp] = useState(estadoInicial.whatsapp?.telefono ?? "");
  const [aceptaWhatsapp, setAceptaWhatsapp] = useState(estadoInicial.whatsapp?.acepta ?? false);

  // ── Paso 4 · Fuentes ──────────────────────────────────────────────────────
  const [fuentes, setFuentes] = useState<FuenteWizardSeller[]>(estadoInicial.fuentes ?? []);

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
      telefono: telefonoContacto || undefined,
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
      contactoNombre: contactoNombreBodega || undefined,
      contactoTelefono: contactoTelefonoBodega || undefined,
    });
    setGuardando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    setBodegaGuardada(true);
    setGeoResuelta(r.datos.geoResuelta);
  }

  function editarBodega() {
    setBodegaGuardada(false);
    setGeoResuelta(null);
  }

  async function guardarWhatsapp(e: FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setError(null);
    setGuardando(true);
    const r = await guardarPasoWhatsappAction({ telefono: telefonoWhatsapp, acepta: aceptaWhatsapp });
    setGuardando(false);
    if (!r.ok) {
      setError(r.mensaje);
      return;
    }
    irA(4);
  }

  function alternarFuente(f: FuenteWizardSeller) {
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

  const total = TITULOS_PASO.length;
  const porcentaje = Math.round(((paso + 1) / total) * 100);

  return (
    <div className="w-full max-w-xl space-y-5 border border-line bg-bg-raised p-6">
      <div className="space-y-2">
        <p className="text-sm text-fg-muted">
          Te estás sumando como seller de <span className="font-medium text-fg">{nombreFantasia}</span>.
        </p>
        <div className="space-y-1">
          <p className="rx-num flex items-baseline justify-between text-xs text-fg-muted">
            <span>
              Paso {paso + 1} de {total} · {TITULOS_PASO[paso]}
            </span>
            <span>{porcentaje}%</span>
          </p>
          <Progress value={porcentaje} />
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {/* ── Paso 0 · Empresa ── */}
      {paso === 0 ? (
        <form onSubmit={guardarEmpresa} noValidate className="space-y-4">
          <legend className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Building2 className="size-4" aria-hidden="true" />
            Los datos de tu empresa
          </legend>

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

          <Button type="submit" loading={guardando} disabled={!aceptaDatos} className="w-full">
            Continuar
          </Button>
        </form>
      ) : null}

      {/* ── Paso 1 · Contacto ── */}
      {paso === 1 ? (
        <form onSubmit={guardarContacto} noValidate className="space-y-4">
          <legend className="flex items-center gap-2 text-sm font-semibold text-fg">
            <User className="size-4" aria-hidden="true" />
            Tu contacto
          </legend>

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
            <Label htmlFor="telefonoContacto">Teléfono (opcional)</Label>
            <Input
              id="telefonoContacto"
              type="tel"
              placeholder="+56 9 1234 5678"
              value={telefonoContacto}
              onChange={(e) => setTelefonoContacto(e.target.value)}
              disabled={guardando}
            />
          </div>

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => irA(0)} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" loading={guardando} className="flex-1">
              Continuar
            </Button>
          </div>
        </form>
      ) : null}

      {/* ── Paso 2 · Bodega ── */}
      {paso === 2 ? (
        <form onSubmit={guardarBodega} noValidate className="space-y-4">
          <legend className="flex items-center gap-2 text-sm font-semibold text-fg">
            <MapPin className="size-4" aria-hidden="true" />
            Dónde retira el conductor
          </legend>

          <div className="space-y-1.5">
            <Label htmlFor="nombreBodega">Nombre de la bodega</Label>
            <Input
              id="nombreBodega"
              autoFocus
              placeholder="Ej: Bodega Quilicura"
              value={nombreBodega}
              onChange={(e) => {
                setNombreBodega(e.target.value);
                if (bodegaGuardada) editarBodega();
              }}
              disabled={guardando}
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="direccionBodega">Dirección</Label>
              <Input
                id="direccionBodega"
                placeholder="Calle y número"
                value={direccionBodega}
                onChange={(e) => {
                  setDireccionBodega(e.target.value);
                  if (bodegaGuardada) editarBodega();
                }}
                disabled={guardando}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comunaBodega">Comuna</Label>
              <Select
                value={comunaBodega}
                onValueChange={(v) => {
                  setComunaBodega(v);
                  if (bodegaGuardada) editarBodega();
                }}
                disabled={guardando}
              >
                <SelectTrigger id="comunaBodega" className="h-9 w-full">
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="contactoNombreBodega">A quién llamar (opcional)</Label>
              <Input
                id="contactoNombreBodega"
                placeholder="Nombre del jefe de bodega"
                value={contactoNombreBodega}
                onChange={(e) => setContactoNombreBodega(e.target.value)}
                disabled={guardando}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contactoTelefonoBodega">Su teléfono (opcional)</Label>
              <Input
                id="contactoTelefonoBodega"
                type="tel"
                placeholder="+56 9 1234 5678"
                value={contactoTelefonoBodega}
                onChange={(e) => setContactoTelefonoBodega(e.target.value)}
                disabled={guardando}
              />
            </div>
          </div>

          {bodegaGuardada && geoResuelta !== null ? (
            <Alert variant={geoResuelta ? "default" : undefined}>
              {geoResuelta ? <Check /> : <TriangleAlert />}
              <AlertDescription>
                {geoResuelta
                  ? "Ubicamos tu bodega correctamente."
                  : "No pudimos ubicar tu bodega en el mapa automáticamente. Igual quedó guardada — tu courier puede corregirla más adelante."}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => irA(1)} disabled={guardando}>
              Volver
            </Button>
            {bodegaGuardada ? (
              <Button type="button" className="flex-1" onClick={() => irA(3)} disabled={guardando}>
                Continuar
              </Button>
            ) : (
              <Button type="submit" loading={guardando} className="flex-1">
                Guardar y ubicar bodega
              </Button>
            )}
          </div>
        </form>
      ) : null}

      {/* ── Paso 3 · WhatsApp ── */}
      {paso === 3 ? (
        <form onSubmit={guardarWhatsapp} noValidate className="space-y-4">
          <legend className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Phone className="size-4" aria-hidden="true" />
            WhatsApp de retiro
          </legend>
          <p className="text-sm leading-relaxed text-fg-muted">
            A este número te avisamos cuando el conductor retira tus pedidos.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="telefonoWhatsapp">Número de WhatsApp</Label>
            <Input
              id="telefonoWhatsapp"
              type="tel"
              autoFocus
              placeholder="+56 9 1234 5678"
              value={telefonoWhatsapp}
              onChange={(e) => setTelefonoWhatsapp(e.target.value)}
              disabled={guardando}
              required
            />
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
            <Button type="button" variant="outline" onClick={() => irA(2)} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" loading={guardando} disabled={!aceptaWhatsapp} className="flex-1">
              Continuar
            </Button>
          </div>
        </form>
      ) : null}

      {/* ── Paso 4 · Fuentes ── */}
      {paso === 4 ? (
        <form onSubmit={terminar} noValidate className="space-y-4">
          <legend className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Truck className="size-4" aria-hidden="true" />
            De dónde vienen tus pedidos
          </legend>
          <p className="text-sm leading-relaxed text-fg-muted">
            Elige al menos una. Podrás conectar la cuenta correspondiente después, desde tu
            portal.
          </p>

          <div className="space-y-2">
            {FUENTES_DECLARABLES.map((f) => (
              <label
                key={f}
                className="flex cursor-pointer items-center gap-2.5 border border-line px-3 py-2.5 text-sm"
              >
                <Checkbox
                  checked={fuentes.includes(f)}
                  onCheckedChange={() => alternarFuente(f)}
                  disabled={guardando}
                />
                <span className="font-medium text-fg">{etiquetaFuentePedido(f)}</span>
              </label>
            ))}
          </div>

          {errorFinal ? (
            <Alert variant="destructive">
              <ShieldAlert />
              <AlertDescription>{errorFinal.mensaje}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => irA(3)} disabled={guardando}>
              Volver
            </Button>
            <Button type="submit" loading={guardando} className="flex-1">
              {guardando ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="size-4" aria-hidden="true" />
              )}
              Terminar y activar mi cuenta
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
