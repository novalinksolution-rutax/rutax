"use client";

import Link from "next/link";
import { useState } from "react";
import { MenuIcon } from "lucide-react";

import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

import { BotonVentas } from "./ventas";
import type { EnlaceSitio } from "./sitio";

/** El menú del sitio en pantallas angostas: un panel lateral con las mismas páginas. */
export function MenuMovil({ enlaces }: { enlaces: EnlaceSitio[] }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <Sheet open={abierto} onOpenChange={setAbierto}>
      <SheetTrigger
        aria-label="Abrir menú"
        className="grid size-10 cursor-pointer place-items-center rounded-ctrl border border-line text-fg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-text lg:hidden"
      >
        <MenuIcon className="size-5" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="right" className="w-[86%] max-w-sm gap-0 border-line bg-bg p-0 text-fg">
        <SheetTitle className="sr-only">Menú</SheetTitle>
        <nav aria-label="Páginas" className="grid gap-1 px-4 pt-16">
          {enlaces.map((e) => (
            <SheetClose asChild key={e.href}>
              <Link
                href={e.href}
                className="flex min-h-12 items-center border-b border-line-subtle text-[17px] font-semibold"
              >
                {e.texto}
              </Link>
            </SheetClose>
          ))}
          <SheetClose asChild>
            <Link href="/login" className="flex min-h-12 items-center text-[17px] font-semibold text-fg-muted">
              Ingresar
            </Link>
          </SheetClose>
        </nav>
        {/* El clic sube hasta aquí: cierra el panel mientras el botón abre el modal de ventas. */}
        <div className="mt-auto grid gap-3 border-t border-line-subtle p-4" onClick={() => setAbierto(false)}>
          <BotonVentas motivo="ventas">Hablar con ventas</BotonVentas>
        </div>
      </SheetContent>
    </Sheet>
  );
}
