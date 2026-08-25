"use client";

/**
 * Pantalla C — Define tu contraseña (primer login del dueño, RF-006).
 *
 * Éxito → redirige DIRECTO al panel de onboarding (Pantalla D), sin pasos
 * intermedios ("eso sería un paso y una llamada de más" — documento de UX).
 */

import { useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { definirContrasenaInicial } from "./actions";

interface Props {
  /** `true` si `/auth/confirm` no pudo validar el enlace — token inválido/usado/vencido. */
  enlaceInvalido: boolean;
  nombreFantasia: string | null;
  nombreSugerido: string | null;
  /**
   * `true` cuando quien activa es un SELLER. Solo entonces se le pide el
   * WhatsApp: un usuario interno del courier o un conductor no representan a
   * nadie a quien Rutax le mande avisos de retiro.
   */
  esSeller?: boolean;
}

export function FormularioActivacion({
  enlaceInvalido,
  nombreFantasia,
  nombreSugerido,
  esSeller = false,
}: Props) {
  const router = useRouter();
  const idBase = useId();

  const [nombreCompleto, setNombreCompleto] = useState(nombreSugerido ?? "");
  const [contrasena, setContrasena] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [errores, setErrores] = useState<{ nombre?: string; contrasena?: string; confirmacion?: string }>({});
  const [enviando, setEnviando] = useState(false);
  const [errorServidor, setErrorServidor] = useState<string | null>(null);
  const [telefonoWhatsApp, setTelefonoWhatsApp] = useState("");
  const [aceptaWhatsApp, setAceptaWhatsApp] = useState(false);

  if (enlaceInvalido) {
    return (
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="mb-1 flex size-12 items-center justify-center rounded-full bg-muted">
            <ShieldAlert className="size-6 text-warning" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">Este enlace ya no es válido</CardTitle>
          <CardDescription>
            Si ya activaste tu cuenta, inicia sesión con el correo que usaste; si no, solicita un nuevo enlace a quien te invitó.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <a href="/login">Iniciar sesión</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

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
      const resultado = await definirContrasenaInicial({
        nombreCompleto,
        contrasena,
        telefonoWhatsApp: esSeller ? telefonoWhatsApp : undefined,
        aceptaWhatsApp: esSeller ? aceptaWhatsApp : undefined,
      });
      if (resultado.ok) {
        router.push("/onboarding");
        router.refresh();
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
          {nombreSugerido
            ? `Hola, ${nombreSugerido}. Estás a un paso de activar ${nombreFantasia ?? "tu cuenta"}.`
            : `Estás a un paso de activar ${nombreFantasia ?? "tu cuenta"}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={manejarEnvio} noValidate className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`${idBase}-nombre`}>Tu nombre completo</Label>
            <Input
              id={`${idBase}-nombre`}
              autoFocus={!nombreSugerido}
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
              autoFocus={Boolean(nombreSugerido)}
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
                    <span key={i} className={`h-full flex-1 rounded-full ${i < fortaleza.nivel ? fortaleza.color : "bg-muted"}`} />
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

          {/*
            El WhatsApp del seller, y su consentimiento.

            Va acá y no en una pantalla del courier porque **el permiso lo tiene
            que dar el interesado**. Hasta el 2026-08-25 era el courier quien
            afirmaba que otra empresa había aceptado recibir mensajes; esto lo
            reemplaza por la firma de quien decide.

            Es OPCIONAL: quien no quiera dar su número activa igual su cuenta y
            lo puede poner después desde su perfil. Pedirlo como obligatorio
            convertiría un consentimiento en un peaje, que es justo lo contrario
            de un consentimiento.
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
