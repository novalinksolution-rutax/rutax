import { PanelNoEncontrada } from "@/components/ui/panel-no-encontrada";

/**
 * 404 dentro del área del courier.
 *
 * ⚠️ **Acá SÍ se sabe quién mira**, y por eso el texto cambia. La 404 pública
 * está escrita para el destinatario de un paquete que no tiene cuenta: no
 * afirma nada y ofrece «Ir a Rutax». A un coordinador con la sesión abierta y el
 * sidebar delante, ese mismo texto le decía que fuera al sitio donde ya está y
 * le preguntaba si estaba siguiendo un envío.
 *
 * Y hay una causa que acá sí se puede nombrar sin adivinar: **lo que buscaba
 * pudo existir y haber dejado de existir**. Un pedido no procesado se archiva y
 * se elimina a los N días, y un manifiesto viejo se borra. Decirlo evita que
 * alguien crea que el sistema perdió su trabajo.
 */
export default function NoEncontradaTenant() {
  return (
    <PanelNoEncontrada
      titulo="No encontramos esa página"
      cuerpo="El enlace puede estar mal, o lo que buscabas ya no existe: los pedidos no procesados y los manifiestos antiguos se eliminan pasado su plazo."
      salida={{ href: "/dashboard", texto: "Ir al panel" }}
      nota="El menú de la izquierda sigue disponible."
    />
  );
}
