# Evidencia estructurada del copiloto

Esta carpeta contiene la capa auditable que alimenta la recuperación histórica
y documental. Se regenera con:

```powershell
.\.venv\Scripts\python.exe scripts\build_copilot_evidence.py
```

## Artefactos

- `document_chunks.jsonl`: fragmentos con fuente, autoridad, territorio, temas,
  vigencia y checksum.
- `historical_loads.jsonl`: viajes facturados elegibles con ruta dirigida,
  costo, venta all-in, variables operativas y fechas de disponibilidad.
- `historical_summaries.jsonl`: cálculos internos por nivel de comparación.
- `sales_historical_summaries.jsonl`: traducción comercial de costo, venta,
  utilidad y margen.
- `document_coverage.json`: cobertura temática y vigencia.
- `historical_audit.json`: exclusiones y contrato point-in-time.
- `schema.json`: campos mínimos por tipo de registro.
- `manifest.json`: versiones, conteos, procedencia y checksums.

## Contrato histórico

Una fila sólo puede explicar una cotización cuando
`cost_available_at < quote_timestamp`. El costo realizado de la cotización que
se explica nunca se utiliza. La ruta inversa tampoco se considera coincidencia
exacta.

El costo, la venta all-in y el margen se muestran en la interfaz interna. El
margen se recalcula en la capa derivada como:

```text
margen_importe = venta_all_in - costo
margen_porcentaje = margen_importe / venta_all_in × 100
```

Una venta ausente, cero o negativa no participa en los resúmenes de margen. Un
margen negativo sí se conserva y se marca.

## Confidencialidad

Los registros históricos son internos. El paquete enviado a OpenAI contiene
resúmenes por ruta, variables operativas desidentificadas e IDs de evidencia;
no contiene clientes, proveedores ni filas completas.

Los accesoriales están excluidos. La tarifa all-in se trata como un valor total
histórico y no se desglosan cargos posteriores.

Los PDF de CAPUFE/FONADIN se estructuran por página, periodo y clase vehicular.
Las tarifas vencidas sólo pueden citarse como referencia histórica.

Los documentos editoriales se mantienen en Markdown dentro de
`rag/documents/`.

## Índice semántico

Los vectores se generan fuera del flujo de cotización con
`scripts/build_document_embeddings.py`. El índice vigente contiene 399
fragmentos con `text-embedding-3-small`; sus rutas y conteos quedan registrados
en `manifest.json`.

El constructor aborta antes de llamar a OpenAI si supera 500 fragmentos o
150,000 tokens de entrada. En operación, las consultas semánticas tienen una
cuota diaria independiente y, si se agota, la búsqueda textual local continúa.
