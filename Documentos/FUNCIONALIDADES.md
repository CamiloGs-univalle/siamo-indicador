# Manual de Funcionalidades — Siamo.Indicador

## Vista General

Siamo.Indicador es un sistema de medición operacional para bodegas que permite:

1. **Medir productividad** de armadores en tiempo real
2. **Gestionar zonas** de trabajo con códigos QR
3. **Generar reportes** con métricas clave
4. **Reconocer** el buen desempeño

---

## 1. Login

### Flujo
1. Ir a `https://siamo-indicador.vercel.app/login`
2. Hacer clic en "Continuar con Google"
3. Seleccionar cuenta de Google
4. Sistema redirige según rol:
   - Super Admin → `/super-admin`
   - Admin → `/admin`
   - Armador → `/armador`

### Credenciales de Prueba
| Rol | Email |
|-----|-------|
| Super Admin | `auxiliar.ti@proservis.com.co` |

---

## 2. Panel Super Administrador

### 2.1 Crear Empresa
1. Ir a `/super-admin`
2. Hacer clic en "+ Nueva empresa"
3. Ingresar nombre (ej. "Coca Cola FEMSA")
4. Ingresar dirección (opcional)
5. Hacer clic en "Crear empresa"

### 2.2 Crear Administrador
1. Seleccionar empresa
2. Hacer clic en "+ Agregar administrador"
3. Ingresar nombre completo
4. Ingresar correo electrónico
5. Seleccionar sector (A o B)
6. Hacer clic en "Crear administrador"

### 2.3 Eliminar Empresa
1. Seleccionar empresa
2. Hacer clic en "Eliminar"
3. Confirmar eliminación

---

## 3. Panel Administrador

### 3.1 Navegación
- Sidebar izquierdo con 8 módulos
- Selector de supervisor (Sector A/B)
- Toggle de tema (claro/oscuro)

### 3.2 Módulo Jornada
**Función**: Crear y gestionar jornadas de trabajo

1. **Crear jornada**:
   - Seleccionar bodega
   - Ingresar fecha
   - Ingresar pedido SAP
   - Seleccionar turno
   - Hacer clic en "Crear jornada"

2. **Ver historial**:
   - Tabla con jornadas recientes
   - Estado: En proceso, Completada

### 3.3 Módulo Carga SAP
**Función**: Importar datos de zonas y productos

1. **Importar archivo**:
   - Arrastrar Excel o hacer clic en "Seleccionar archivo"
   - Formato: Zona, Producto, Cantidad
   - O pegar datos directamente

2. **Vista previa**:
   - Ver zonas importadas
   - Ver productos y cantidades
   - Hacer clic en "Confirmar carga"

3. **Descargar plantilla**:
   - Hacer clic en "Descargar plantilla"
   - Formato Excel compatible

### 3.4 Módulo Asignación
**Función**: Delegar zonas a armadores

1. **Seleccionar armador**:
   - Hacer clic en el armador de la lista izquierda
   - Ver zonas asignadas actualmente

2. **Agregar zona**:
   - Seleccionar armador
   - Hacer clic en zona de la pool de "Zonas sin asignar"
   - Zona se agrega al final de la ruta

3. **Reordenar ruta**:
   - Usar flechas ↑↓ para cambiar orden
   - El orden define la ruta de escaneo

4. **Remover zona**:
   - Hacer clic en ✕ junto a la zona
   - Zona vuelve a la pool

### 3.5 Módulo Mapa
**Función**: Vista en tiempo real del estado de zonas

1. **Filtrar por armador**:
   - Hacer clic en botones de arriba
   - "Todos" muestra todas las zonas
   - Nombre del armador muestra solo sus zonas

2. **Seleccionar zona**:
   - Hacer clic en cualquier zona del mapa
   - Panel derecho muestra detalles

3. **Editar mapa**:
   - Hacer clic en "Editar mapa"
   - Arrastrar zonas para reposicionar
   - Hacer clic en "Listo" para guardar

4. **Ver detalles**:
   - Código de zona
   - Estado actual
   - Armador asignado
   - Pedido SAP
   - Tiempo de inicio/fin
   - Productos organizados

### 3.6 Módulo Indicadores
**Función**: Métricas de productividad

1. **KPIs principales**:
   - Productividad (prod/h)
   - Cumplimiento (%)
   - Tiempo promedio (min/zona)
   - Incidencias

2. **Gráficas**:
   - Tiempo promedio por zona (barras)
   - Productividad por armador (barras horizontales)
   - Incidencias por tipo (barras horizontales)
   - Índice operacional del sector (gauge)

### 3.7 Módulo Desempeño
**Función**: Ranking y reconocimiento

1. **Ranking**:
   - Tabla ordenada por índice operacional
   - Columnas: #, Armador, prod/h, Cumpl., Incid., Retrab., Índice, Tend.

2. **Reconocer armador**:
   - Hacer clic en "Reconocer" junto al armador
   - Se marca como "Reconocido"

3. **Clasificar incidencias**:
   - Seleccionar incidencia
   - Clasificar como:
     - Causa: proceso (no afecta al armador)
     - Causa: persona (retroalimentación)
     - No afecta desempeño (mitigada)

### 3.8 Módulo Reportes
**Función**: Resumen y exportación

1. **Resumen diario**:
   - Armadores activos
   - Zonas procesadas
   - Productos organizados
   - Tiempo promedio
   - Productividad
   - Cumplimiento
   - Incidencias
   - Retrabajos

2. **Exportar**:
   - "Exportar Excel" → Descarga archivo .xlsx
   - "PDF" → Genera reporte con branding

3. **Reporte semanal**:
   - Tabla por día
   - Productos, Cumplimiento, Incidencias

### 3.9 Módulo QR
**Función**: Generación de códigos

1. **Información**:
   - QR es permanente y fijo
   - Solo codifica identificador de zona (ej. `TRZ://zona/Z07`)
   - Pedido y armador cambian sin reimprimir

2. **Descargar**:
   - "Descargar hoja de impresión" → Archivo con todos los QR
   - "Regenerar lote" → Genera nuevos QR

3. **Vista previa**:
   - Grid con QR de cada zona
   - Código y URI debajo

---

## 4. Panel Armador (Móvil)

### 4.1 Recorrido
1. **Ver zona actual**:
   - Código de zona en grande
   - Cronómetro en tiempo real
   - Nombre del armador

2. **Escanear QR**:
   - Hacer clic en "Escanear QR"
   - Apuntar cámara al código
   - Sistema valida si es correcto

3. **Flujo de escaneo**:
   - QR válido → Inicia tiempo zona
   - Siguiente QR → Detiene zona anterior, inicia siguiente
   - Última zona → Aparece "Terminar recorrido"

### 4.2 Mapa
- Mapa del sector con zonas
- Zonas propias en color
- Otras zonas en rojo

### 4.3 Equipo
- Lista de compañeros
- Zonas completadas/total
- Estado (Completado/En progreso)

### 4.4 Yo (Mi Desempeño)
- Índice operacional (0-100)
- Zonas completadas
- Tiempo promedio
- Productos organizados
- Incidencias
- Retrabajos
- Tendencia
- Badges/Logros

---

## 5. Estados de Zona

| Estado | Color | Descripción |
|--------|-------|-------------|
| `idle` | Gris | Sin asignar |
| `assigned` | Azul | Asignada, pendiente |
| `active` | Amarillo | En proceso |
| `done` | Verde | Completada |
| `not` | Rojo | No le corresponde |
| `incident` | Morado | Con incidencia |

---

## 6. Tiempo y Pausas

### Cronómetro
- Inicia con primer escaneo
- Se detiene con siguiente escaneo
- Muestra tiempo total del recorrido

### Pausa de Almuerzo
- Default: 12:00pm - 2:00pm
- Configurable por administrador
- Timer se pausa automáticamente

---

## 7. Reportes

### Exportación Excel
- Resumen diario completo
- Detalle por zona
- Métricas por armador

### Exportación PDF
- Logo de la empresa
- Logo de Coca Cola (para reportes internos)
- Recomendaciones automáticas
- Gráficas de productividad

---

*Manual de funcionalidades para Siamo.Indicador v1.0*
