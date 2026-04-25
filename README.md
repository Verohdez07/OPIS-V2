# 🌍 OPIS-V2

Proyecto OPIS — Desarrollado por **Verónica Hernández** como parte del proyecto de grado de maestría.

---

## 📁 Estructura del proyecto

```
OPIS-V2/
├── frontend/           # Interfaz de usuario (JavaScript + Bun)
│   └── package.json
├── backend/            # API REST (Python + FastAPI)
│   └── requirements.txt
├── Dockerfile
└── .dockerignore
```

---

## 🐳 Opción 1 — Ejecutar con Docker (recomendado)

> ✅ La forma más sencilla. Solo necesitas tener **Docker** instalado.

### 1. Instala Docker

Descárgalo desde: [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)

Instálalo y ábrelo. Asegúrate de que esté corriendo (verás el ícono de la ballena 🐳 en tu barra de tareas).

### 2. Clona el repositorio

```bash
git clone https://github.com/Verohdez07/OPIS-V2.git
cd OPIS-V2
```

> Si no tienes `git`, descarga el proyecto como ZIP desde GitHub → botón verde **Code → Download ZIP** → descomprímelo y entra a la carpeta.

### 3. Construye la imagen

```bash
docker build -t opis-v2 .
```

> ⏳ La primera vez puede tardar varios minutos mientras descarga Python, Bun y las dependencias científicas.

### 4. Ejecuta el contenedor

```bash
docker run -p 8000:8000 opis-v2
```

### 5. Abre la aplicación

Abre tu navegador y entra a:

```
http://localhost:8000
```

### ⛔ Para detener

Presiona `Ctrl + C` en la terminal.

---

## 🖥️ Opción 2 — Ejecutar de forma manual (sin Docker)

Necesitarás instalar **Python 3.11+** y **Bun** por separado.

---

### 🔧 Requisitos previos

| Herramienta | Versión mínima | Descarga |
|-------------|----------------|----------|
| Python      | 3.11+          | https://www.python.org/downloads/ |
| Bun         | Cualquiera reciente | https://bun.sh |

> **¿Cómo verificar que los tienes instalados?**
> Abre una terminal y ejecuta:
> ```bash
> python --version
> bun --version
> ```
> Si ves un número de versión en cada uno, estás listo ✅

---

### Paso 1 — Clona el repositorio

```bash
git clone https://github.com/Verohdez07/OPIS-V2.git
cd OPIS-V2
```

---

### Paso 2 — Levanta el Backend (Python / FastAPI)

#### a) Entra a la carpeta del backend

```bash
cd backend
```

#### b) Crea un entorno virtual

```bash
# En Mac / Linux
python3 -m venv venv
source venv/bin/activate

# En Windows
python -m venv venv
venv\Scripts\activate
```

> Cuando el entorno esté activo, verás `(venv)` al inicio de tu terminal ✅

#### c) Instala las dependencias

```bash
pip install -r requirements.txt
```

> ⏳ Esto puede tardar unos minutos, ya que incluye librerías científicas como `obspy` y `numpy`.

#### d) Inicia el servidor

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

El backend estará disponible en: `http://localhost:8000`

---

### Paso 3 — Compila y sirve el Frontend (Bun)

Abre una **nueva terminal** (deja el backend corriendo) y ve a la carpeta del frontend:

```bash
cd frontend
```

#### a) Instala las dependencias

```bash
bun install
```

#### b) Compila el proyecto

```bash
bun run build
```

Esto generará una carpeta `dist/` con los archivos listos para producción.

#### c) Sirve el frontend localmente

```bash
# Con Python (sin instalar nada extra)
python3 -m http.server 3000 --directory dist

# O en modo desarrollo con Bun (si está configurado)
bun run dev
```

Luego abre en tu navegador:

```
http://localhost:3000
```

---

## ❓ Problemas comunes

**El puerto 8000 ya está en uso:**

```bash
# Cambia el puerto externo (el de la izquierda)
docker run -p 8080:8000 opis-v2
# Luego entra a http://localhost:8080
```

**`python` no se reconoce en Windows:**

> Usa `python3` en lugar de `python`, o reinstala Python asegurándote de marcar la casilla **"Add Python to PATH"**.

**Error al instalar `obspy` o `numpy`:**

> Asegúrate de tener Python 3.11 o superior. Algunas versiones antiguas tienen conflictos con estas librerías.

**`bun` no se reconoce:**

> Instálalo desde [https://bun.sh](https://bun.sh) y reinicia tu terminal después de instalarlo.

---

## 📬 Contacto

Proyecto desarrollado por **Verónica Hernández** — [GitHub](https://github.com/Verohdez07)
