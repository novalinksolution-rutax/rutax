/**
 * Estado de carga de la bandeja de revisión de pagos (UX_STRATEGY §6.1):
 * skeleton de tabla que preserva el layout para que no salte al cargar.
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

export default function CargandoCobranza() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <DataTable>
        <Table densidad="compact">
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="px-4">Fecha</TableHead>
              <TableHead className="px-4 text-right">Monto</TableHead>
              <TableHead className="px-4">Contraparte</TableHead>
              <TableHead className="hidden px-4 sm:table-cell">Seller</TableHead>
              <TableHead className="px-4">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 6 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell className="px-4">
                  <Skeleton className="h-4 w-24" />
                </TableCell>
                <TableCell className="px-4 text-right">
                  <Skeleton className="ml-auto h-4 w-20" />
                </TableCell>
                <TableCell className="px-4">
                  <Skeleton className="h-4 w-40" />
                </TableCell>
                <TableCell className="hidden px-4 sm:table-cell">
                  <Skeleton className="h-4 w-28" />
                </TableCell>
                <TableCell className="px-4">
                  <Skeleton className="h-5 w-20 rounded-md" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DataTable>
    </div>
  );
}
