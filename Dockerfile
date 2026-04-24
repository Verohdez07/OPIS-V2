# ─── Etapa 1: compilar el frontend con Bun ───────────────────────────────────
FROM oven/bun:1 AS frontend-build
WORKDIR /build

# Instalar dependencias (solo si cambia package.json)
COPY frontend/package.json .
RUN bun install

# Copiar el resto del frontend y compilar
COPY frontend/ .
RUN bun run build

# ─── Etapa 2: imagen de produccion ───────────────────────────────────────────
FROM python:3.13-slim
WORKDIR /app

# Librerias del sistema necesarias para numpy y obspy
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libgomp1 \
        libgfortran5 \
    && rm -rf /var/lib/apt/lists/*

# Instalar dependencias Python
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar el codigo del backend
COPY backend/ .

# Copiar el frontend compilado
COPY --from=frontend-build /build/dist ./frontend_dist/

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
