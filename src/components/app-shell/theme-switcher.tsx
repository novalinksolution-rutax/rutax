"use client"

/**
 * Conmutador de tema (light/dark/system) — mapea 1:1 a `next-themes`, según el
 * ADN de Retell (§J: menú de cuenta → submenú flyout de tema con checkmark en la
 * activa). Se expone como un SUBMENÚ para incrustar dentro de cualquier
 * `DropdownMenu` (menú de cuenta del courier, del seller y del admin).
 *
 * Guarda de montaje: antes de hidratar, `theme` es indefinido; para no pintar un
 * checkmark equivocado (mismatch de hidratación) se difiere la selección hasta
 * `mounted`.
 */

import { useTheme } from "next-themes"
import { Monitor, MoonStar, Sun } from "lucide-react"

import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"

const OPCIONES = [
  { valor: "light", etiqueta: "Claro", icono: Sun },
  { valor: "dark", etiqueta: "Oscuro", icono: MoonStar },
  { valor: "system", etiqueta: "Sistema", icono: Monitor },
] as const

export function SubmenuTema() {
  const { theme, setTheme } = useTheme()
  // El submenú solo se monta al abrir el menú de cuenta (post-hidratación), así
  // que `theme` ya está resuelto — no hace falta guarda de montaje.
  const actual = theme ?? "system"
  const IconoActual = OPCIONES.find((o) => o.valor === actual)?.icono ?? Sun

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <IconoActual className="text-muted-foreground" aria-hidden="true" />
        Tema
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={actual} onValueChange={setTheme}>
          {OPCIONES.map(({ valor, etiqueta, icono: Icono }) => (
            <DropdownMenuRadioItem key={valor} value={valor} className="pr-8 pl-1.5">
              <Icono className="text-muted-foreground" aria-hidden="true" />
              {etiqueta}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
