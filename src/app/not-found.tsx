import { PanelNoEncontrada } from "@/components/ui/panel-no-encontrada";

/**
 * La 404 pública. NUEVO #28.
 * =============================================================================
 *
 * **No existía ninguna.** Todo `notFound()` del repo caía en la página por
 * defecto de Next: «404 · This page could not be found», **en inglés y sin una
 * sola marca**. Era la única pantalla del producto en otro idioma.
 *
 * Y no la ve solo un usuario interno que se equivocó de URL. La ve **el
 * destinatario de un paquete** cuando el enlace de seguimiento que le mandaron
 * por WhatsApp no calza —token vencido, mal copiado, pedido ya purgado—, que es
 * la brecha #10 del inventario. Esa persona no es cliente de nadie: no tiene
 * cuenta, no sabe qué es Rutax, y lo único que quería era saber dónde está su
 * paquete.
 *
 * QUÉ DICE Y QUÉ NO
 * -----------------------------------------------------------------------------
 * **No dice qué falló**, porque no se sabe: una 404 no distingue un enlace mal
 * copiado de uno vencido de uno que nunca existió. Inventar una causa —«el
 * enlace expiró»— sería adivinar delante de alguien que no puede contradecirte.
 *
 * **Y no confirma ni niega nada** (regla 45): no dice «este envío no existe»,
 * porque eso convierte la 404 en un oráculo — probando tokens se averigua
 * cuáles son válidos. Dice que la página no está y ofrece dónde seguir.
 *
 * LA SALIDA NO ES «VOLVER AL INICIO»
 * -----------------------------------------------------------------------------
 * «Inicio» no significa nada para quien llegó desde un enlace de seguimiento: no
 * tiene inicio acá. Por eso hay dos salidas y ninguna asume quién eres — la de
 * arriba para quien tiene cuenta, y debajo la única indicación que le sirve a
 * quien no la tiene: pedirle el enlace a quien se lo mandó.
 *
 * ⚠️ **Esta vaguedad es correcta ACÁ y solo acá.** Dentro de un área con sesión
 * sí se sabe quién mira, y esta misma pantalla se leía absurda: al coordinador
 * que tecleó mal el id de un manifiesto se le decía «Ir a Rutax» y se le
 * preguntaba si estaba siguiendo un envío. Cada área tiene ahora la suya.
 */
export default function NoEncontrada() {
  return (
    <PanelNoEncontrada
      cuerpo="El enlace puede estar mal copiado o ya no estar disponible. No podemos saber cuál de las dos."
      salida={{ href: "/", texto: "Ir a Rutax" }}
      nota="¿Estabas siguiendo un envío? Pídele el enlace otra vez a quien te lo mandó: los enlaces de seguimiento dejan de funcionar cuando el pedido se cierra."
    />
  );
}
