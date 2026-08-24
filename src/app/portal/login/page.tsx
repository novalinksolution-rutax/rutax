import { redirect } from "next/navigation";

/**
 * El portal del seller entra por la misma puerta que todos.
 * =============================================================================
 *
 * ⚠️ **El tablero dibuja acá un login propio con la marca del courier, y no se
 * puede construir.** No es una omisión: es que **no sabemos de qué courier se
 * trata** hasta que la persona escribe su correo. El producto vive en un solo
 * dominio —`rutax.io`, sin subdominio por courier—, así que en esta URL no hay
 * ningún dato del que sacar el nombre que el tablero quiere poner arriba.
 *
 * Y el propio sistema ya lo había resuelto en la otra punta: la regla 42 define
 * el caso **`neutra`** justo para esto — «el login unificado: por esa misma
 * puerta entran el dueño del courier, el seller y el conductor, y no hay forma
 * de saber cuál antes de que escriba su correo. Poner una marca ahí es afirmar
 * una relación que no está establecida».
 *
 * O sea: el tablero se contradice consigo mismo, y de los dos lados gana la
 * regla, porque la regla es la que se puede cumplir. `/login` es `neutra` y este
 * redirect es lo correcto.
 *
 * **Lo que sí habría que revisar** es la otra mitad de lo que pide el tablero
 * para esta pantalla —que un correo inexistente no se confirme como inexistente,
 * y que no se ofrezca registrarse porque al portal solo se entra invitado—: eso
 * es del formulario de `/login`, no de esta ruta.
 *
 * El día que exista un subdominio o un enlace con el courier dentro, esta
 * pantalla puede volver con su marca y el redirect se retira.
 */
export default function PaginaPortalLogin() {
  redirect("/login");
}
