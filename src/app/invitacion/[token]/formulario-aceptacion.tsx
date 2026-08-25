"use client";

/**
 * La invitación aceptada: los dos formularios.
 * =============================================================================
 *
 * Pantallas C (primer login del dueño) y J (aceptación de invitación interna /
 * seller / conductor) — comparten estructura porque usan el MISMO mecanismo de
 * token (`aceptarInvitacion`). Dos variantes según si la persona ya tiene
 * cuenta (criterio §2.2 del documento de UX):
 *
 * · **persona nueva** — define su contraseña;
 * · **persona existente** — solo confirma. Nunca se le pide un dato que el
 *   sistema ya tiene (criterio transversal #4).
 *
 * -----------------------------------------------------------------------------
 * LOS CINCO FINALES DE ERROR YA NO ESTÁN ACÁ
 * -----------------------------------------------------------------------------
 * Vivían en este archivo, dentro del componente de cliente, así que **todo el
 * que iba a ver un mensaje de tres líneas se bajaba igual este formulario
 * entero** — tres campos, medidor de fortaleza y dos acciones de servidor. Ahora
 * son `estados-finales.tsx`, servidor puro, y la página elige antes de mandar
 * nada al navegador.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ EL CONDUCTOR NO DEFINE UNA CONTRASEÑA: DEFINE UN PIN DE 6 DÍGITOS
 * -----------------------------------------------------------------------------
 * Es la misma pantalla con otro campo, y el motivo está en la app: **el conductor
 * escribe con guantes, de pie, en una bodega**, y abre la app treinta veces al
 * día. Una contraseña ahí es una llamada a su coordinador a las 15:50 el día que
 * la olvide.
 *
 * El PIN **es** la contraseña de Supabase —seis dígitos son válidos como
 * contraseña— así que no hay credencial paralela ni nada nuevo que guardar.
 *
 * Antes esta pantalla le hacía inventar una contraseña de 8 caracteres **que
 * después no usaba nunca**, porque la app entraba por otro camino. Ese absurdo se
 * termina acá.
 *
 * La barrera de verdad está en la Server Action, que lee el rol **de la
 * invitación** y no del formulario: un formulario se salta.
 *
 * -----------------------------------------------------------------------------
 * EL MEDIDOR DE FORTALEZA DICE QUÉ FALTA, NO SOLO CUÁNTO HAY
 * -----------------------------------------------------------------------------
 * «Débil» a secas deja a la persona probando cosas al azar. Cada tramo nombra el
 * cambio concreto que sube el siguiente escalón, que es lo único que se puede
 * accionar sin adivinar.
 */

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import type { Rol } from "@/modules/identidad/roles";
import { LARGO_PIN, rechazarPin, soloDigitosPin, TEXTO_RECHAZO } from "@/modules/identidad/pin-conductor";

import {
  aceptarInvitacionComoPersonaExistente,
  aceptarInvitacionComoPersonaNueva,
  type EstadoInvitacionPublica,
} from "./actions";

type InvitacionValida = Extract<EstadoInvitacionPublica, { estado: "valida" }>;

const NOMBRES_ROL: Record<Rol, string> = {
  dueno: "dueño",
  supervisor: "supervisor",
  coordinador: "coordinador de tráfico",
  administracion: "administración",
  conductor: "conductor",
  seller: "seller",
  super_admin: "administrador de plataforma",
};

export function FormularioAceptacion({
  token,
  info,
  esPrimerDueno,
}: {
  token: string;
  info: InvitacionValida;
  /** La invitación es la del primer dueño de un tenant recién creado (Pantalla C). */
  esPrimerDueno: boolean;
}) {
  return info.variante === "persona_nueva" ? (
    <FormularioDefinirContrasena token={token} info={info} esPrimerDueno={esPrimerDueno} />
  ) : (
    <FormularioConfirmarAceptacion token={token} info={info} />
  );
}

/** El marco de los dos formularios. Sin sombra y con el radio del sistema (regla 4). */
function Tarjeta({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-sm border border-line bg-bg-raised p-6">{children}</div>;
}

// -----------------------------------------------------------------------------
// Variante "persona nueva" — define su contraseña (Pantalla C / J caso 1)
// -----------------------------------------------------------------------------

function FormularioDefinirContrasena({
  token,
  info,
  esPrimerDueno,
}: {
  token: string;
  info: InvitacionValida;
  esPrimerDueno: boolean;
}) {
  const router = useRouter();
  const idBase = useId();

  // El conductor pone un PIN; el resto del equipo, una contraseña. Es el mismo
  // par de campos con otras reglas, así que comparten estado.
  const esConductor = info.rol === "conductor";
  // El rol viene de la INVITACION, resuelta en el servidor: no es algo que el
  // formulario pueda torcer. Solo un seller representa a alguien a quien Rutax
  // le manda avisos de retiro.
  const esSeller = info.rol === "seller";
  const [nombreCompleto, setNombreCompleto] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [errores, setErrores] = useState<{
    nombre?: string;
    contrasena?: string;
    confirmacion?: string;
  }>({});
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [telefonoWhatsApp, setTelefonoWhatsApp] = useState("");
  const [aceptaWhatsApp, setAceptaWhatsApp] = useState(false);

  const fortaleza = calcularFortaleza(contrasena);

  function validar(): boolean {
    const nuevos: typeof errores = {};
    if (!nombreCompleto.trim()) nuevos.nombre = "Necesitamos tu nombre para saber con quién habla tu equipo.";
    if (esConductor) {
      const problema = rechazarPin(contrasena);
      if (problema) nuevos.contrasena = TEXTO_RECHAZO[problema];
      if (contrasena !== confirmacion) nuevos.confirmacion = "Los dos PIN no coinciden.";
    } else {
      if (contrasena.length < 8) nuevos.contrasena = "Tiene que tener al menos 8 caracteres.";
      if (contrasena !== confirmacion) nuevos.confirmacion = "Las dos no coinciden.";
    }
    setErrores(nuevos);
    return Object.keys(nuevos).length === 0;
  }

  async function manejarEnvio(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (enviando) return;
    setErrorServidor(null);
    if (!validar()) return;

    setEnviando(true);
    try {
      const resultado = await aceptarInvitacionComoPersonaNueva({
        token,
        nombreCompleto,
        contrasena,
        telefonoWhatsApp: esSeller ? telefonoWhatsApp : undefined,
        aceptaWhatsApp: esSeller ? aceptaWhatsApp : undefined,
      });
      if (resultado.ok) {
        router.push("/login?activada=1");
        return;
      }
      setErrorServidor(resultado.mensaje);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Tarjeta>
      <h1 className="font-heading text-xl leading-tight font-semibold">
        {esPrimerDueno
          ? `Activa ${info.nombreTenant}`
          : esConductor
            ? "Elige tu PIN"
            : "Crea tu contraseña"}
      </h1>
      {/* Quién invitó y para qué: sin esto, alguien que recibe el correo dos
          días después no sabe de qué empresa le están hablando. */}
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
        {esPrimerDueno ? (
          <>Estás a un paso. Define tu contraseña y la cuenta queda operativa.</>
        ) : (
          <>
            <span className="font-medium text-fg">{info.nombreTenant}</span> te invitó como{" "}
            {NOMBRES_ROL[info.rol]}.{" "}
            {esConductor ? "Elige tu PIN para entrar a la app." : "Define tu contraseña para entrar."}
          </>
        )}
      </p>
      {/* El correo se muestra y **no se puede editar**: la invitación está atada
          a él, así que un campo editable sería una promesa falsa. */}
      <p className="rx-num mt-3 border border-line-subtle bg-bg-inset px-3 py-2 text-sm text-fg-muted">
        {info.email}
      </p>

      <form onSubmit={manejarEnvio} noValidate className="mt-5 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-nombre`}>Tu nombre completo</Label>
          <Input
            id={`${idBase}-nombre`}
            autoFocus
            value={nombreCompleto}
            onChange={(e) => {
              setNombreCompleto(e.target.value);
              setErrores((a) => ({ ...a, nombre: undefined }));
            }}
            aria-invalid={Boolean(errores.nombre)}
            aria-describedby={errores.nombre ? `${idBase}-nombre-error` : undefined}
            className={errores.nombre ? "border-fault-line" : undefined}
          />
          {errores.nombre ? (
            <p id={`${idBase}-nombre-error`} className="text-sm text-fault-fg">
              {errores.nombre}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-contrasena`}>{esConductor ? "Tu PIN" : "Contraseña"}</Label>
          {/* Se dice para qué sirve ANTES de que lo elija. Sin esto, el conductor
              inventa seis números al azar y a las 16:00, en la bodega, no se
              acuerda de ninguno. */}
          {esConductor ? (
            <p className="text-sm text-fg-muted">
              6 números. Son los que vas a escribir en la app para entrar a tu ruta, así que elige
              unos que puedas recordar.
            </p>
          ) : null}
          <Input
            id={`${idBase}-contrasena`}
            type="password"
            inputMode={esConductor ? "numeric" : undefined}
            autoComplete={esConductor ? "off" : "new-password"}
            maxLength={esConductor ? LARGO_PIN : undefined}
            value={contrasena}
            onChange={(e) => {
              setContrasena(esConductor ? soloDigitosPin(e.target.value) : e.target.value);
              setErrores((a) => ({ ...a, contrasena: undefined }));
            }}
            aria-invalid={Boolean(errores.contrasena)}
            aria-describedby={errores.contrasena ? `${idBase}-contrasena-error` : undefined}
            className={errores.contrasena ? "border-fault-line" : undefined}
          />
          {contrasena && !esConductor ? (
            <div className="space-y-1 pt-0.5">
              {/* Cuatro tramos rectos, sin radio: es el mismo lenguaje de las
                  barras del resto del producto. */}
              <div className="flex h-1 gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={`h-full flex-1 ${i < fortaleza.nivel ? fortaleza.clase : "bg-line"}`}
                  />
                ))}
              </div>
              <p className="text-sm text-fg-muted" aria-live="polite">
                {fortaleza.etiqueta}
              </p>
            </div>
          ) : null}
          {errores.contrasena ? (
            <p id={`${idBase}-contrasena-error`} className="text-sm text-fault-fg">
              {errores.contrasena}
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${idBase}-confirmacion`}>{esConductor ? "Repite tu PIN" : "Repítela"}</Label>
          <Input
            id={`${idBase}-confirmacion`}
            type="password"
            inputMode={esConductor ? "numeric" : undefined}
            autoComplete={esConductor ? "off" : "new-password"}
            maxLength={esConductor ? LARGO_PIN : undefined}
            value={confirmacion}
            onChange={(e) => {
              setConfirmacion(esConductor ? soloDigitosPin(e.target.value) : e.target.value);
              setErrores((a) => ({ ...a, confirmacion: undefined }));
            }}
            aria-invalid={Boolean(errores.confirmacion)}
            aria-describedby={errores.confirmacion ? `${idBase}-confirmacion-error` : undefined}
            className={errores.confirmacion ? "border-fault-line" : undefined}
          />
          {errores.confirmacion ? (
            <p id={`${idBase}-confirmacion-error`} className="text-sm text-fault-fg">
              {errores.confirmacion}
            </p>
          ) : null}
        </div>

        {/*
          El WhatsApp del seller, y su consentimiento.

          Va acá y no en el formulario del courier porque **el permiso lo tiene
          que dar el interesado**. Hasta el 2026-08-25 era el courier quien
          afirmaba que otra empresa había aceptado recibir mensajes; esto lo
          reemplaza por la firma de quien decide.

          Es OPCIONAL: quien no quiera dar su número activa igual su cuenta y lo
          pone después en «Mi perfil». Pedirlo obligatorio convertiría un
          consentimiento en un peaje, que es lo contrario de un consentimiento.
        */}
        {esSeller ? (
          <div className="space-y-3 rounded-md border border-border bg-bg-subtle p-3">
            <div className="space-y-2">
              <Label htmlFor={`${idBase}-whatsapp`}>
                Tu WhatsApp <span className="font-normal text-fg-muted">(opcional)</span>
              </Label>
              <Input
                id={`${idBase}-whatsapp`}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+56 9 1234 5678"
                value={telefonoWhatsApp}
                onChange={(e) => setTelefonoWhatsApp(e.target.value)}
              />
              <p className="text-sm text-fg-muted">
                Para avisarte cuando retiremos pedidos desde tu bodega.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id={`${idBase}-acepta-whatsapp`}
                checked={aceptaWhatsApp}
                onCheckedChange={(v) => setAceptaWhatsApp(v === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor={`${idBase}-acepta-whatsapp`}
                className="cursor-pointer text-sm font-normal leading-relaxed"
              >
                Acepto recibir avisos de mis entregas por WhatsApp. Puedo darme de baja
                respondiendo <span className="font-medium">BAJA</span> en cualquier momento.
              </Label>
            </div>
          </div>
        ) : null}

        {/* Embebido y persistente, no una notificación temporal: si se va sola,
            quien estaba escribiendo la contraseña no alcanza a leerla. */}
        {errorServidor ? (
          <Alert variant="destructive">
            <AlertDescription>{errorServidor}</AlertDescription>
          </Alert>
        ) : null}

        <Button type="submit" className="w-full" disabled={enviando}>
          {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {enviando ? "Activando tu cuenta…" : esConductor ? "Guardar mi PIN" : "Crear contraseña y entrar"}
        </Button>
      </form>
    </Tarjeta>
  );
}

/**
 * El medidor de fortaleza.
 *
 * Cada etiqueta nombra **el cambio que sube el siguiente escalón**. «Débil» a
 * secas manda a probar al azar; «agrégale un número o un símbolo» se puede hacer.
 */
function calcularFortaleza(valor: string): { nivel: number; etiqueta: string; clase: string } {
  const largaDeVerdad = valor.length >= 12;
  const mezclaCaja = /[A-Z]/.test(valor) && /[a-z]/.test(valor);
  const tieneSimbolo = /[0-9]/.test(valor) || /[^A-Za-z0-9]/.test(valor);

  let puntos = 0;
  if (valor.length >= 8) puntos += 1;
  if (largaDeVerdad) puntos += 1;
  if (mezclaCaja) puntos += 1;
  if (tieneSimbolo) puntos += 1;

  if (puntos <= 1) {
    return { nivel: 1, etiqueta: "Corta. Con 12 caracteres ya cuesta mucho más adivinarla.", clase: "bg-fault-line" };
  }
  if (puntos === 2) {
    return {
      nivel: 2,
      etiqueta: tieneSimbolo ? "Mejora mezclando mayúsculas y minúsculas." : "Mejora agregándole un número o un símbolo.",
      clase: "bg-attention-line",
    };
  }
  if (puntos === 3) {
    return {
      nivel: 3,
      etiqueta: largaDeVerdad ? "Buena. Un símbolo más y queda redonda." : "Buena. Alárgala a 12 y queda redonda.",
      clase: "bg-attention-line",
    };
  }
  return { nivel: 4, etiqueta: "Fuerte.", clase: "bg-balanced-line" };
}

// -----------------------------------------------------------------------------
// Variante "persona ya tiene cuenta" — solo confirma (Pantalla J caso 2)
// -----------------------------------------------------------------------------

function FormularioConfirmarAceptacion({
  token,
  info,
}: {
  token: string;
  info: InvitacionValida;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{
    tipo: "error" | "info";
    texto: string;
    email?: string;
  } | null>(null);

  async function manejarConfirmar() {
    if (enviando) return;
    setEnviando(true);
    setMensaje(null);
    try {
      const resultado = await aceptarInvitacionComoPersonaExistente({ token });
      if (resultado.ok) {
        router.push("/login?invitacion_aceptada=1");
        return;
      }
      if (resultado.tipo === "requiere_inicio_sesion") {
        setMensaje({ tipo: "info", texto: resultado.mensaje, email: resultado.email });
        return;
      }
      setMensaje({ tipo: "error", texto: resultado.mensaje });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Tarjeta>
      <h1 className="font-heading text-xl leading-tight font-semibold">Confirma para entrar</h1>
      <p className="mt-2 text-sm leading-relaxed text-fg-muted">
        Ya tienes cuenta con <span className="rx-num font-medium text-fg">{info.email}</span>. Estás
        por sumarte a <span className="font-medium text-fg">{info.nombreTenant}</span> como{" "}
        {NOMBRES_ROL[info.rol]}.
      </p>
      {/* Lo que NO se pide, dicho: quien ya tiene cuenta suele esperar que acá le
          vuelvan a pedir la contraseña, y no verla lo hace dudar de si funcionó. */}
      <p className="mt-2 text-sm leading-relaxed text-fg-subtle">
        No hay nada que crear: tu contraseña sigue siendo la misma.
      </p>

      {mensaje ? (
        <div className="mt-4">
          <Alert variant={mensaje.tipo === "error" ? "destructive" : "default"}>
            <AlertDescription className="space-y-2">
              <p>{mensaje.texto}</p>
              {mensaje.email ? (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`/login?email=${encodeURIComponent(mensaje.email)}&volver=${encodeURIComponent(`/invitacion/${token}`)}`}
                  >
                    Iniciar sesión
                  </a>
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      <Button className="mt-5 w-full" onClick={manejarConfirmar} disabled={enviando}>
        {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
        {enviando ? "Confirmando…" : "Aceptar e ingresar"}
      </Button>
    </Tarjeta>
  );
}
