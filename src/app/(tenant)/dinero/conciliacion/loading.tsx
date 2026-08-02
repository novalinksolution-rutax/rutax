/**
 * Estado de carga de la bandeja de conciliación (UX_STRATEGY §6.1): skeleton de
 * tabla que preserva el layout para que no salte al cargar.
 */
import { Skeleton } from "@/components/ui/skeleton";
import { DataTable } from "@/components/ui/data-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function CargandoConciliacion() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-44" />
      {/* Chips de resumen */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-28 rounded-md" />
        ))}
      </div>
      <DataTable toolbar={<Skeleton className="h-4 w-28" />}>
        <Table densidad="compact">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="px-4">Categoría / Tipo</TableHead>
              <TableHead className="hidden px-4 sm:table-cell">Estado</TableHead>
              <TableHead className="hidden px-4 md:table-cell">Vence</TableHead>
              <TableHead className="hidden px-4 xl:table-cell text-right">Diferencia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell className="px-4">
                  <Skeleton className="h-4 w-40" />
                </TableCell>
                <TableCell className="hidden px-4 sm:table-cell">
                  <Skeleton className="h-5 w-20 rounded-md" />
                </TableCell>
                <TableCell className="hidden px-4 md:table-cell">
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell className="hidden px-4 text-right xl:table-cell">
                  <Skeleton className="ml-auto h-4 w-20" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
