"use client"

/**
 * Kitchen Sink — galería viva de las primitivas de UI con el ADN de Retell
 * (Fase 4). Muestra cada componente en sus estados (default/hover/focus/
 * disabled/loading/error) para validar el acabado en light y dark de una sola
 * pasada. NO es parte del producto: es una superficie de diseño/QA visual.
 */

import { useState } from "react"
import { useTheme } from "next-themes"
import { Plus, Download, Trash2, ChevronDown, Search, Sun, MoonStar, Monitor } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Interruptor } from "@/components/ui/interruptor"
import { NavInferior } from "@/components/app-shell/nav-inferior"
import { TablaFinanciera } from "@/components/ui/tabla-financiera"
import { BloqueComposicion } from "@/components/ui/bloque-composicion"
import { destinosMovil } from "@/components/app-shell/destinos-movil"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
  CardAction,
} from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { MontoCLP } from "@/components/ui/monto-clp"
import { BadgeEstado } from "@/components/ui/badge-estado"
import { BarraCajones } from "@/components/ui/barra-cajones"
import { BarraSeleccion } from "@/components/ui/barra-seleccion"
import { FranjaCambiosPendientes, MarcadorFilaActualizada } from "@/components/ui/cambios-pendientes"
import { KpiCard } from "@/components/ui/kpi-card"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { DataTable } from "@/components/ui/data-table"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { GraficoLinea, GraficoDona, GraficoBarras } from "@/components/ui/chart"
import { SemaforoCumplimiento } from "@/components/ui/semaforo-cumplimiento"
import { formatearCLP } from "@/lib/ui/formato-moneda"
import { Package, Truck as TruckIcon, Wallet, TriangleAlert } from "lucide-react"

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{titulo}</h2>
      {children}
    </section>
  )
}

function Muestra({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-4">
      <span className="w-full text-xs text-muted-foreground sm:w-32 sm:shrink-0">{nombre}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}

const SWATCHES: { nombre: string; clase: string; borde?: boolean }[] = [
  { nombre: "background", clase: "bg-background", borde: true },
  { nombre: "foreground", clase: "bg-foreground" },
  { nombre: "primary", clase: "bg-primary" },
  { nombre: "brand (navy)", clase: "bg-brand" },
  { nombre: "secondary", clase: "bg-secondary", borde: true },
  { nombre: "muted", clase: "bg-muted", borde: true },
  { nombre: "accent", clase: "bg-accent", borde: true },
  { nombre: "success", clase: "bg-success" },
  { nombre: "warning", clase: "bg-warning" },
  { nombre: "destructive", clase: "bg-destructive" },
  { nombre: "info", clase: "bg-info" },
  { nombre: "success-subtle", clase: "bg-success-subtle" },
  { nombre: "warning-subtle", clase: "bg-warning-subtle" },
  { nombre: "destructive-subtle", clase: "bg-destructive-subtle" },
  { nombre: "info-subtle", clase: "bg-info-subtle" },
]

export default function KitchenSinkPage() {
  const { setTheme } = useTheme()
  const [cajonActivo, setCajonActivo] = useState<string | null>(null)
  const [cobroAuto, setCobroAuto] = useState(true)
  const [disponible, setDisponible] = useState(false)

  return (
    <div className="min-h-svh bg-background text-foreground">
      <div className="mx-auto max-w-4xl space-y-12 px-6 py-10">
        {/* Encabezado + toggle de tema */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
          <div>
            <h1 className="text-2xl font-semibold">Kitchen Sink</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Primitivas con el ADN de Retell — valida acabado y estados en light y dark.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border p-1">
            <Button variant="ghost" size="icon-sm" onClick={() => setTheme("light")} aria-label="Tema claro">
              <Sun />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setTheme("dark")} aria-label="Tema oscuro">
              <MoonStar />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setTheme("system")} aria-label="Tema del sistema">
              <Monitor />
            </Button>
          </div>
        </header>

        {/* Tokens de color */}
        <Seccion titulo="Color · tokens">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
            {SWATCHES.map((s) => (
              <div key={s.nombre} className="space-y-1.5">
                <div
                  className={`h-14 w-full rounded-lg ${s.clase} ${s.borde ? "border border-border" : ""}`}
                />
                <p className="text-xs text-muted-foreground">{s.nombre}</p>
              </div>
            ))}
          </div>
        </Seccion>

        {/* Patrones de dominio (Fase 5) */}
        <Seccion titulo="Dominio · KPI cards">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label="Entregas hoy" valor="128" hint="vs. 96 ayer" icono={Package} tendencia="sube" />
            <KpiCard label="Por cobrar" valor={<MontoCLP monto={1284500} />} hint="3 períodos abiertos" icono={Wallet} tendencia="estable" />
            <KpiCard label="Por liquidar" valor={<MontoCLP monto={742300} />} hint="12 conductores" icono={TruckIcon} tendencia="baja" />
            <KpiCard label="Incidencias" valor="4" hint="1 sin gestión +4h" icono={TriangleAlert} />
          </div>
        </Seccion>

        <Seccion titulo="Sistema nuevo · Bloque 3 · tablas">
          <div className="space-y-6">
            <BarraCajones
              activo={cajonActivo}
              onSeleccionar={setCajonActivo}
              total={247}
              cajones={[
                { clave: "sin_asignar", etiqueta: "Sin asignar", conteo: 38 },
                { clave: "asignado", etiqueta: "Asignado", conteo: 62 },
                { clave: "en_ruta", etiqueta: "En ruta", conteo: 91 },
                { clave: "entregado", etiqueta: "Entregado", conteo: 44 },
                { clave: "con_problemas", etiqueta: "Con problemas", conteo: 3 },
              ]}
              excluido={{ clave: "cancelado", etiqueta: "Cancelado", conteo: 9 }}
            />

            <FranjaCambiosPendientes cantidad={7} onIncorporar={() => {}} />

            <div className="rounded-ctrl border border-line">
              <MarcadorFilaActualizada activo>
                <div className="px-3 py-2 text-[13.5px]">
                  M. Fuentes Aravena · <span className="rx-num text-fg-muted">RX-7K2M-9PQR</span> ·
                  Ñuñoa <span className="text-fg-subtle">— cambió hace 3 s</span>
                </div>
              </MarcadorFilaActualizada>
              <MarcadorFilaActualizada activo={false}>
                <div className="px-3 py-2 text-[13.5px] text-fg-muted">
                  R. Cárcamo Díaz · <span className="rx-num">RX-4B8N-2XQL</span> · Maipú
                </div>
              </MarcadorFilaActualizada>
            </div>

            <BarraSeleccion
              cantidad={30}
              onLimpiar={() => {}}
              composicion={[
                { etiqueta: "4 comunas" },
                { etiqueta: "2 sellers" },
                { etiqueta: "6 ya son de otro conductor", alerta: true },
              ]}
            >
              <Button size="sm">Asignar a conductor</Button>
            </BarraSeleccion>
          </div>
        </Seccion>

        <Seccion titulo="Dominio · BadgeEstado (punto + texto)">
          <Muestra nombre="Pedido">
            {/* Estas cinco declaran su `eje` y su `valor`, así que reciben las
                correcciones del sistema de diseño en vez de la traducción
                mecánica: "Pendiente de asignación" baja de ámbar a neutro —el
                punto de partida de todo pedido no es una advertencia— y
                "Cancelado" sube a `inert` con su trama, que es lo que lo
                distingue de un vacío cuando no hay color. */}
            <BadgeEstado variante="warning" texto="Pendiente de asignación" eje="pedido" valor="pendiente_asignacion" />
            <BadgeEstado variante="info" texto="En ruta" eje="pedido" valor="en_ruta" />
            <BadgeEstado variante="success" texto="Entregado" eje="pedido" valor="entregado" />
            <BadgeEstado variante="error" texto="Fallido" eje="pedido" valor="fallido" />
            <BadgeEstado variante="neutral" texto="Cancelado" eje="pedido" valor="cancelado" />
          </Muestra>
          <Muestra nombre="Dinero / DTE">
            <BadgeEstado variante="info" texto="Abierto" />
            <BadgeEstado variante="success" texto="Facturado — Folio 1042" />
            <BadgeEstado variante="error" texto="Rechazado por SII" />
          </Muestra>
        </Seccion>

        <Seccion titulo="Dominio · MontoCLP (mono tabular)">
          <Muestra nombre="Montos">
            <MontoCLP monto={1284500} enfasis />
            <MontoCLP monto={0} />
            <MontoCLP monto={null} />
            <MontoCLP monto={-45000} />
            <MontoCLP monto={12000} conSigno />
            <MontoCLP monto={-8000} conSigno />
          </Muestra>
        </Seccion>

        <Seccion titulo="Dominio · Charts (Recharts + tokens)">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Entregas por día</CardTitle>
                <CardDescription>Últimos 7 días · comprometido vs entregado</CardDescription>
              </CardHeader>
              <CardContent>
                <GraficoLinea
                  ejeX="dia"
                  series={[
                    { clave: "comprometido", etiqueta: "Comprometido" },
                    { clave: "entregado", etiqueta: "Entregado" },
                  ]}
                  datos={[
                    { dia: "Lun", comprometido: 120, entregado: 112 },
                    { dia: "Mar", comprometido: 98, entregado: 96 },
                    { dia: "Mié", comprometido: 140, entregado: 128 },
                    { dia: "Jue", comprometido: 132, entregado: 130 },
                    { dia: "Vie", comprometido: 160, entregado: 149 },
                    { dia: "Sáb", comprometido: 90, entregado: 88 },
                    { dia: "Dom", comprometido: 40, entregado: 39 },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Cobros por seller</CardTitle>
                <CardDescription>Período julio 2026</CardDescription>
              </CardHeader>
              <CardContent>
                <GraficoDona
                  formato={formatearCLP}
                  datos={[
                    { nombre: "Tienda Norte", valor: 620000 },
                    { nombre: "Boutique Sur", valor: 410000 },
                    { nombre: "Kiosco Centro", valor: 254500 },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Entregas por comuna</CardTitle>
                <CardDescription>
                  Barras horizontales: entre dos comunas no hay camino, así que una línea
                  dibujaría una relación que no existe
                </CardDescription>
              </CardHeader>
              <CardContent>
                <GraficoBarras
                  ejeCategoria="comuna"
                  series={[{ clave: "entregas", etiqueta: "Entregas" }]}
                  datos={[
                    { comuna: "Puente Alto", entregas: 142 },
                    { comuna: "Maipú", entregas: 118 },
                    { comuna: "La Florida", entregas: 96 },
                    { comuna: "Las Condes", entregas: 61 },
                    { comuna: "Lo Barnechea", entregas: 24 },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Semáforo de cumplimiento</CardTitle>
                <CardDescription>
                  La cifra no se puede leer sin su objetivo, y «sin datos» va en neutro
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <SemaforoCumplimiento pct={98.4} objetivo={97} conBarra />
                <SemaforoCumplimiento pct={94.2} objetivo={97} conBarra />
                <SemaforoCumplimiento pct={81.0} objetivo={97} conBarra />
                <SemaforoCumplimiento pct={null} objetivo={97} />
              </CardContent>
            </Card>
          </div>
        </Seccion>

        <Seccion titulo="Dominio · DataTable + estados">
          <DataTable
            toolbar={
              <>
                <span className="text-sm font-medium">3 pedidos</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm">
                    <Search /> Filtrar
                  </Button>
                  <Button size="sm">
                    <Plus /> Same-day
                  </Button>
                </div>
              </>
            }
            footer={<span className="text-xs text-muted-foreground">Página 1 de 1 · 3 resultados</span>}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pedido</TableHead>
                  <TableHead>Seller</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Cobro</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  { id: "FLEX-1042", seller: "Tienda Norte", v: "success" as const, e: "Entregado", monto: 3500 },
                  { id: "SD-0087", seller: "Boutique Sur", v: "info" as const, e: "En ruta", monto: 4200 },
                  { id: "FLEX-1039", seller: "Tienda Norte", v: "error" as const, e: "Fallido", monto: 0 },
                ].map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id}</TableCell>
                    <TableCell>{r.seller}</TableCell>
                    <TableCell>
                      <BadgeEstado variante={r.v} texto={r.e} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MontoCLP monto={r.monto} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </DataTable>
          <p className="text-xs text-muted-foreground">Estado de carga (TableSkeleton):</p>
          <DataTable>
            <TableSkeleton anchos={[3, 2, 2, 1]} filas={4} />
          </DataTable>
        </Seccion>

        {/* Botones */}
        <Seccion titulo="Button">
          <Muestra nombre="Variantes">
            <Button>Primario</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secundario</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructivo</Button>
            <Button variant="link">Enlace</Button>
          </Muestra>
          <Muestra nombre="Con ícono / caret">
            <Button>
              <Plus /> Nuevo
            </Button>
            <Button variant="outline">
              <Download /> Importar
            </Button>
            <Button>
              Crear <ChevronDown />
            </Button>
          </Muestra>
          <Muestra nombre="Tamaños">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button size="icon" aria-label="Buscar">
              <Search />
            </Button>
          </Muestra>
          <Muestra nombre="Estados">
            <Button loading>Guardando</Button>
            <Button disabled>Deshabilitado</Button>
            <Button variant="destructive">
              <Trash2 /> Eliminar
            </Button>
          </Muestra>
        </Seccion>

        {/* Badges */}
        <Seccion titulo="Badge (chip, no pill)">
          <Muestra nombre="Estado (subtle)">
            <Badge variant="success">Entregado</Badge>
            <Badge variant="warning">En ruta</Badge>
            <Badge variant="error">Fallido</Badge>
            <Badge variant="info">Informativo</Badge>
          </Muestra>
          <Muestra nombre="Con punto de color">
            <Badge variant="success">
              <span className="size-1.5 rounded-full bg-success" /> Conciliado
            </Badge>
            <Badge variant="warning">
              <span className="size-1.5 rounded-full bg-warning" /> Pendiente
            </Badge>
            <Badge variant="neutral">
              <span className="size-1.5 rounded-full bg-muted-foreground" /> Borrador
            </Badge>
          </Muestra>
          <Muestra nombre="Neutras">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="neutral">Neutral</Badge>
            <Badge variant="outline">Outline</Badge>
          </Muestra>
        </Seccion>

        {/* Formularios */}
        <Seccion titulo="Formulario">
          <div className="grid gap-4 rounded-lg border border-border bg-card p-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="ks-nombre">Nombre</Label>
              <Input id="ks-nombre" placeholder="Ej. Andes Última Milla" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ks-rut">RUT (con error)</Label>
              <Input id="ks-rut" defaultValue="12.345.678-0" aria-invalid />
              <p className="text-xs text-destructive">RUT inválido. Verifica el dígito verificador.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ks-comuna">Comuna</Label>
              <Select>
                <SelectTrigger id="ks-comuna">
                  <SelectValue placeholder="Selecciona una comuna" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="providencia">Providencia</SelectItem>
                  <SelectItem value="las-condes">Las Condes</SelectItem>
                  <SelectItem value="santiago">Santiago</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ks-disabled">Deshabilitado</Label>
              <Input id="ks-disabled" placeholder="No editable" disabled />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="ks-nota">Nota</Label>
              <Textarea id="ks-nota" placeholder="Escribe una nota…" />
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox id="ks-check" defaultChecked />
              <Label htmlFor="ks-check">Acepto emitir la factura al cierre del período</Label>
            </div>
          </div>
        </Seccion>

        {/* Tabla financiera · bloque 5. Los datos son los del tablero B2a. */}
        <Seccion titulo="Sistema nuevo · Bloque 5 · tabla financiera">
          <div className="rounded-lg border border-border bg-card p-4">
            <TablaFinanciera
              rotulo="neto"
              filas={[
                { tipo: "linea", concepto: "Entrega same-day · Ñuñoa", entregas: 184, tarifa: 2900, monto: 533600 },
                { tipo: "linea", concepto: "Entrega same-day · Puente Alto", entregas: 97, tarifa: 3400, monto: 329800 },
                { tipo: "linea", concepto: "Recargo por reprogramación", entregas: 3, tarifa: 1200, monto: 3600 },
                { tipo: "subtotal", concepto: "Subtotal de entregas", entregas: 284, monto: 867000 },
                { tipo: "ajuste", concepto: "Ajuste · bulto dañado", monto: -2900, causa: { texto: "incidencia RX-5M7T", href: "#" } },
                { tipo: "ajuste", concepto: "Mínimo de facturación no alcanzado", monto: -3600 },
                { tipo: "total", concepto: "Total del período", entregas: 285, monto: 864100 },
              ]}
            />
            <div className="mt-3 border-t border-border pt-3">
              <BloqueComposicion
                sumandos={[
                  { concepto: "entregas", monto: 867000 },
                  { concepto: "recargos", monto: 3600 },
                  { concepto: "ajustes", monto: 2900, resta: true },
                  { concepto: "mínimo no aplicado", monto: 3600, resta: true },
                ]}
              />
            </div>
          </div>
        </Seccion>

        {/* Barra inferior · bloque 4. Solo se ve por debajo de `lg`: es fija y
            vive al pie de la ventana, como en el producto. */}
        <Seccion titulo="Sistema nuevo · Bloque 4 · navegación inferior (solo &lt;1024px)">
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            Reduce la ventana bajo 1024&nbsp;px para verla al pie. Los cuatro destinos salen del rol:
            estos son los de quien coordina.
          </div>
          <NavInferior
            items={destinosMovil([
              { href: "/torre-de-control", etiqueta: "Torre", icono: "torre-de-control" },
              { href: "/preparacion", etiqueta: "Preparación", icono: "preparacion" },
              { href: "/operaciones", etiqueta: "Pedidos", icono: "pedidos" },
              { href: "/manifiestos", etiqueta: "Manifiestos", icono: "manifiestos" },
              { href: "/operaciones/incidencias", etiqueta: "Incidencias", icono: "incidencias", contador: 3 },
            ])}
            hrefActivo="/operaciones"
          />
        </Seccion>

        {/* Interruptor · bloque 1 del rediseño, el único de cero de ese bloque */}
        <Seccion titulo="Sistema nuevo · Bloque 1 · interruptor">
          <div className="space-y-4 rounded-lg border border-border bg-card p-4">
            <Interruptor
              etiqueta="Cobro automático"
              consecuencia={{
                encendido: "Te cobramos el plan el día 5 de cada mes.",
                apagado: "Nadie te va a cobrar: tienes que pagar a mano cada mes.",
              }}
              checked={cobroAuto}
              onCheckedChange={setCobroAuto}
            />
            <Interruptor
              etiqueta="Disponible hoy"
              consecuencia={{
                encendido: "Entras al reparto de las 16:00 y puedes recibir pedidos.",
                apagado: "No recibes asignaciones nuevas. Las que ya tienes siguen siendo tuyas.",
              }}
              checked={disponible}
              onCheckedChange={setDisponible}
            />
            <Interruptor
              etiqueta="Bloquea la facturación"
              motivoDeshabilitado="Solo Administración puede cambiar las banderas de una excepción."
              checked={true}
            />
            <Interruptor
              etiqueta="Notificar al conductor"
              consecuencia={{
                encendido: "Le llega un aviso cuando su ruta queda lista.",
                apagado: "No le llega nada; lo ve al abrir la app.",
              }}
              checked={true}
              cargando
            />
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <span className="text-xs text-muted-foreground">Suelto, sin etiqueta</span>
              <Interruptor aria-label="Ejemplo suelto" defaultChecked />
              <Interruptor aria-label="Ejemplo suelto apagado" />
            </div>
          </div>
        </Seccion>

        {/* Cards */}
        <Seccion titulo="Card">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Período julio 2026</CardTitle>
                <CardDescription>Abierto · 128 entregas conciliadas</CardDescription>
                <CardAction>
                  <Badge variant="warning">Abierto</Badge>
                </CardAction>
              </CardHeader>
              <CardContent className="text-muted-foreground">
                Por cobrar <span className="font-mono font-medium text-foreground tabular-nums">$1.284.500</span>
              </CardContent>
              <CardFooter>
                <Button size="sm">Emitir facturas</Button>
              </CardFooter>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>KPI inset</CardTitle>
                <CardDescription>Ejemplo de card compacta</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg bg-muted/50 p-4 text-center">
                  <p className="font-mono text-3xl font-semibold tabular-nums">128</p>
                  <p className="mt-1 text-xs text-muted-foreground">entregas hoy</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </Seccion>

        {/* Tabs + Alert */}
        <Seccion titulo="Tabs · Alert">
          <Tabs defaultValue="cobros">
            <TabsList>
              <TabsTrigger value="cobros">Cobros</TabsTrigger>
              <TabsTrigger value="uso">Uso</TabsTrigger>
            </TabsList>
            <TabsContent value="cobros" className="pt-3 text-sm text-muted-foreground">
              Historial de cobros del período.
            </TabsContent>
            <TabsContent value="uso" className="pt-3 text-sm text-muted-foreground">
              Detalle de uso.
            </TabsContent>
          </Tabs>
          <Alert>
            <AlertTitle>Certificado por vencer</AlertTitle>
            <AlertDescription>
              Tu certificado digital vence en 12 días. Renuévalo para no interrumpir la facturación.
            </AlertDescription>
          </Alert>
        </Seccion>

        {/* Overlays */}
        <Seccion titulo="Overlays · feedback">
          <Muestra nombre="Dialog / Sheet / Tooltip / Toast">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Abrir diálogo</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Emitir facturas del período</DialogTitle>
                  <DialogDescription>
                    Vas a emitir 3 facturas por $1.284.500 a 3 sellers. Esta acción es irreversible.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="ghost">Cancelar</Button>
                  </DialogClose>
                  <Button>Emitir</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Abrir drawer</Button>
              </SheetTrigger>
              <SheetContent side="right">
                <SheetTitle>Detalle del pedido</SheetTitle>
                <p className="mt-2 text-sm text-muted-foreground">
                  Aquí vive el detalle de una fila sin salir de la tabla.
                </p>
              </SheetContent>
            </Sheet>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost">Con tooltip</Button>
              </TooltipTrigger>
              <TooltipContent>El POD de Flex es la verdad; esto es informativo.</TooltipContent>
            </Tooltip>

            <Button variant="secondary" onClick={() => toast.success("Factura emitida", { description: "3 facturas por $1.284.500." })}>
              Lanzar toast
            </Button>
          </Muestra>
        </Seccion>

        {/* Varios */}
        <Seccion titulo="Skeleton · Progress · Avatar · Separator">
          <div className="space-y-4 rounded-lg border border-border bg-card p-5">
            <div className="space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-4 w-52" />
            </div>
            <Separator />
            <Progress value={68} />
            <div className="flex items-center gap-2">
              <Avatar size="sm">
                <AvatarFallback>JR</AvatarFallback>
              </Avatar>
              <Avatar>
                <AvatarFallback>AM</AvatarFallback>
              </Avatar>
              <Avatar size="lg">
                <AvatarFallback>CO</AvatarFallback>
              </Avatar>
            </div>
          </div>
        </Seccion>
      </div>
    </div>
  )
}
