import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ReenviarCorreo } from "./reenviar-correo";

export const metadata: Metadata = {
  title: "Revisa tu correo",
};

interface PageProps {
  searchParams: Promise<{ email?: string }>;
}

/**
 * Pantalla B — "Revisa tu correo" (estado intermedio, sin acción posible).
 * Cierra el ciclo del alta con una expectativa clara — incluye vigencia del
 * enlace para anticipar la pregunta "¿y si no llega?".
 */
export default async function PaginaRevisaTuCorreo({ searchParams }: PageProps) {
  const { email } = await searchParams;
  const correo = email?.trim() || "el correo que ingresaste";

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-muted/40 px-4 py-12">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="items-center">
          <div className="mb-2 flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Mail className="size-7" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">Revisa tu correo</CardTitle>
          <CardDescription>
            Enviamos un enlace a <span className="font-medium text-foreground">{correo}</span> para que actives tu
            cuenta y crees tu contraseña. El enlace vence en 7 días.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {email ? <ReenviarCorreo email={correo} /> : null}
          <p className="text-xs text-muted-foreground">
            ¿Necesitas ayuda?{" "}
            <Link href="/soporte" className="font-medium underline underline-offset-4">
              Contacta a soporte
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
