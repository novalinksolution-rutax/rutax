"use client";

/**
 * El formulario de alta same-day — cuatro grupos, avisos en línea, dos salidas.
 *
 * -----------------------------------------------------------------------------
 * EL PATRÓN QUE DA NOMBRE A ESTA PANTALLA
 * -----------------------------------------------------------------------------
 * Regla nº 5 del bloque: **«un aviso que no bloquea vive pegado al campo que lo
 * provoca, con su alternativa como acción.»**
 *
 * Los dos avisos —fuera de hora de corte, y seller sin tarifa— ya se sabían
 * dentro de `crearPedidoSameDay`, pero ahí llegan **después de enviar**: el
 * courier escribió el formulario entero antes de enterarse, y en el caso de la
 * tarifa el pedido ni siquiera se creaba. Ahora se resuelven **al elegir el
 * seller**, viven pegados a su campo, no impiden guardar, y el de corte trae su
 * alternativa como botón.
 *
 * -----------------------------------------------------------------------------
 * EL ORDEN DE LOS GRUPOS NO ES ESTÉTICO
 * -----------------------------------------------------------------------------
 * `DE QUIÉN ES` va primero porque de ahí cuelgan los dos avisos: elegir el
 * seller es lo que permite decirle al courier, antes de que escriba nada más,
 * que va a salir mañana o que esa entrega no se podrá cobrar. El formulario
 * viejo lo tenía **último**, dentro de un grupo llamado «Facturación», así que
 * las dos advertencias solo podían llegar al final.
 *
 * -----------------------------------------------------------------------------
 * LA VALIDACIÓN APARECE AL SALIR DEL CAMPO, NO MIENTRAS SE ESCRIBE
 * -----------------------------------------------------------------------------
 * Marcar en rojo un teléfono a medio escribir es acusar a alguien de un error
 * que todavía no cometió. Se valida en `blur` y se limpia al volver a escribir.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CampoDireccion } from "@/components/ui/campo-direccion";
import { COMUNAS_RM } from "@/lib/ui/comunas-rm";
import { hoyEnSantiago, sumarDiasCalendario } from "@/lib/fecha-santiago";
import { formatearHora } from "@/lib/formato-cl";
import { comunaDelCatalogo, esMovilChileno, superaHoraDeCorte } from "./reglas-alta";
import {
  actionCrearSameDay,
  actionEstadoSellerParaAlta,
  actionResolverDireccion,
  actionSugerirDirecciones,
  type EstadoSellerParaAlta,
} from "./actions";

interface SellerOpcion {
  id: string;
  nombre: string;
}

const ESTADO_VACIO = {
  sellerId: "",
  destinatarioNombre: "",
  destinatarioDireccion: "",
  destinatarioComuna: "",
  destinatarioTelefono: "",
  instruccionesEntrega: "",
  fechaCompromiso: "",
};

interface Exito {
  pedidoId: string;
  codigo: string | null;
  destinatario: string;
  avisoCorte: string | null;
}

export function FormularioAltaSameDay({ sellers }: { sellers: SellerOpcion[] }) {
  const router = useRouter();
  const [campos, setCampos] = useState({ ...ESTADO_VACIO });
  const [direccionElegida, setDireccionElegida] = useState(false);
  const [coordenada, setCoordenada] = useState<{
    lat: number | null;
    long: number | null;
    comunaResuelta: string | null;
  }>({ lat: null, long: null, comunaResuelta: null });

  const [estadoSeller, setEstadoSeller] = useState<EstadoSellerParaAlta | null>(null);
  const [errorTelefono, setErrorTelefono] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const [exito, setExito] = useState<Exito | null>(null);
  const [pendiente, iniciar] = useTransition();

  const hoy = hoyEnSantiago();
  const manana = sumarDiasCalendario(hoy, 1);
  const nombreSeller = sellers.find((s) => s.id === campos.sellerId)?.nombre ?? "";

  // El aviso de corte solo tiene sentido si el pedido es para HOY: reagendado
  // para mañana, la hora de corte de hoy ya no dice nada.
  const paraHoy = campos.fechaCompromiso === "" || campos.fechaCompromiso === hoy;
  const fueraDeCorte =
    paraHoy &&
    estadoSeller?.horaCorte != null &&
    // La hora se toma del reloj de Santiago, no del navegador: el coordinador
    // puede estar en otra zona y el corte es del courier.
    superaHoraDeCorte(formatearHora(new Date()), estadoSeller.horaCorte);

  function set<K extends keyof typeof campos>(clave: K, valor: string) {
    setCampos((c) => ({ ...c, [clave]: valor }));
  }

  function alElegirSeller(sellerId: string) {
    set("sellerId", sellerId);
    setEstadoSeller(null);
    iniciar(async () => {
      setEstadoSeller(await actionEstadoSellerParaAlta(sellerId));
    });
  }

  function enviar(seguirCreando: boolean) {
    setErrorEnvio(null);
    iniciar(async () => {
      const r = await actionCrearSameDay({
        sellerId: campos.sellerId,
        destinatarioNombre: campos.destinatarioNombre,
        destinatarioDireccion: campos.destinatarioDireccion,
        destinatarioComuna: campos.destinatarioComuna,
        destinatarioTelefono: campos.destinatarioTelefono || undefined,
        instruccionesEntrega: campos.instruccionesEntrega || undefined,
        fechaCompromiso: campos.fechaCompromiso || undefined,
        lat: coordenada.lat,
        long: coordenada.long,
        comunaResuelta: coordenada.comunaResuelta,
      });

      if (!r.ok) {
        setErrorEnvio(r.mensaje);
        return;
      }

      if (seguirCreando) {
        // «Crear y agregar otro», porque en bodega se crean tres seguidos. Se
        // conserva el seller: los tres suelen ser del mismo.
        const seller = campos.sellerId;
        setCampos({ ...ESTADO_VACIO, sellerId: seller });
        setDireccionElegida(false);
        setCoordenada({ lat: null, long: null, comunaResuelta: null });
        setExito(r);
        return;
      }

      setExito(r);
    });
  }

  const listo =
    campos.sellerId !== "" &&
    campos.destinatarioNombre.trim() !== "" &&
    campos.destinatarioDireccion.trim() !== "" &&
    campos.destinatarioComuna !== "" &&
    errorTelefono === null;

  if (exito && !pendiente) {
    return (
      <BloqueExito
        exito={exito}
        onCrearOtro={() => setExito(null)}
        onVolver={() => router.push("/operaciones")}
      />
    );
  }

  return (
    <form
      className="max-w-3xl space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        enviar(false);
      }}
    >
      {/* ------------------------------------------------------------------
          DE QUIÉN ES — primero, porque de acá cuelgan los dos avisos.
          ------------------------------------------------------------------ */}
      <Grupo titulo="De quién es">
        <div className="space-y-1.5">
          <Label htmlFor="seller">Seller</Label>
          <Select value={campos.sellerId} onValueChange={alElegirSeller}>
            <SelectTrigger id="seller" className="h-[52px] w-full">
              <SelectValue placeholder="Elige el seller" />
            </SelectTrigger>
            <SelectContent>
              {sellers.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {estadoSeller && !estadoSeller.tieneTarifa ? (
            <AvisoEnLinea tono="fault">
              {nombreSeller} no tiene tarifa vigente:{" "}
              <strong className="font-medium">esta entrega no se podría cobrar.</strong> Puedes
              crearla igual y cargar la tarifa después.
            </AvisoEnLinea>
          ) : null}
        </div>
      </Grupo>

      {/* ------------------------------------------------------------------
          A DÓNDE VA
          ------------------------------------------------------------------ */}
      <Grupo titulo="A dónde va" dosColumnas>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="destinatario">Destinatario</Label>
          <Input
            id="destinatario"
            className="h-[52px]"
            value={campos.destinatarioNombre}
            onChange={(e) => set("destinatarioNombre", e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="direccion">Dirección</Label>
          <CampoDireccion
            id="direccion"
            valor={campos.destinatarioDireccion}
            elegida={direccionElegida}
            placeholder="Av. Providencia 1234, depto 52"
            required
            onCambio={(v) => {
              set("destinatarioDireccion", v);
              // Escribir después de haber elegido invalida la coordenada: ya no
              // corresponde a lo que dice el campo.
              if (direccionElegida) {
                setDireccionElegida(false);
                setCoordenada({ lat: null, long: null, comunaResuelta: null });
              }
            }}
            onElegir={(d) => {
              setCampos((c) => ({
                ...c,
                destinatarioDireccion: d.direccion,
                // La comuna la llena la dirección elegida: es el dato que más
                // se escribía mal a mano.
                destinatarioComuna: comunaDelCatalogo(d.comuna) ?? c.destinatarioComuna,
              }));
              setCoordenada({ lat: d.lat, long: d.long, comunaResuelta: d.comuna });
              setDireccionElegida(d.lat != null && d.long != null);
            }}
            buscar={actionSugerirDirecciones}
            resolver={actionResolverDireccion}
            ayuda="Escribe y elige de la lista: así queda ubicada al instante, con su comuna. Si la escribes a mano, la ubicamos después y el pedido puede quedar «por revisar»."
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="comuna">Comuna</Label>
          <Select
            value={campos.destinatarioComuna}
            onValueChange={(v) => set("destinatarioComuna", v)}
          >
            <SelectTrigger id="comuna" className="h-[52px] w-full">
              <SelectValue placeholder="Elige la comuna" />
            </SelectTrigger>
            <SelectContent>
              {COMUNAS_RM.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-fg-muted">
            Elige una de la lista: escribirla a mano no ubica la dirección.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="telefono">Teléfono</Label>
          <Input
            id="telefono"
            type="tel"
            className="h-[52px]"
            value={campos.destinatarioTelefono}
            placeholder="+56 9 1234 5678"
            onChange={(e) => {
              set("destinatarioTelefono", e.target.value);
              // Se limpia al escribir: el error se dice al salir, no mientras
              // todavía se está escribiendo.
              if (errorTelefono) setErrorTelefono(null);
            }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              setErrorTelefono(
                esMovilChileno(v)
                  ? null
                  : "El teléfono tiene que ser un móvil chileno: +56 9 y ocho dígitos.",
              );
            }}
            aria-invalid={errorTelefono ? true : undefined}
          />
          {errorTelefono ? (
            <p className="text-xs text-fault-fg">{errorTelefono}</p>
          ) : (
            <p className="text-xs text-fg-muted">
              Opcional. Sirve para avisar al destinatario cuando el conductor va en camino.
            </p>
          )}
        </div>
      </Grupo>

      {/* ------------------------------------------------------------------
          CUÁNDO — con el aviso de corte pegado al campo.
          ------------------------------------------------------------------ */}
      <Grupo titulo="Cuándo">
        <div className="space-y-1.5">
          <Label htmlFor="fecha">Fecha de compromiso</Label>
          <Input
            id="fecha"
            type="date"
            className="h-[52px] w-full sm:w-56"
            value={campos.fechaCompromiso}
            min={hoy}
            onChange={(e) => set("fechaCompromiso", e.target.value)}
          />
          <p className="text-xs text-fg-muted">Si la dejas vacía, se entrega hoy.</p>

          {fueraDeCorte ? (
            <AvisoEnLinea tono="attention" icono={<Clock className="size-4" aria-hidden="true" />}>
              <span className="block">
                Estás creando este pedido pasada la hora de corte de {nombreSeller} (
                {estadoSeller?.horaCorte}). Se va a crear igual y sale mañana; también puedes
                reagendarlo.
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => set("fechaCompromiso", manana)}
              >
                Reagendar para mañana
              </Button>
            </AvisoEnLinea>
          ) : null}
        </div>
      </Grupo>

      {/* ------------------------------------------------------------------
          OPCIONAL
          ------------------------------------------------------------------ */}
      <Grupo titulo="Opcional">
        <div className="space-y-1.5">
          <Label htmlFor="instrucciones">Instrucciones de entrega</Label>
          <Textarea
            id="instrucciones"
            rows={3}
            value={campos.instruccionesEntrega}
            onChange={(e) => set("instruccionesEntrega", e.target.value)}
          />
          <p className="text-xs text-fg-muted">Las ve el conductor en su parada.</p>
        </div>
      </Grupo>

      {errorEnvio ? <AvisoEnLinea tono="fault">{errorEnvio}</AvisoEnLinea> : null}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button type="submit" disabled={!listo || pendiente}>
          {pendiente ? "Creando el pedido…" : "Crear el pedido"}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!listo || pendiente}
          onClick={() => enviar(true)}
        >
          Crear y agregar otro
        </Button>
        <Button type="button" variant="ghost" asChild>
          <Link href="/operaciones">Volver</Link>
        </Button>
      </div>
    </form>
  );
}

// =============================================================================
// Piezas
// =============================================================================

/**
 * Un grupo con su rótulo en mono. Dos columnas desde `sm`, **nunca tres**: el
 * formulario se lee en Z y con tres el ojo pierde el orden de los campos.
 */
function Grupo({
  titulo,
  dosColumnas,
  children,
}: {
  titulo: string;
  dosColumnas?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="rx-num text-[10px] font-medium tracking-[0.14em] text-fg-muted uppercase">
        {titulo}
      </h2>
      <div className={dosColumnas ? "grid gap-4 sm:grid-cols-2" : "space-y-4"}>{children}</div>
    </section>
  );
}

function AvisoEnLinea({
  tono,
  icono,
  children,
}: {
  tono: "attention" | "fault";
  icono?: React.ReactNode;
  children: React.ReactNode;
}) {
  const clases =
    tono === "fault"
      ? "border-fault-line bg-fault-bg text-fault-fg"
      : "border-attention-line bg-attention-bg text-attention-fg";
  return (
    <div className={`mt-2 flex gap-2 border p-3 text-xs leading-relaxed ${clases}`} role="status">
      <span className="mt-px shrink-0">
        {icono ?? <AlertTriangle className="size-4" aria-hidden="true" />}
      </span>
      <div>{children}</div>
    </div>
  );
}

function BloqueExito({
  exito,
  onCrearOtro,
  onVolver,
}: {
  exito: Exito;
  onCrearOtro: () => void;
  onVolver: () => void;
}) {
  return (
    <div className="max-w-2xl border border-balanced-line bg-balanced-bg p-5">
      <div className="flex items-center gap-2 text-balanced-fg">
        <Check className="size-5" aria-hidden="true" />
        <span className="text-[10px] font-medium tracking-[0.14em] uppercase">Pedido creado</span>
      </div>

      {/* El código va PRIMERO y en mono: es lo que se dicta por teléfono. */}
      <p className="mt-3 text-lg leading-snug text-fg">
        Creaste el pedido{" "}
        <strong className="rx-num font-semibold">{exito.codigo ?? "sin código"}</strong> para{" "}
        {exito.destinatario}.
      </p>

      {exito.avisoCorte ? (
        <p className="mt-2 text-sm leading-relaxed text-attention-fg">{exito.avisoCorte}</p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/operaciones/${exito.pedidoId}`}>Ver el pedido</Link>
        </Button>
        <Button variant="outline" onClick={onCrearOtro}>
          Crear otro
        </Button>
        <Button variant="ghost" onClick={onVolver}>
          Ir a pedidos
        </Button>
      </div>
    </div>
  );
}
