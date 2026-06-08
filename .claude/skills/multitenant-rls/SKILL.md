---
name: multitenant-rls
description: Patrones para aislar datos en una aplicación multi-tenant con PostgreSQL y Row-Level Security — tenant_id en cada tabla, políticas RLS por courier, alcances del seller y del conductor, y cómo probar el aislamiento. Úsala al diseñar o modificar el esquema o las políticas de acceso.
---
# Multi-tenant con RLS en Postgres

## Principio
El aislamiento se impone EN LA BASE DE DATOS, no solo en la aplicación. Una falla en el código no debe poder filtrar datos de otro tenant.

## Patrones
- Toda tabla de negocio lleva una columna tenant_id (el courier). Indexa por tenant_id.
- Activa RLS en cada tabla (ENABLE ROW LEVEL SECURITY) y crea políticas que filtren por el tenant_id del usuario autenticado (obtenido del contexto de sesión / claims del JWT, según Supabase).
- Define políticas separadas por operación (SELECT/INSERT/UPDATE/DELETE) cuando los permisos difieran por rol.

## Alcances adicionales dentro del tenant
- Seller: solo sus propias filas (sus envíos, sus incidencias, sus facturas). Nunca otros sellers ni datos internos del courier (márgenes, liquidaciones de conductores).
- Conductor: solo sus propias rutas y su liquidación.
Modela estos alcances con columnas (seller_id, driver_id) y políticas RLS específicas, además del tenant_id.

## Datos sensibles
Certificados y tokens van cifrados y, idealmente, en tablas/almacenamiento separados de los datos de negocio, con acceso aún más restringido.

## Pruebas (no opcional)
Para cada cambio, incluye pruebas que demuestren:
- Un usuario del tenant A no puede leer/escribir filas del tenant B.
- Un seller no ve datos de otro seller ni internos del courier.
- Un conductor solo ve lo suyo.
Estas pruebas son parte de la definición de hecho de cualquier cambio de esquema.
