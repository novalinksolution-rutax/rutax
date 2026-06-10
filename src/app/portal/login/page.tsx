import { redirect } from "next/navigation";

/** El portal del seller usa el mismo formulario de login central. */
export default function PaginaPortalLogin() {
  redirect("/login");
}
