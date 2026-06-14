/**
 * Estado de carga de períodos de cobro (UX_STRATEGY §6.1): skeleton de tabla que
 * preserva el layout para que no salte al cargar.
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

export default function CargandoPeriodos() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <Skeleton className="h-8 w-56" />
      <DataTable toolbar={<Skeleton className="h-4 w-28" />}>
        <Table densidad="compact">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="px-4">Seller</TableHead>
              <TableHead className="hidden px-4 sm:table-cell">Período</TableHead>
              <TableHead className="px-4">Estado</TableHead>
              <TableHead className="hidden px-4 text-right md:table-cell">Monto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 8 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell className="px-4">
                  <Skeleton className="h-4 w-32" />
                </TableCell>
                <TableCell className="hidden px-4 sm:table-cell">
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                <TableCell className="px-4">
                  <Skeleton className="h-5 w-20 rounded-full" />
                </TableCell>
                <TableCell className="hidden px-4 text-right md:table-cell">
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
