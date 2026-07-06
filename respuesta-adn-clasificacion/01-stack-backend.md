# 1. Stack del backend

> Todo verificado contra `package.json`, `supabase/migrations/` y `src/`. No es de memoria.

## Lenguaje / framework
- **TypeScript end-to-end** (TS 5, `tsc --noEmit` para typecheck).
- **Next.js 16** (App Router, React 19) — tanto frontend como backend viven en el mismo
  proyecto. La lógica de servidor corre como **Server Actions** (`actions.ts` por ruta) y
  **Route Handlers** (`src/app/api/**`). No hay un backend separado.
- UI: **Tailwind CSS 4** + **shadcn/ui** (Radix) + lucide-react + sonner. Validación con **zod**.

## Base de datos
- **PostgreSQL gestionado por Supabase** (Postgres + Auth + Storage + RLS + funciones).
- **Row-Level Security (RLS)** como mecanismo de aislamiento — el contrato multi-tenant se
  impone **en la base de datos**, no solo en la app. Toda tabla de negocio lleva `tenant_id`.
- Esquema organizado en 4 **schemas Postgres**: `identidad`, `operacion`, `dinero`, `infra`.
- Migraciones versionadas e idempotentes en `supabase/migrations/` (Supabase CLI). Nada de
  DDL crudo fuera de migraciones.

## Infra / hosting
- **Vercel** (app Next.js) + **Supabase** (Postgres/Auth/Storage).
- Jobs en segundo plano con **Inngest** (`inngest` v4, `src/lib/inngest/`, endpoint en
  `src/app/api/inngest/route.ts`). Procesos pesados (ingesta, facturación, liquidación,
  conciliación, refresco de tokens) corren como **jobs idempotentes con reintentos**, no en
  el request del usuario.
- CI en GitHub Actions (`.github/workflows/ci.yml`).

## Mono- vs micro-servicios
- **Monolito modular**, decisión dura del proyecto: *no microservicios, no colas propias, no
  IA, no optimizadores de ruteo en el MVP*.
- Límites de módulos claros (carpeta `src/modules/`): `identidad`, `operacion`, `dinero`,
  `integraciones`. El núcleo **no llama APIs externas directo**: cada integración (ML, DTE,
  pagos) es un **adaptador aislado** ("un puerto por servicio").

## Cómo corre hoy
- **Dev:** `npm run dev` (Next.js).
- **Build:** `npm run build` · **Lint:** `npm run lint` · **Typecheck:** `npm run typecheck`.
- **Tests:** `npm test` (Vitest, pruebas unitarias de servidor que conviven como `*.test.ts`
  junto a su código). Aislamiento RLS probado aparte con **pgTAP** (`supabase/tests/database/`,
  `npx supabase test db`).
- **Entorno local/staging:** Supabase local + seed de demo (`supabase/seed.sql`, un solo tenant)
  + Inngest Dev Server. Guía completa en `docs/PRUEBA.md`.
- Estado de pruebas: el MVP está verificado end-to-end con datos de demo (ver
  `checklist-pruebas-funcionales-mvp.md`).

### Snapshot de dependencias (package.json)
- Runtime: `next@16`, `react@19`, `@supabase/ssr`, `@supabase/supabase-js`, `inngest@4`,
  `zod@4`, `radix-ui`, `tailwind-merge`, `class-variance-authority`, `sonner`, `lucide-react`.
- Dev: `typescript@5`, `vitest@4`, `@vitest/coverage-v8`, `eslint@9`, `tailwindcss@4`.
