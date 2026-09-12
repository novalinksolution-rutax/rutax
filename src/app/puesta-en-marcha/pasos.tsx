"use client";

/**
 * Los ocho pasos del wizard de puesta en marcha. Una pregunta por pantalla,
 * diseño tipo app: poco texto, un solo foco, botón "Continuar" abajo.
 *
 * Cada paso REUSA la Server Action que ya valida y audita su dato. Al guardar
 * OK, llama `onListo()` y el wizard avanza. La navegación (atrás, progreso) la
 * lleva el wizard; acá vive solo el contenido y el guardado de cada paso.
 *
 * ⚠️ Tres acciones se importan desde `(tenant)/onboarding/…` y de
 * `(tenant)/configuracion/…`. Las de onboarding se moverán a un módulo estable
 * cuando se retire el asistente viejo (Fase 3 del plan de rediseño); hasta
 * entonces se importan de su ubicación actual.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BANCOS_CHILE } from "@/lib/ui/bancos-chile";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { enmascararRut, limpiarMascaraRut } from "@/lib/formato-cl";
import { esRutValido } from "@/modules/identidad/rut";

import {
  accionGuardarDatosEmisor,
  accionGuardarDatosCobro,
  accionGuardarContacto,
} from "@/app/(tenant)/onboarding/acciones-datos-courier";
import { accionFijarPeriodicidad } from "@/app/(tenant)/configuracion/tarifas/acciones-periodicidad";
import { accionGuardarConfigRetiro } from "@/app/(tenant)/configuracion/retiro/actions";
import { accionGuardarTarifaPlana, accionGuardarZonaCobertura } from "./actions";
import { SelectorComunas } from "./selector-comunas";
import type { DatosInicialesPaso } from "./tipos";

// -----------------------------------------------------------------------------
// Marco común de un paso
// -----------------------------------------------------------------------------

function MarcoPaso({
  titulo,
  descripcion,
  children,
  onSubmit,
  enviando,
  error,
  etiquetaBoton = "Continuar",
  botonDeshabilitado,
}: {
  titulo: string;
  descripcion?: string;
  children: React.ReactNode;
  onSubmit: () => void;
  enviando: boolean;
  error: string | null;
  etiquetaBoton?: string;
  botonDeshabilitado?: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-6"
    >
      <div className="space-y-1.5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">{titulo}</h2>
        {descripcion ? <p className="text-muted-foreground">{descripcion}</p> : null}
      </div>

      <div className="space-y-4">{children}</div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={enviando || botonDeshabilitado}>
        {enviando ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
        {etiquetaBoton}
      </Button>
    </form>
  );
}

type PropsPaso<K extends keyof DatosInicialesPaso> = {
  iniciales: DatosInicialesPaso[K];
  onListo: () => void;
};

// -----------------------------------------------------------------------------
// 1. Empresa
// -----------------------------------------------------------------------------

export function PasoEmpresa({ iniciales, onListo }: PropsPaso<"empresa">) {
  const [enviando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [rut, setRut] = useState(iniciales.rut ?? "");
  const [errorRut, setErrorRut] = useState<string | null>(null);
  const [comuna, setComuna] = useState(iniciales.comuna ?? "");
  const fantasiaProvisional = (iniciales.nombreFantasia ?? "").startsWith("Courier de ");
  const comunasOfrecidas = [...new Set([...COMUNAS_RM, ...(comuna ? [comuna] : [])])];

  function validarRut() {
    const limpio = limpiarMascaraRut(rut);
    if (!limpio) return;
    if (!/^[0-9]{1,8}-[0-9kK]$/.test(limpio)) {
      setErrorRut("Ingresa el RUT con el formato 12.345.678-9.");
      return;
    }
    if (!esRutValido(limpio)) setErrorRut("El dígito verificador no corresponde a este RUT.");
  }

  function guardar(form: HTMLFormElement) {
    const datos = new FormData(form);
    iniciar(async () => {
      const r = await accionGuardarDatosEmisor(datos);
      if (r.ok) onListo();
      else setError(r.mensaje);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        guardar(e.currentTarget);
      }}
      className="space-y-6"
    >
      <div className="space-y-1.5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Los datos de tu empresa</h2>
        <p className="text-muted-foreground">Van en cada factura que emitas. Los pide el SII.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pe-fantasia">Nombre de tu empresa</Label>
          <Input
            id="pe-fantasia"
            name="nombre_fantasia"
            required
            maxLength={120}
            defaultValue={fantasiaProvisional ? "" : (iniciales.nombreFantasia ?? "")}
            placeholder="Ej: Despachos del Centro"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe-razon">Razón social</Label>
          <Input
            id="pe-razon"
            name="razon_social"
            required
            maxLength={160}
            defaultValue={iniciales.razonSocial ?? ""}
            placeholder="Ej: Despachos del Centro SpA"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe-rut">RUT de la empresa</Label>
          <Input
            id="pe-rut"
            autoComplete="off"
            required
            placeholder="76.543.210-9"
            value={rut}
            onChange={(e) => {
              setRut(enmascararRut(e.target.value));
              setErrorRut(null);
            }}
            onBlur={validarRut}
            aria-invalid={errorRut ? true : undefined}
          />
          <input type="hidden" name="rut" value={limpiarMascaraRut(rut)} />
          {errorRut ? <p className="text-xs text-destructive">{errorRut}</p> : null}
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pe-giro">Giro</Label>
          <Input
            id="pe-giro"
            name="giro"
            required
            maxLength={80}
            defaultValue={iniciales.giro ?? ""}
            placeholder="Ej: Transporte de carga por carretera"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pe-direccion">Dirección de tu casa matriz</Label>
          <Input
            id="pe-direccion"
            name="direccion"
            required
            defaultValue={iniciales.direccion ?? ""}
            placeholder="Ej: Av. Providencia 1234, oficina 56"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe-comuna">Comuna</Label>
          <Select name="comuna" required value={comuna} onValueChange={setComuna}>
            <SelectTrigger id="pe-comuna" className="w-full">
              <SelectValue placeholder="Selecciona una comuna" />
            </SelectTrigger>
            <SelectContent>
              {comunasOfrecidas.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pe-actividad">Actividad económica</Label>
          <Input
            id="pe-actividad"
            name="actividad_economica"
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            defaultValue={iniciales.actividadEconomica ?? ""}
            placeholder="492300"
          />
          <p className="text-xs text-muted-foreground">Los 6 dígitos del código del SII.</p>
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={enviando}>
        {enviando ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
        Continuar
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// 2. Tarifa plana
// -----------------------------------------------------------------------------

export function PasoTarifa({ iniciales, onListo }: PropsPaso<"tarifa">) {
  const [enviando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cobro, setCobro] = useState(iniciales.cobroClp?.toString() ?? "");
  const [pago, setPago] = useState(iniciales.pagoConductorClp?.toString() ?? "");

  function guardar() {
    setError(null);
    const c = Number(cobro);
    const p = Number(pago);
    iniciar(async () => {
      const r = await accionGuardarTarifaPlana(c, p);
      if (r.ok) onListo();
      else setError(r.mensaje);
    });
  }

  return (
    <MarcoPaso
      titulo="Tu tarifa por entrega"
      descripcion="Una tarifa plana para partir. Después puedes afinarla por seller o por zona."
      onSubmit={guardar}
      enviando={enviando}
      error={error}
    >
      <div className="space-y-1.5">
        <Label htmlFor="pt-cobro">Cuánto le cobras al seller por entrega</Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
          <Input
            id="pt-cobro"
            inputMode="numeric"
            required
            className="pl-7"
            value={cobro}
            onChange={(e) => setCobro(e.target.value.replace(/\D/g, ""))}
            placeholder="2500"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pt-pago">Cuánto le pagas al conductor por entrega</Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
          <Input
            id="pt-pago"
            inputMode="numeric"
            required
            className="pl-7"
            value={pago}
            onChange={(e) => setPago(e.target.value.replace(/\D/g, ""))}
            placeholder="1500"
          />
        </div>
      </div>
    </MarcoPaso>
  );
}

// -----------------------------------------------------------------------------
// 3. Periodicidad
// -----------------------------------------------------------------------------

const OPCIONES_PERIODO: Array<{ valor: string; titulo: string; nota?: string }> = [
  { valor: "semanal", titulo: "Semanal", nota: "Lo más común" },
  { valor: "quincenal", titulo: "Quincenal" },
  { valor: "mensual", titulo: "Mensual" },
];

export function PasoPeriodicidad({ iniciales, onListo }: PropsPaso<"periodicidad">) {
  const [enviando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Semanal preseleccionada si no había elección explícita (recomendación UX).
  const [tipo, setTipo] = useState(iniciales.explicita ? iniciales.tipo : "semanal");

  function guardar() {
    setError(null);
    const datos = new FormData();
    datos.set("tipo_periodo", tipo);
    iniciar(async () => {
      const r = await accionFijarPeriodicidad(datos);
      if (r.ok) onListo();
      else setError(r.mensaje);
    });
  }

  return (
    <MarcoPaso
      titulo="¿Cada cuánto le facturas a tus sellers?"
      descripcion="Define el ritmo de tus cobros y de las liquidaciones a tus conductores."
      onSubmit={guardar}
      enviando={enviando}
      error={error}
    >
      <div className="grid gap-3">
        {OPCIONES_PERIODO.map((o) => {
          const activa = tipo === o.valor;
          return (
            <button
              key={o.valor}
              type="button"
              onClick={() => setTipo(o.valor)}
              aria-pressed={activa}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition-colors ${
                activa ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border hover:bg-muted"
              }`}
            >
              <span className="font-medium">{o.titulo}</span>
              {o.nota ? (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  {o.nota}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </MarcoPaso>
  );
}

// -----------------------------------------------------------------------------
// 4. Datos de cobro
// -----------------------------------------------------------------------------

export function PasoCobro({ iniciales, onListo }: PropsPaso<"cobro">) {
  const [enviando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [banco, setBanco] = useState(iniciales.banco ?? "");
  const [tipoCuenta, setTipoCuenta] = useState(iniciales.tipoCuenta ?? "");
  const [rutTitular, setRutTitular] = useState(iniciales.rutTitular ?? "");

  function guardar(form: HTMLFormElement) {
    const datos = new FormData(form);
    iniciar(async () => {
      const r = await accionGuardarDatosCobro(datos);
      if (r.ok) onListo();
      else setError(r.mensaje);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        guardar(e.currentTarget);
      }}
      className="space-y-6"
    >
      <div className="space-y-1.5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">¿Dónde te pagan?</h2>
        <p className="text-muted-foreground">La cuenta a la que tus sellers te transfieren.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="pc-banco">Banco</Label>
          <Select name="banco" required value={banco} onValueChange={setBanco}>
            <SelectTrigger id="pc-banco" className="w-full">
              <SelectValue placeholder="Elige tu banco" />
            </SelectTrigger>
            <SelectContent>
              {BANCOS_CHILE.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-tipo">Tipo de cuenta</Label>
          <Select name="tipo_cuenta" required value={tipoCuenta} onValueChange={setTipoCuenta}>
            <SelectTrigger id="pc-tipo" className="w-full">
              <SelectValue placeholder="Elige el tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="corriente">Cuenta corriente</SelectItem>
              <SelectItem value="vista">Cuenta vista</SelectItem>
              <SelectItem value="ahorro">Cuenta de ahorro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pc-numero">Número de cuenta</Label>
          <Input
            id="pc-numero"
            name="numero_cuenta"
            required
            inputMode="numeric"
            defaultValue={iniciales.numeroCuenta ?? ""}
            placeholder="000123456789"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-titular">Nombre del titular</Label>
          <Input
            id="pc-titular"
            name="nombre_titular"
            required
            defaultValue={iniciales.nombreTitular ?? ""}
            placeholder="Despachos del Centro SpA"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pc-rut">RUT del titular</Label>
          <Input
            id="pc-rut"
            autoComplete="off"
            required
            placeholder="76.543.210-9"
            value={rutTitular}
            onChange={(e) => setRutTitular(enmascararRut(e.target.value))}
          />
          <input type="hidden" name="rut_titular" value={limpiarMascaraRut(rutTitular)} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="pc-email">Correo para avisos (opcional)</Label>
          <Input
            id="pc-email"
            name="email_aviso"
            type="email"
            defaultValue={iniciales.emailAviso ?? ""}
            placeholder="pagos@tucourier.cl"
          />
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={enviando}>
        {enviando ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
        Continuar
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// 5. Pago por visita a bodega
// -----------------------------------------------------------------------------

export function PasoRetiro({ iniciales, onListo }: PropsPaso<"retiro">) {
  const [enviando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [monto, setMonto] = useState(iniciales.montoVisitaClp?.toString() ?? "");

  function guardar() {
    setError(null);
    const datos = new FormData();
    datos.set("monto_visita_bodega_clp", monto);
    iniciar(async () => {
      const r = await accionGuardarConfigRetiro(datos);
      if (r.ok) onListo();
      else setError(r.mensaje);
    });
  }

  return (
    <MarcoPaso
      titulo="Pago por visita a bodega"
      descripcion="Lo que le pagas al conductor cada vez que retira en la bodega de un seller."
      onSubmit={guardar}
      enviando={enviando}
      error={error}
    >
      <div className="space-y-1.5">
        <Label htmlFor="pr-monto">Monto por visita</Label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
          <Input
            id="pr-monto"
            inputMode="numeric"
            required
            className="pl-7"
            value={monto}
            onChange={(e) => setMonto(e.target.value.replace(/\D/g, ""))}
            placeholder="3000"
          />
        </div>
      </div>
    </MarcoPaso>
  );
}

// -----------------------------------------------------------------------------
// 6. Zonas (comunas de cobertura)
// -----------------------------------------------------------------------------

export function PasoZonas({ iniciales, onListo }: PropsPaso<"zonas">) {
  const [enviando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [comunas, setComunas] = useState<string[]>(iniciales.comunas);

  function guardar() {
    setError(null);
    iniciar(async () => {
      const r = await accionGuardarZonaCobertura(comunas);
      if (r.ok) onListo();
      else setError(r.mensaje);
    });
  }

  return (
    <MarcoPaso
      titulo="¿En qué comunas trabajas?"
      descripcion="Elige todas las comunas donde repartes. Es tu zona de cobertura."
      onSubmit={guardar}
      enviando={enviando}
      error={error}
      botonDeshabilitado={comunas.length === 0}
    >
      <SelectorComunas seleccionadas={comunas} onCambio={setComunas} />
    </MarcoPaso>
  );
}

// -----------------------------------------------------------------------------
// 7. Contacto operativo
// -----------------------------------------------------------------------------

export function PasoContacto({ iniciales, onListo }: PropsPaso<"contacto">) {
  const [enviando, iniciar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function guardar(form: HTMLFormElement) {
    const datos = new FormData(form);
    iniciar(async () => {
      const r = await accionGuardarContacto(datos);
      if (r.ok) onListo();
      else setError(r.mensaje);
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        guardar(e.currentTarget);
      }}
      className="space-y-6"
    >
      <div className="space-y-1.5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Tu contacto operativo</h2>
        <p className="text-muted-foreground">
          Lo verá quien esté esperando un paquete. Deja al menos uno.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="pco-tel">Teléfono</Label>
          <Input
            id="pco-tel"
            name="telefono_contacto"
            type="tel"
            defaultValue={iniciales.telefono ?? ""}
            placeholder="+56 9 1234 5678"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pco-email">Correo</Label>
          <Input
            id="pco-email"
            name="email_contacto"
            type="email"
            defaultValue={iniciales.email ?? ""}
            placeholder="contacto@tucourier.cl"
          />
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={enviando}>
        {enviando ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
        Continuar
      </Button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// 8. Invitar equipo (saltable)
// -----------------------------------------------------------------------------

export function PasoEquipo({ iniciales, onListo }: PropsPaso<"equipo">) {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h2 className="font-heading text-2xl font-semibold tracking-tight">Suma a tu equipo</h2>
        <p className="text-muted-foreground">
          Invita a tus sellers y carga tus conductores. Puedes hacerlo ahora o más tarde.
        </p>
      </div>

      <div className="grid gap-3">
        <Link
          href="/sellers"
          className="flex items-center justify-between rounded-lg border border-border px-4 py-3 hover:bg-muted"
        >
          <span>
            <span className="block font-medium">Invitar sellers</span>
            <span className="text-sm text-muted-foreground">
              {iniciales.sellers > 0 ? `${iniciales.sellers} ya invitados` : "Ninguno todavía"}
            </span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/conductores"
          className="flex items-center justify-between rounded-lg border border-border px-4 py-3 hover:bg-muted"
        >
          <span>
            <span className="block font-medium">Cargar conductores</span>
            <span className="text-sm text-muted-foreground">
              {iniciales.conductores > 0 ? `${iniciales.conductores} ya cargados` : "Ninguno todavía"}
            </span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>

      <Button type="button" size="lg" className="w-full" onClick={onListo}>
        Terminar la puesta en marcha
      </Button>
    </div>
  );
}
