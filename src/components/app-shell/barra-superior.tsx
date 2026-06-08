"use client";

/**
 * Barra superior mínima del área autenticada — contenedor común para las
 * pantallas de onboarding (D-G), equipo (H-I) y sellers (K). No es "el"
 * dashboard del dueño (RF-046, fuera de este documento) — es el andamiaje
 * mínimo necesario para que estas pantallas no vivan huérfanas de navegación.
 *
 * Mantiene la jerarquía simple a propósito: nombre de la empresa + navegación
 * de las secciones que este lote de pantallas ya cubre + cierre de sesión.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

interface EnlaceNav {
  href: string;
  etiqueta: string;
}

interface Props {
  nombreFantasia: string;
  nombreCompleto: string | null;
  enlaces: EnlaceNav[];
}

export function BarraSuperior({ nombreFantasia, nombreCompleto, enlaces }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [cerrandoSesion, startCerrarSesion] = useTransition();

  function manejarCerrarSesion() {
    startCerrarSesion(async () => {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    });
  }

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex items-center gap-6">
          <span className="truncate font-semibold text-foreground">{nombreFantasia}</span>
          <nav className="hidden items-center gap-1 md:flex">
            {enlaces.map((enlace) => {
              const activo = pathname === enlace.href || pathname?.startsWith(`${enlace.href}/`);
              return (
                <Link
                  key={enlace.href}
                  href={enlace.href}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    activo
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {enlace.etiqueta}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {nombreCompleto ? (
            <span className="hidden truncate text-sm text-muted-foreground sm:inline">{nombreCompleto}</span>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={manejarCerrarSesion}
            disabled={cerrandoSesion}
            className="hidden md:inline-flex"
          >
            <LogOut className="size-4" aria-hidden="true" />
            Cerrar sesión
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMenuAbierto((v) => !v)}
            aria-label={menuAbierto ? "Cerrar menú" : "Abrir menú"}
          >
            {menuAbierto ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>
        </div>
      </div>

      {menuAbierto ? (
        <nav className="border-t border-border px-4 py-2 md:hidden">
          <ul className="flex flex-col gap-1">
            {enlaces.map((enlace) => (
              <li key={enlace.href}>
                <Link
                  href={enlace.href}
                  className="block rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  onClick={() => setMenuAbierto(false)}
                >
                  {enlace.etiqueta}
                </Link>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={manejarCerrarSesion}
                disabled={cerrandoSesion}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-muted-foreground hover:bg-muted"
              >
                <LogOut className="size-4" aria-hidden="true" />
                Cerrar sesión
              </button>
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
