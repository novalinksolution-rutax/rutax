/**
 * Por qué no se pudo entrar. Brecha #7 del inventario.
 * =============================================================================
 *
 * El formulario de login mostraba **una sola frase para todo**: «Email o
 * contraseña incorrectos. Verifica tus datos e intenta de nuevo.» Daba igual
 * qué hubiera pasado.
 *
 * Las consecuencias no son de tono:
 *
 * · A quien tiene la **cuenta suspendida** se le dice que revise cómo escribe,
 *   para siempre. Va a probar diez contraseñas, va a usar «olvidé mi
 *   contraseña», va a cambiarla — y va a seguir sin entrar, porque el problema
 *   nunca fue la contraseña. Después llama al courier, que tampoco sabe.
 * · A quien está **bloqueado por intentos** se le invita a intentar de nuevo,
 *   que es exactamente lo que extiende el bloqueo.
 * · Y si el **servicio está caído**, se le dice a alguien con la contraseña
 *   correcta que la tiene mal. Mucha gente la cambia. Ahora sí la tiene mal.
 *
 * -----------------------------------------------------------------------------
 * ⚠️ REGLA 45 · UNA PANTALLA PÚBLICA NO CONFIRMA NI NIEGA
 * -----------------------------------------------------------------------------
 * Distinguir causas **no** puede convertirse en un oráculo de cuentas. Por eso
 * la credencial equivocada sigue teniendo **un solo mensaje**, el mismo tanto si
 * el correo existe como si no: probando correos no se averigua cuáles están
 * registrados.
 *
 * Lo que sí se distingue son estados que **solo se alcanzan con la credencial
 * correcta** —la cuenta existe y quien pregunta ya lo demostró— o que no hablan
 * de la cuenta en absoluto, como que el servicio no responda.
 */

/** Qué mostrar y si tiene sentido reintentar ya mismo. */
export interface LecturaErrorLogin {
  /** El mensaje que ve la persona. */
  mensaje: string;
  /**
   * La salida que SÍ funciona, cuando existe.
   *
   * ⚠️ Va justo en los dos estados donde el botón de entrar se apaga o no
   * ayuda: **decirle a alguien que espere y no ofrecerle nada es dejarlo
   * mirando la pantalla.** Con el bloqueo por intentos, cambiar la contraseña
   * lo hace entrar al tiro; con un fallo nuestro, reintentar es lo correcto y
   * hay que decirlo, porque el mensaje solo no lo sugiere.
   */
  salida?: { href: string; texto: string };
  /**
   * `true` cuando reintentar ahora es inútil o contraproducente: bloqueo por
   * intentos, cuenta suspendida. La pantalla apaga el botón.
   */
  reintentarNoAyuda: boolean;
}

const CREDENCIAL_INVALIDA: LecturaErrorLogin = {
  // Deliberadamente ambiguo entre «no existe» y «está mal la clave»: es lo que
  // impide enumerar cuentas. Lo que sí cambia respecto del texto anterior es que
  // ya no es la respuesta a TODO.
  mensaje: "El correo o la contraseña no coinciden. Revísalos e intenta de nuevo.",
  reintentarNoAyuda: false,
};

/**
 * Traduce el fallo de autenticación a algo accionable.
 *
 * Acepta la forma laxa de un error de Supabase (`code`, `status`, `message`)
 * porque el cliente cambia esos campos entre versiones y no vale la pena atarse
 * a uno: se leen los tres y se cae a la credencial inválida, que es el caso más
 * frecuente y el más seguro para mostrar cuando no se sabe.
 */
export function traducirErrorLogin(
  error: { code?: string | null; status?: number | null; message?: string | null } | null,
  /** `true` si la petición ni siquiera llegó (fetch falló, sin respuesta). */
  sinRed = false,
): LecturaErrorLogin {
  if (sinRed) {
    return {
      mensaje:
        "No pudimos conectarnos. Revisa tu conexión e intenta de nuevo: tu contraseña no tiene nada que ver.",
      reintentarNoAyuda: false,
    };
  }

  if (!error) return CREDENCIAL_INVALIDA;

  const codigo = (error.code ?? "").toLowerCase();
  const texto = (error.message ?? "").toLowerCase();
  const estado = error.status ?? 0;

  // Bloqueo por intentos. Reintentar es justo lo que lo alarga.
  if (estado === 429 || codigo.includes("rate_limit") || texto.includes("rate limit")) {
    return {
      mensaje:
        "Demasiados intentos seguidos. Espera unos minutos antes de volver a probar: seguir intentando alarga la espera.",
      reintentarNoAyuda: true,
      // No es un error suyo: es una defensa nuestra. Por eso ofrece el camino
      // que no está bloqueado en vez de dejarlo esperando.
      salida: { href: "/recuperar-contrasena", texto: "Cambiar mi contraseña" },
    };
  }

  // La cuenta existe y la credencial era correcta: no hay enumeración posible.
  if (codigo.includes("email_not_confirmed") || texto.includes("email not confirmed")) {
    return {
      mensaje:
        "Tu cuenta todavía no está activada. Busca el correo de activación que te enviamos; si no lo encuentras, pídele a quien te invitó que te lo reenvíe.",
      reintentarNoAyuda: true,
      salida: { href: "/registro/revisa-tu-correo", texto: "Reenviar el correo de activación" },
    };
  }

  if (
    codigo.includes("user_banned") ||
    texto.includes("banned") ||
    texto.includes("user is disabled")
  ) {
    return {
      mensaje:
        "Esta cuenta está suspendida. No es un problema de contraseña: habla con quien administra tu equipo.",
      reintentarNoAyuda: true,
    };
  }

  // El servicio no respondió. Decirle a alguien con la clave correcta que la
  // tiene mal es lo que hace que la cambie — y ahí sí la tiene mal.
  if (estado >= 500) {
    return {
      // ⚠️ **«No pudimos validar» nos culpa a nosotros; «no coinciden» culpa a
      // la credencial.** Confundirlas hace que alguien cambie una contraseña
      // que estaba bien — y ahí sí queda con una contraseña que no recuerda.
      mensaje:
        "No pudimos validar tu contraseña. Fue un problema nuestro, no tuyo: tu contraseña sigue siendo la misma.",
      reintentarNoAyuda: false,
    };
  }

  return CREDENCIAL_INVALIDA;
}
