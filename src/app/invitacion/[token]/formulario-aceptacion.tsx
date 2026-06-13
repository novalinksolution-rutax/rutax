"use client";

/**
 * Pantallas C (primer login del dueño) y J (aceptación de invitación interna /
 * seller / conductor) — comparten estructura porque usan el MISMO mecanismo
 * de token (`aceptarInvitacion`). Dos variantes según si la persona ya tiene
 * cuenta (criterio §2.2 del documento de UX):
 *   - "persona nueva": define su contraseña.
 *   - "persona existente": solo confirma — nunca se le pide un dato que el
 *     sistema ya tiene (criterio transversal #4).
 */

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Lock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { Rol } from "@/modules/identidad/roles";
import {
  aceptarInvitacionComoPersonaExistente,
  aceptarInvitacionComoPersonaNueva,
  type EstadoInvitacionPublica,
} from "./actions";

const NOMBRES_ROL: Record<Rol, string> = {
  dueno: "dueño",
  supervisor: "supervisor",
  coordinador: "coordinador de tráfico",
  administracion: "administración",
  conductor: "conductor",
  seller: "seller",
  super_admin: "administrador de plataforma",
};

interface Props {
  token: string;
  estadoInicial: EstadoInvitacionPublica;
  /** Si la invitación corresponde al primer dueño (sin tenant aún) — cambia el saludo (Pantalla C). */
  esPrimerDueno: boolean;
}

export function FormularioAceptacion({ token, estadoInicial, esPrimerDueno }: Props) {
  if (estadoInicial.estado === "invalida") {
    return (
      <PantallaEstadoFinal
        icono={<ShieldAlert className="size-7" aria-hidden="true" />}
        titulo="Este enlace ya no es válido"
        descripcion="Si ya activaste tu cuenta, inicia sesión; si no, solicita uno nuevo a quien te invitó."
        accion={
          <Button asChild>
            <a href="/login">Iniciar sesión</a>
          </Button>
        }
      />
    );
  }

  if (estadoInicial.estado === "ya_aceptada") {
    return (
      <PantallaEstadoFinal
        icono={<CheckCircle2 className="size-7 text-success" aria-hidden="true" />}
        titulo="Esta invitación ya fue utilizada"
        descripcion="Si ya activaste tu cuenta, simplemente inicia sesión."
        accion={
          <Button asChild>
            <a href="/login">Iniciar sesión</a>
          </Button>
        }
      />
    );
  }

  if (estadoInicial.estado === "expirada") {
    return (
      <PantallaEstadoFinal
        icono={<ShieldAlert className="size-7 text-warning" aria-hidden="true" />}
        titulo="Este enlace venció"
        descripcion={
          esPrimerDueno
            ? `Pide que te reenvíen la activación a ${estadoInicial.email}, o solicita una nueva.`
            : "Pide a quien te invitó que te envíe una invitación nueva — no puedes reactivar esta tú mismo."
        }
      />
    );
  }

  if (estadoInicial.estado === "revocada") {
    return (
      <PantallaEstadoFinal
        icono={<ShieldAlert className="size-7 text-muted-foreground" aria-hidden="true" />}
        titulo="Esta invitación fue cancelada"
        descripcion="Si crees que es un error, contacta a quien te invitó."
      />
    );
  }

  if (estadoInicial.estado === "error") {
    return (
      <PantallaEstadoFinal
        icono={<ShieldAlert className="size-7 text-destructive" aria-hidden="true" />}
        titulo="No pudimos cargar esta invitación"
        descripcion="Es un problema de nuestro sistema, no tuyo — intenta abrir el enlace de nuevo en unos minutos."
      />
    );
  }

  return estadoInicial.variante === "persona_nueva" ? (
    <FormularioDefinirContrasena token={token} info={estadoInicial} esPrimerDueno={esPrimerDueno} />
  ) : (
    <FormularioConfirmarAceptacion token={token} info={estadoInicial} />
  );
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
  info: Extract<EstadoInvitacionPublica, { estado: "valida" }>;
  esPrimerDueno: boolean;
}) {
  const router = useRouter();
  const idBase = useId();

  const [nombreCompleto, setNombreCompleto] = useState("");
  const [contrasena, setContrasena] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [errores, setErrores] = useState<{ nombre?: string; contrasena?: string; confirmacion?: string }>({});
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);

  const fortaleza = calcularFortaleza(contrasena);

  function validar(): boolean {
    const nuevos: typeof errores = {};
    if (!nombreCompleto.trim()) nuevos.nombre = "Tu nombre completo es obligatorio.";
    if (contrasena.length < 8) nuevos.contrasena = "La contraseña debe tener al menos 8 caracteres.";
    if (contrasena !== confirmacion) nuevos.confirmacion = "Las contraseñas no coinciden.";
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
      const resultado = await aceptarInvitacionComoPersonaNueva({ token, nombreCompleto, contrasena });
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
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Lock className="size-6" aria-hidden="true" />
        </div>
        <CardTitle className="text-xl">Define tu contraseña</CardTitle>
        <CardDescription>
          {esPrimerDueno
            ? `Estás a un paso de activar ${info.nombreTenant}.`
            : `${info.nombreTenant} te invitó como ${NOMBRES_ROL[info.rol]}. Crea tu contraseña para empezar.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={manejarEnvio} noValidate className="space-y-4">
          <div className="space-y-2">
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
            />
            {errores.nombre ? <p className="text-sm text-destructive">{errores.nombre}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idBase}-contrasena`}>Contraseña</Label>
            <Input
              id={`${idBase}-contrasena`}
              type="password"
              value={contrasena}
              onChange={(e) => {
                setContrasena(e.target.value);
                setErrores((a) => ({ ...a, contrasena: undefined }));
              }}
              aria-invalid={Boolean(errores.contrasena)}
            />
            {contrasena ? (
              <div className="space-y-1">
                <div className="flex h-1.5 gap-1">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={`h-full flex-1 rounded-full ${
                        i < fortaleza.nivel ? fortaleza.color : "bg-muted"
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">{fortaleza.etiqueta}</p>
              </div>
            ) : null}
            {errores.contrasena ? <p className="text-sm text-destructive">{errores.contrasena}</p> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${idBase}-confirmacion`}>Confirma tu contraseña</Label>
            <Input
              id={`${idBase}-confirmacion`}
              type="password"
              value={confirmacion}
              onChange={(e) => {
                setConfirmacion(e.target.value);
                setErrores((a) => ({ ...a, confirmacion: undefined }));
              }}
              aria-invalid={Boolean(errores.confirmacion)}
            />
            {errores.confirmacion ? <p className="text-sm text-destructive">{errores.confirmacion}</p> : null}
          </div>

          {errorServidor ? (
            <Alert variant="destructive">
              <AlertDescription>{errorServidor}</AlertDescription>
            </Alert>
          ) : null}

          <Button type="submit" className="w-full" disabled={enviando}>
            {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
            {enviando ? "Activando tu cuenta…" : "Crear contraseña y entrar"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function calcularFortaleza(valor: string): { nivel: number; etiqueta: string; color: string } {
  let puntos = 0;
  if (valor.length >= 8) puntos += 1;
  if (valor.length >= 12) puntos += 1;
  if (/[A-Z]/.test(valor) && /[a-z]/.test(valor)) puntos += 1;
  if (/[0-9]/.test(valor) || /[^A-Za-z0-9]/.test(valor)) puntos += 1;

  if (puntos <= 1) return { nivel: 1, etiqueta: "Débil — agrega más caracteres", color: "bg-destructive" };
  if (puntos === 2) return { nivel: 2, etiqueta: "Regular", color: "bg-warning" };
  if (puntos === 3) return { nivel: 3, etiqueta: "Buena", color: "bg-warning" };
  return { nivel: 4, etiqueta: "Fuerte", color: "bg-success" };
}

// -----------------------------------------------------------------------------
// Variante "persona ya tiene cuenta" — solo confirma (Pantalla J caso 2)
// -----------------------------------------------------------------------------

function FormularioConfirmarAceptacion({
  token,
  info,
}: {
  token: string;
  info: Extract<EstadoInvitacionPublica, { estado: "valida" }>;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: "error" | "info"; texto: string; email?: string } | null>(null);

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
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </div>
        <CardTitle className="text-xl">Confirma para aceptar</CardTitle>
        <CardDescription>
          Estás por unirte a <span className="font-medium text-foreground">{info.nombreTenant}</span> como{" "}
          {NOMBRES_ROL[info.rol]}. ¿Confirmas?
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {mensaje ? (
          <Alert variant={mensaje.tipo === "error" ? "destructive" : "default"}>
            <AlertDescription className="space-y-2">
              <p>{mensaje.texto}</p>
              {mensaje.email ? (
                <Button asChild size="sm" variant="outline">
                  <a href={`/login?email=${encodeURIComponent(mensaje.email)}&volver=${encodeURIComponent(`/invitacion/${token}`)}`}>
                    Iniciar sesión
                  </a>
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}

        <Button className="w-full" onClick={manejarConfirmar} disabled={enviando}>
          {enviando ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {enviando ? "Confirmando…" : "Aceptar e ingresar"}
        </Button>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Estados finales (token inválido / expirado / revocado / error)
// -----------------------------------------------------------------------------

function PantallaEstadoFinal({
  icono,
  titulo,
  descripcion,
  accion,
}: {
  icono: React.ReactNode;
  titulo: string;
  descripcion: string;
  accion?: React.ReactNode;
}) {
  return (
    <Card className="w-full max-w-md text-center">
      <CardHeader className="items-center">
        <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted">{icono}</div>
        <CardTitle className="text-xl">{titulo}</CardTitle>
        <CardDescription>{descripcion}</CardDescription>
      </CardHeader>
      {accion ? <CardContent>{accion}</CardContent> : null}
    </Card>
  );
}
