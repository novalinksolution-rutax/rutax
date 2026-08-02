import { redirect } from "next/navigation";

/**
 * Índice del backstage `/admin`. El área no tiene un dashboard propio en la raíz:
 * la pantalla de aterrizaje es Suscripciones. Redirige ahí para que entrar a
 * `/admin` no dé 404. El gate de sesión vive en `layout.tsx` (si no hay sesión de
 * super-admin válida, renderiza el login en vez del contenido), así que esta
 * redirección es segura tanto autenticado como no.
 */
export default function AdminIndexPage() {
  redirect("/admin/suscripciones");
}
