/**
 * Los cinco finales de una invitación.
 * =============================================================================
 *
 * -----------------------------------------------------------------------------
 * POR QUÉ SON CINCO PANTALLAS Y NO UNA
 * -----------------------------------------------------------------------------
 * Quien abre este enlace es **un seller o un conductor nuevo**: no tiene cuenta,
 * no conoce el producto y no tiene a quién preguntarle dentro del sistema. Si la
 * pantalla dice «enlace inválido» y nada más, esa persona queda detenida ahí, y
 * el courier pierde a alguien que ya había aceptado trabajar con él.
 *
 * Los cinco finales son el mismo hecho —«esto no se puede abrir»— con **cinco
 * salidas distintas**, y esa es toda la diferencia:
 *
 * | Final | Qué pasó | Qué puede hacer |
 * |---|---|---|
 * | **ya se usó** | la cuenta ya existe | entrar, y es un botón |
 * | **venció** | pasaron los 7 días | pedir una nueva a quien lo invitó |
 * | **la canceló el courier** | lo dieron de baja | escribirle a quien lo invitó |
 * | **el enlace no es válido** | llegó cortado o mal copiado | abrir el del correo, entero |
 * | **no pudimos abrirla** | se rompió lo nuestro | volver a intentar |
 *
 * Mandarlas todas a «pide una invitación nueva» tiene un costo concreto: a quien
 * ya tiene la cuenta creada se le hace pedir un enlace que no necesita, y va a
 * esperar por algo que nunca va a llegar porque nadie tiene nada que mandarle.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ REGLA 45 · NI CONFIRMA NI NIEGA
 * -----------------------------------------------------------------------------
 * El final de **enlace no válido** no dice si ese token existió alguna vez. Decir
 * «esta invitación no existe» convierte una pantalla pública en un oráculo:
 * probando tokens se averigua cuáles son válidos. Los otros cuatro sí pueden ser
 * específicos porque **el token es correcto** — quien lo tiene es su destinatario.
 *
 * -----------------------------------------------------------------------------
 * NINGUNO CULPA A LA PERSONA
 * -----------------------------------------------------------------------------
 * «Enlace inválido» le dice a alguien que hizo algo mal cuando lo único que hizo
 * fue tocar lo que le llegó. Los cinco textos dicen qué pasó del lado del sistema
 * y qué sigue; el nuestro además lo dice explícito —«es un problema nuestro, no
 * tuyo»— porque es el único donde de verdad no hay nada que la persona pudiera
 * haber hecho distinto.
 *
 * -----------------------------------------------------------------------------
 * ES SERVIDOR, A PROPÓSITO
 * -----------------------------------------------------------------------------
 * Cuatro de los cinco finales no tienen ni un botón que haga algo: son texto y un
 * enlace. Enviarle el JavaScript del formulario de contraseñas a quien va a ver
 * un mensaje de tres líneas es gasto puro, y esta pantalla se abre en el teléfono
 * de alguien que no eligió abrirla.
 */

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { DistintivoEstado } from "@/components/ui/distintivo-estado";
import { PantallaSinSesion } from "@/components/ui/pantalla-sin-sesion";
import type { TonoEstado } from "@/lib/ui/tonos-estado";

import type { EstadoInvitacionPublica } from "./actions";

type FinalInvitacion = Exclude<EstadoInvitacionPublica, { estado: "valida" }>;

export function EstadosFinales({ estado, token }: { estado: FinalInvitacion; token: string }) {
  switch (estado.estado) {
    // ── 1 · Ya se usó ────────────────────────────────────────────────────
    // No es un error: es el mejor final posible llegando tarde. El tono lo dice
    // (`balanced`, el de lo que cuadró) y la salida es entrar, no pedir nada.
    case "ya_aceptada":
      return (
        <Final
          tono="balanced"
          rotulo="Ya se usó"
          titulo="Tu cuenta ya está creada"
          cuerpo="Esta invitación se usó y no se puede volver a usar. Entra con tu correo y la contraseña que definiste."
          accion={
            <Button asChild>
              <Link href="/login">Iniciar sesión</Link>
            </Button>
          }
        />
      );

    // ── 2 · Venció ───────────────────────────────────────────────────────
    // Sin botón: **no hay nada que esta persona pueda hacer desde acá**. Poner
    // «Solicitar una nueva» sería un botón que no puede funcionar — la
    // invitación la crea el courier, no el invitado.
    case "expirada":
      return (
        <Final
          tono="attention"
          rotulo="Venció"
          titulo="Esta invitación venció"
          cuerpo={
            estado.email
              ? `Las invitaciones duran 7 días. Pídele a quien te invitó que te mande una nueva a ${estado.email}: reactivarla no depende de ti.`
              : "Las invitaciones duran 7 días. Pídele a quien te invitó que te mande una nueva: reactivarla no depende de ti."
          }
        />
      );

    // ── 3 · La canceló el courier ────────────────────────────────────────
    // `inert` con su trama: existe, y está fuera de juego a propósito. No
    // decimos por qué la cancelaron — no lo sabemos, y adivinarlo delante de
    // alguien que no puede contradecirnos es peor que no decir nada.
    case "revocada":
      return (
        <Final
          tono="inert"
          rotulo="Cancelada"
          titulo="Esta invitación se canceló"
          cuerpo="Quien te invitó la dio de baja. Si crees que fue un error, escríbele directamente: desde acá no se puede reactivar."
        />
      );

    // ── 5 · No pudimos abrirla (nuestro) ─────────────────────────────────
    // El único con `fault`: se rompió algo y hay que actuar. Y el único con un
    // botón que sirve de verdad, porque reintentar es exactamente lo que puede
    // arreglarlo.
    case "error":
      return (
        <Final
          tono="fault"
          rotulo="Falla nuestra"
          titulo="No pudimos abrir tu invitación"
          cuerpo="Es un problema nuestro, no tuyo, y tu invitación sigue intacta. Vuelve a intentarlo en un momento."
          accion={
            <Button asChild variant="outline">
              <a href={`/invitacion/${encodeURIComponent(token)}`}>Volver a intentar</a>
            </Button>
          }
        />
      );

    // ── 4 · El enlace no es válido ───────────────────────────────────────
    // ⚠️ El texto **no afirma ni niega** que exista una invitación con ese
    // token: habla del enlace, que es lo único observable. Y nombra la causa
    // más frecuente de verdad —el correo que corta el enlace en dos líneas—
    // en vez de dejar a la persona pensando que se equivocó.
    default:
      return (
        <Final
          tono="neutral"
          rotulo="Enlace incompleto"
          titulo="Este enlace no nos sirve"
          cuerpo="Suele pasar cuando el correo lo corta en dos líneas y se copia solo la primera. Vuelve al correo y ábrelo desde ahí; si sigue igual, pídele uno nuevo a quien te invitó."
          accion={
            <Button asChild variant="outline">
              <Link href="/login">Ya tengo cuenta</Link>
            </Button>
          }
        />
      );
  }
}

/**
 * El marco común de los cinco.
 *
 * El distintivo de arriba no es decoración: es **el mismo objeto** con el que el
 * courier ve el estado de esa invitación en su pantalla de equipo. La persona de
 * afuera y la de adentro miran el mismo hecho con el mismo tono y el mismo
 * glifo — es la regla 46 aplicada a un objeto que no es un pedido.
 */
function Final({
  tono,
  rotulo,
  titulo,
  cuerpo,
  accion,
}: {
  tono: TonoEstado;
  rotulo: string;
  titulo: string;
  cuerpo: string;
  accion?: React.ReactNode;
}) {
  return (
    // `neutra`: no sabemos de qué courier viene —en el enlace inválido no hay
    // forma de saberlo— y poner una marca sería afirmar una relación que no está
    // establecida.
    <PantallaSinSesion marca={{ tipo: "neutra" }}>
      {/* Sin sombra (regla 4). */}
      <div className="w-full max-w-sm border border-line bg-bg-raised p-6">
        <DistintivoEstado tono={tono} etiqueta={rotulo} />
        <h1 className="font-heading mt-4 text-xl leading-tight font-semibold">{titulo}</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{cuerpo}</p>
        {accion ? <div className="mt-5">{accion}</div> : null}
      </div>
    </PantallaSinSesion>
  );
}
