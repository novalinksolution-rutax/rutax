import { PanelNoEncontrada } from "@/components/ui/panel-no-encontrada";

/**
 * 404 dentro del portal del seller.
 *
 * ⚠️ El texto **no nombra a Rutax**: para el seller la relación es con su
 * courier (regla 42). Y no dice «no tienes permiso», porque una 404 no distingue
 * lo que no existe de lo que no es tuyo — y afirmar cuál de las dos convertiría
 * la pantalla en un oráculo sobre los pedidos de otros sellers.
 */
export default function NoEncontradaPortal() {
  return (
    <PanelNoEncontrada
      titulo="No encontramos esa página"
      cuerpo="El enlace puede estar mal copiado, o el pedido ya no está disponible. Desde el menú puedes volver a tus pedidos y tus cobros."
      salida={{ href: "/portal/pedidos", texto: "Ver mis pedidos" }}
    />
  );
}
