# Importaciones necesarias
import os
import pathlib
import tempfile
import pandas as pd
from typing import Any, Dict, List, Optional

import numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from obspy import read
from pydantic import BaseModel

# ── Crear la aplicacion FastAPI ───────────────────────────────────────────────
app = FastAPI()

# Permitir que el frontend (en otro puerto) pueda hacer peticiones al backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Estado global de la aplicacion ───────────────────────────────────────────
# Aqui guardamos las trazas cargadas, los metadatos y los picks del usuario
estado = {
    "stream": None,  # objeto Stream de obspy con las trazas SAC
    "metadata": [],  # lista con info de cada traza (estacion, canal, etc.)
    "picks": {},  # picks guardados: { "ESTACION": { "P": seg, "S": seg } }
}


# ── Modelos Pydantic (definen el formato del JSON que recibe el backend) ──────
class Entrada(BaseModel):
    estaciones: Dict[str, Any]
    t_origen: int
    
class PickDeEstacion(BaseModel):
    P: Optional[float] = None
    S: Optional[str] = None   # tiempo de llegada S como ISO string, o None
    stla: Optional[float] = None
    stlo: Optional[float] = None
    t_origin: Optional[int] = None


class CuerpoPicks(BaseModel):
    picks: dict[str, PickDeEstacion]


# ── Endpoint: subir archivos SAC ──────────────────────────────────────────────
# El frontend envia hasta 3 archivos .sac
# El backend los lee con obspy y guarda la info en el estado global

@app.post("/upload")
async def subir_archivos(files: List[UploadFile] = File(...)):
    if len(files) == 0:
        raise HTTPException(status_code=400, detail="No se enviaron archivos.")
    if len(files) > 60:
        raise HTTPException(status_code=400, detail="Maximo 60 archivos SAC (20 estaciones x 3 componentes).")

    # Leer cada archivo SAC con obspy usando un archivo temporal
    stream = None
    metadata = []

    for archivo in files:
        contenido = await archivo.read()

        # Guardar en un archivo temporal para que obspy pueda leerlo
        with tempfile.NamedTemporaryFile(suffix=".sac", delete=False) as tmp:
            tmp.write(contenido)
            ruta_tmp = tmp.name

        try:
            st = read(ruta_tmp)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Error leyendo {archivo.filename}: {e}")
        finally:
            os.unlink(ruta_tmp)  # borrar el archivo temporal

        # Agregar cada traza al stream principal
        if stream is None:
            stream = st
        else:
            stream += st

        # Guardar metadatos de cada traza
        for traza in st:
            s = traza.stats
            # stla y stlo son la latitud y longitud de la estacion en el header SAC
            stla = float(getattr(s.get("sac", {}), "stla", 0) or 0)
            stlo = float(getattr(s.get("sac", {}), "stlo", 0) or 0)

            # Intentar obtener coordenadas del header SAC de forma segura
            try:
                stla = float(s.sac.stla)
            except Exception:
                stla = 0.0
            try:
                stlo = float(s.sac.stlo)
            except Exception:
                stlo = 0.0

            metadata.append({
                "station": s.station,
                "network": s.network,
                "channel": s.channel,
                "delta": s.delta,
                "npts": s.npts,
                "starttime": s.starttime.timestamp,
                "stla": stla,
                "stlo": stlo,
            })

    # Guardar en el estado global
    estado["stream"] = stream
    estado["metadata"] = metadata
    estado["picks"] = {}

    return {"traces": metadata}


# ── Endpoint: obtener datos de las trazas para graficar ───────────────────────
# Devuelve arrays de tiempos y amplitudes (reducidos a 10000 puntos como maximo)

@app.get("/traces")
def obtener_trazas():
    if estado["stream"] is None:
        raise HTTPException(status_code=400, detail="No hay trazas cargadas.")

    resultado = {}
    for traza in estado["stream"]:
        estacion = traza.stats.station
        canal = traza.stats.channel
        starttime = float(traza.stats.starttime.timestamp)
        delta = traza.stats.delta
        datos = traza.data.astype(float)
        npts = len(datos)

        MAX_PUNTOS = 10000
        if npts > MAX_PUNTOS:
            paso = npts // MAX_PUNTOS
            datos = datos[::paso]
            npts_reducido = len(datos)
        else:
            paso = 1
            npts_reducido = npts

        # Generar el array de tiempos relativos en segundos desde el inicio de la traza
        tiempos = [i * delta * paso for i in range(npts_reducido)]

        # Clave unica: "ESTACION.CANAL" para que HHE, HHN, HHZ no se pisen
        clave = estacion + "." + canal
        resultado[clave] = {
            "times": tiempos,
            "amplitudes": datos.tolist(),
            "starttime": starttime,
            "delta": delta,
            "channel": canal
        }

    return resultado


# ── Endpoint: guardar picks del usuario ──────────────────────────────────────
# El frontend envia los tiempos P y S para cada estacion

@app.post("/picks")
def guardar_picks(cuerpo: CuerpoPicks):
    # Convertir el modelo Pydantic a un diccionario simple
    estado["picks"] = {
        estacion: {"P": pick.P, "S": pick.S, "stla": pick.stla, "stlo": pick.stlo, "t_origin" : pick.t_origin}
        for estacion, pick in cuerpo.picks.items()
    }
    return {"ok": True}


# ── Funcion auxiliar: leer archivo Poles & Zeros (.PZ) ───────────────────────
# Busca el archivo {ESTACION}.PZ dentro de backend/data/pz/
# y devuelve un diccionario PAZ compatible con obspy

def read_pz_files(station, base_path="data/pz"):
    filename = f"{station}.PZ"
    filepath = os.path.join(base_path, filename)

    if not os.path.exists(filepath):
        raise FileNotFoundError(f"No se encontro archivo PZ para la estacion {station}: {filepath}")

    poles = []
    zeros = []
    constant = None
    mode = None

    with open(filepath, "r") as f:
        lines = f.readlines()

    for line in lines:
        raw_line = line.strip()
        linea = raw_line.lower()

        # Saltar lineas vacias y comentarios
        if not linea or linea.startswith("*"):
            continue

        if "zeros" in linea:
            mode = "zeros"
            continue
        elif "poles" in linea:
            mode = "poles"
            continue
        elif "constant" in linea:
            constant = float(raw_line.split()[-1])
            continue

        parts = raw_line.split()
        if len(parts) < 2:
            continue

        if mode == "zeros":
            zeros.append(complex(float(parts[0]), float(parts[1])))
        elif mode == "poles":
            poles.append(complex(float(parts[0]), float(parts[1])))

    if constant is None:
        raise ValueError(f"No se encontro CONSTANT en el archivo {filepath}")

    return {
        "poles": poles,
        "zeros": zeros,
        "gain": 1.0,
        "sensitivity": constant,
    }


# ── Endpoint: quitar respuesta instrumental ───────────────────────────────────
# Lee los archivos .PZ de cada estacion y aplica la correccion usando obspy.
# Actualiza el stream en el estado global y devuelve las nuevas amplitudes.

from fastapi import HTTPException
import numpy as np

@app.get("/remove_response")
def quitar_respuesta():
    if estado["stream"] is None:
        raise HTTPException(status_code=400, detail="No hay trazas cargadas.")

    stream_corregido = estado["stream"].copy()

    estaciones_sin_pz = []

    for traza in stream_corregido:
        station = traza.stats.station
        channel = traza.stats.channel

        try:
            paz = read_pz_files(station)  # ⚠️ ideal: usar station + channel
        except FileNotFoundError:
            estaciones_sin_pz.append(station)
            continue
        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error leyendo PZ de {station}: {e}"
            )

        try:
            # 🔹 Asegurar tipo correcto
            traza.data = traza.data.astype(np.float64)

            # 🔹 Pre-procesamiento (MUY IMPORTANTE)
            traza.detrend("demean")
            traza.detrend("linear")
            traza.taper(max_percentage=0.05)

            # 🔹 Definir pre_filt según frecuencia de muestreo
            fs = traza.stats.sampling_rate

            if fs >= 100:
                pre_filt = [0.1, 0.2, 25, 40]
            elif fs >= 50:
                pre_filt = [0.05, 0.1, 20, 30]
            else:
                pre_filt = [0.02, 0.05, 10, 20]

            # 🔹 Quitar respuesta instrumental
            traza.simulate(
                paz_remove=paz,
                remove_sensitivity=True,
                pre_filt=pre_filt,
                zero_mean=True,
                taper=True
            )

        except Exception as e:
            raise HTTPException(
                status_code=500,
                detail=f"Error quitando respuesta de {station}.{channel}: {e}"
            )
    # Guardar stream corregido
    estado["stream"] = stream_corregido

    # ── Preparar salida ────────────────────────────────
    resultado = {}
    MAX_PUNTOS = 10000

    for traza in stream_corregido:
        estacion = traza.stats.station
        canal = traza.stats.channel

        datos = traza.data.astype(float)
        npts = len(datos)
        delta = traza.stats.delta
        starttime = float(traza.stats.starttime.timestamp)

        if npts > MAX_PUNTOS:
            paso = npts // MAX_PUNTOS
            datos = datos[::paso]
        else:
            paso = 1

        tiempos = [i * delta * paso for i in range(len(datos))]

        clave = estacion + "." + canal

        resultado[clave] = {
            "times": tiempos,
            "amplitudes": datos.tolist(),
            "starttime": starttime,
            "delta": delta,
            "channel": canal,
        }

    return {
        "traces": resultado,
        "sin_pz": estaciones_sin_pz,
    }
@app.post("/calcular_epicentro")
def calcular_epicentro(data: Entrada):
    estaciones = data.estaciones
    t_origen = data.t_origen
    # Creamos el dataframe
    lista_datos = []
    for nombre, est in estaciones.items():
        if est['P'] is not None:
            lista_datos.append({
                'station': nombre,
                'lat': est['stla'],
                'lon': est['stlo'],
                'p_arrival_seconds': est['P']
            })
    if not lista_datos:
        return {"error":"No hay datos de estaciones válidos"}
    # Definir los límites para la malla, a partir de calcular las lat y lon mínimas y máximas
    estaciones_df = pd.DataFrame(lista_datos)
    lat_min = estaciones_df['lat'].min() - 2.0
    lat_max = estaciones_df['lat'].max() + 2.0
    lon_min = estaciones_df['lon'].min() - 2.0
    lon_max = estaciones_df['lon'].max() + 2.0

    # Ejecutamos la inversión
    lat_grid, lon_grid, matriz_errores = realizar_inversion(estaciones_df, lat_min, lat_max, lon_min, lon_max,t_origen)

    # Encontramos el epicentro, es decir el punto de la malla con el error mínimo entre Tobs- T_calc
    idx_aplanado = np.argmin(matriz_errores)
    i, j = np.unravel_index(idx_aplanado, matriz_errores.shape)
    print(f"DEBUG: Epicentro calculado -> Lat: {lat_grid[i, j]}, Lon: {lon_grid[i, j]}, RMS: {matriz_errores[i, j]}")

    # Regresar resultados
    return {"epicentro_estimado":{"lat": float(lat_grid[i, j]),
            "lon": float(lon_grid[i,j]),
            "rms_minimo": float(matriz_errores[i, j])},

            "bbox": {"lat_min": lat_min, "lat_max": lat_max, "lon_min": lon_min,
            }
        }

def calcular_distancia(lat_est, lon_est, lat_punto, lon_punto):
    # Calculo de distancias epicentrales en radianes y km
    R = 6371.0

    # Conversión a radianes
    lat1, lon1 = np.radians(lat_est), np.radians(lon_est)
    lat2, lon2 = np.radians(lat_punto), np.radians(lon_punto)

    # Cálculo de colatitudes: 90º-latitud
    colat1 = np.pi/2 - lat1
    colat2 = np.pi/2 - lat2

    # Distancias epicentrales
    cos_delta = (np.cos(colat1) * np.cos(colat2) + np.sin(colat1) * np.sin(colat2) * np.cos(lon1-lon2))

    # Para evitar errores numéricos
    cos_delta = np.clip(cos_delta, -1.0, 1.0)
    delta = np.arccos(cos_delta)

    return delta * R

def realizar_inversion(estaciones_df, lat_min, lat_max, lon_min, lon_max, t_origen, vp = 6.0):
    # Creamos la malla o grid
    lats = np.arange(lat_min, lat_max, 0.05) # intervalo de cada punto del mallado, mientras más chico, más fina la malla
    lons = np.arange(lon_min, lon_max, 0.05)
    lat_grid, lon_grid = np.meshgrid(lats, lons)

    # Creación de la matriz de errores
    matriz_errores = np.zeros_like(lat_grid)

    # Ciclo for para que se recorra cada punto de la malla
    for i in range(lat_grid.shape[0]):
        for j in range(lat_grid.shape[1]):
            lat_punto = lat_grid[i, j]
            lon_punto = lon_grid[i, j]

            # Calculamos las distancias desde el punto de la malla a todas las estaciones
            distancias = calcular_distancia(estaciones_df['lat'], estaciones_df['lon'], lat_punto, lon_punto)

            # Calcular tiempos teóricos (Ti)
            t_calc = t_origen + (distancias / vp)

            # Cálculo del error (RMS)
            residuales = estaciones_df['p_arrival_seconds'].values - t_calc
            rms = np.sqrt(np.mean(residuales**2))

            # Guardar en la matriz
            matriz_errores[i, j] = rms
    return lat_grid, lon_grid, matriz_errores

# ── Servir el frontend compilado (solo cuando existe /frontend_dist) ──────────
# En desarrollo el frontend corre en Vite, este bloque no aplica.
# En Docker, el build copia el frontend compilado a ./frontend_dist/.
#
# Vite genera:
#   frontend_dist/index.html
#   frontend_dist/assets/main-xxx.js   (JS, CSS, etc.)
#
# Solucion: montar /assets para los archivos estaticos y agregar una ruta
# catch-all que devuelve index.html para cualquier otra ruta (comportamiento SPA).
# Los endpoints de la API (/upload, /traces, /picks, /remove_response) tienen
# prioridad porque se registraron primero.
_STATIC_DIR = pathlib.Path(__file__).parent / "frontend_dist"
if _STATIC_DIR.exists():
    _ASSETS_DIR = _STATIC_DIR / "assets"
    if _ASSETS_DIR.exists():
        app.mount("/assets", StaticFiles(directory=_ASSETS_DIR), name="assets")


    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def servir_frontend(full_path: str = ""):
        return FileResponse(_STATIC_DIR / "index.html")
