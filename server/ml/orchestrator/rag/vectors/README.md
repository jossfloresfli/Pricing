# Índice semántico opcional

El copiloto puede funcionar sin archivos en esta carpeta. En ese caso utiliza
recuperación local por palabras, fragmentos y metadatos.

Los embeddings encontrados en el proyecto de origen no se copiaron porque su
checksum corresponde a 399 fragmentos y el corpus incluido contiene 423. El
backend detectaría la diferencia y desactivaría el índice automáticamente.

Para generar un índice compatible:

1. Configurar `OPENAI_API_KEY` en el ambiente.
2. Instalar `requirements-copilot.txt`.
3. Ejecutar desde la raíz del paquete:

```powershell
.\.venv\Scripts\python.exe scripts\build_document_embeddings.py
```

El proceso debe crear:

- `rag/vectors/document_embeddings.npz`
- `rag/vectors/document_embeddings.json`

Después se debe verificar que `source_sha256` en el JSON coincida con el SHA-256
de `rag/structured/document_chunks.jsonl`. Sólo entonces debe configurarse
`COPILOT_SEMANTIC_SEARCH=true`.

La generación consume la API de embeddings y no debe ejecutarse automáticamente
al iniciar el servidor.
