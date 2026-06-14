/**
 * Estado de carga de la lista de pedidos (UX_STRATEGY §6.1): filas skeleton con
 * el alto real de la fila para que la tabla no "salte" al llegar los datos.
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

export default function CargandoOperaciones() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-8 w-32" />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-muted/40 px-3 py-2">
            <Skeleton className="h-6 w-10" />
            <Skeleton className="mt-1.5 h-3 w-16" />
          </div>
        ))}
      </div>

      <DataTable toolbar={<Skeleton className="h-4 w-24" />}>
        <Table densidad="compact">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="px-4">Estado</TableHead>
              <TableHead className="px-4">Destinatario</TableHead>
              <TableHead className="hidden px-4 sm:table-cell">Seller</TableHead>
              <TableHead className="hidden px-4 md:table-cell">Fecha</TableHead>
              <TableHead className="px-4">Tipo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell className="px-4">
                  <Skeleton className="h-5 w-20 rounded-full" />
                </TableCell>
                <TableCell className="px-4">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell className="hidden px-4 sm:table-cell">
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell className="hidden px-4 md:table-cell">
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell className="px-4">
                  <Skeleton className="h-5 w-14 rounded-full" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
