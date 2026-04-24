// Direccion del backend FastAPI
// Vacia = URL relativa: en Docker el frontend y backend corren en el mismo puerto.
// En desarrollo Vite usa el proxy definido en vite.config.js para reenviar al puerto 8000.
let API = ""

// ── letiables globales ────────────────────────────────
let modoActual = "P"       // modo de picking activo: "P" o "S"
let picks = {}             // picks: { ESTACION: { P: segundos|null, S: "ISO"|null } } — uno por estacion fisica
let estaciones = []        // lista de claves "ESTACION.CANAL" de las trazas visibles
let stacionesFisicas = []  // nombres de estaciones fisicas: ["ARIG", "CAIG", ...]
let estacionActual = 0     // indice de la estacion que se esta viendo ahora
let datosTrazas = {}       // datos que devuelve /traces
let metadata = []          // datos que devuelve /upload
let mapa = null            // instancia del mapa Leaflet
let marcadoresEstaciones = []
let etiquetaY = "Cuentas"  // etiqueta del eje Y: cambia tras quitar instrumentacion
let picksFinal = {}
// ── Referencias a elementos del HTML ─────────────────
let inputArchivos  = document.getElementById("file-input")
let btnCargar      = document.getElementById("btn-upload")
let btnModoP       = document.getElementById("btn-mode-P")
let btnModoS       = document.getElementById("btn-mode-S")
let btnQuitarResp  = document.getElementById("btn-remove-response")
let btnGuardar     = document.getElementById("btn-save-picks")
let btnCalcular    = document.getElementById("btn-locate")
let btnLimpiar     = document.getElementById("btn-clear")
let textoEstado    = document.getElementById("upload-status")
let divTrazas      = document.getElementById("waveforms")
let divPlaceholder = document.getElementById("waveforms-placeholder")
let divPicks       = document.getElementById("picks-panel")
let divChips       = document.getElementById("file-chips")

// ── Eventos de botones ────────────────────────────────
btnCargar.addEventListener("click", subirArchivos)
btnQuitarResp.addEventListener("click", quitarInstrumentacion)
btnModoP.addEventListener("click", function() { cambiarModo("P") })
btnModoS.addEventListener("click", function() { cambiarModo("S") })
btnGuardar.addEventListener("click", guardarPicks)
btnLimpiar.addEventListener("click", limpiarTodo)
inputArchivos.addEventListener("change", mostrarChips)

// Botones de navegacion entre estaciones
document.getElementById("btn-prev-sta").addEventListener("click", function() {
  if (estacionActual > 0) mostrarEstacion(estacionActual - 1)
})
document.getElementById("btn-next-sta").addEventListener("click", function() {
  if (estacionActual < stacionesFisicas.length - 1) mostrarEstacion(estacionActual + 1)
})

// Boton de calculo de epicentro
btnCalcular.addEventListener("click", async () => {

    if (!picksFinal || Object.keys(picksFinal).length === 0) {
        console.error("No hay picks calculados");
        return;
    }

    const response = await fetch(API + "/calcular_epicentro", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(picksFinal)
    });

    const result = await response.json();
    console.log("Epicentro:", result);
});


// Iniciar el mapa cuando la pagina cargue
iniciarMapa()

// ── Helper: extrae el nombre de la estacion de una clave "ESTACION.CANAL" ────
function nombreEstacion(clave) {
  return clave.split(".")[0]
}

// ── Mostrar chips de archivos seleccionados ───────────

function mostrarChips() {
  divChips.innerHTML = ""
  for (let i = 0; i < inputArchivos.files.length; i++) {
    let archivo = inputArchivos.files[i]
    let chip = document.createElement("div")
    chip.className = "file-chip"
    chip.title = archivo.name
    chip.textContent = archivo.name
    divChips.appendChild(chip)
  }
}

// ── Funciones de conversion de tiempo ────────────────

// Convierte segundos relativos a formato "HH:MM:SS.mmm" en UTC
function relAAbsTime(startUnix, relSeg) {
  let fecha = new Date(Math.round((startUnix + relSeg) * 1000))
  let hh = String(fecha.getUTCHours()).padStart(2, "0")
  let mm = String(fecha.getUTCMinutes()).padStart(2, "0")
  let ss = String(fecha.getUTCSeconds()).padStart(2, "0")
  let ms = String(fecha.getUTCMilliseconds()).padStart(3, "0")
  return hh + ":" + mm + ":" + ss + "." + ms
}

// Convierte "HH:MM:SS.mmm" a segundos relativos desde startUnix
function absTimeARel(startUnix, texto) {
  let partes = texto.trim().split(".")
  let hhmmss = partes[0] || ""
  let msParte = (partes[1] || "000").padEnd(3, "0")
  let tiempos = hhmmss.split(":")
  let hh = parseInt(tiempos[0])
  let mm = parseInt(tiempos[1])
  let ss = parseInt(tiempos[2])
  if (isNaN(hh) || isNaN(mm) || isNaN(ss)) return NaN
  let fechaStart = new Date(startUnix * 1000)
  let inicioDia = Date.UTC(
    fechaStart.getUTCFullYear(),
    fechaStart.getUTCMonth(),
    fechaStart.getUTCDate()
  )
  let absMs = inicioDia + hh * 3600000 + mm * 60000 + ss * 1000 + parseInt(msParte)
  return (absMs - startUnix * 1000) / 1000
}

// Convierte el string de fecha que devuelve Plotly a segundos relativos
// Plotly devuelve algo como "2026-03-11 16:19:28.123"
function plotlyFechaARel(startUnix, textoPlotly) {
  let fecha = new Date(textoPlotly.replace(" ", "T") + "Z")
  return (fecha.getTime() - startUnix * 1000) / 1000
}

// ── Mapa Leaflet ──────────────────────────────────────

function iniciarMapa() {
  mapa = L.map("map").setView([0, 0], 2)
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "\u00a9 OpenStreetMap contributors",
    maxZoom: 18,
  }).addTo(mapa)
}

function agregarMarcadoresEstaciones() {
  // Borrar marcadores anteriores
  for (let i = 0; i < marcadoresEstaciones.length; i++) {
    mapa.removeLayer(marcadoresEstaciones[i])
  }
  marcadoresEstaciones = []

  let coordenadas = []
  let estacionesMapa = {}  // para no agregar dos marcadores en la misma estacion fisica
  for (let j = 0; j < metadata.length; j++) {
    let tr = metadata[j]
    if (tr.stla === 0 && tr.stlo === 0) continue
    if (estacionesMapa[tr.station]) continue  // ya se agrego esta estacion
    let m = L.circleMarker([tr.stla, tr.stlo], {
      radius: 7,
      color: "#0d6efd",
      fillColor: "#0d6efd",
      fillOpacity: 0.6,
      weight: 2,
    }).addTo(mapa)
      .bindPopup("<b>" + tr.station + "</b><br>" + tr.channel)
    marcadoresEstaciones.push(m)
    estacionesMapa[tr.station] = true
    coordenadas.push([tr.stla, tr.stlo])
  }

  if (coordenadas.length > 0) {
    mapa.fitBounds(L.latLngBounds(coordenadas), { padding: [40, 40], maxZoom: 8 })
  }
}

// ── Subir archivos SAC al backend ─────────────────────

async function subirArchivos() {
  let archivos = inputArchivos.files
  if (archivos.length === 0) {
    alert("Selecciona al menos un archivo SAC.")
    return
  }

  textoEstado.textContent = "Subiendo archivos..."

  let formData = new FormData()
  for (let i = 0; i < archivos.length; i++) {
    formData.append("files", archivos[i])
  }

  try {
    let respuesta = await fetch(API + "/upload", { method: "POST", body: formData })
    if (!respuesta.ok) {
      let errorJson = await respuesta.json()
      throw new Error(errorJson.detail || "Error en /upload")
    }
    let datos = await respuesta.json()
    metadata = datos.traces

    // ── Paso 1: agrupar canales por estacion fisica ────────────────────────
    // Cada clave es el nombre de estacion, el valor es una lista de canales
    let canalesPorEstacion = {}
    for (let k = 0; k < metadata.length; k++) {
      let sta = metadata[k].station
      let canal = metadata[k].channel
      if (!canalesPorEstacion[sta]) {
        canalesPorEstacion[sta] = []
      }
      canalesPorEstacion[sta].push(canal)
    }

    // ── Paso 2: ordenar estaciones alfabeticamente ─────────────────────────
    let todasLasEstaciones = Object.keys(canalesPorEstacion).sort()

    // ── Paso 3: validar que cada estacion tenga las 3 componentes esperadas ─
    let componentesRequeridas = ["HHE", "HHN", "HHZ"]
    let estacionesCompletas = []
    let estacionesIncompletas = []

    for (let k = 0; k < todasLasEstaciones.length; k++) {
      let sta = todasLasEstaciones[k]
      let canales = canalesPorEstacion[sta]
      let faltantes = []

      for (let j = 0; j < componentesRequeridas.length; j++) {
        if (canales.indexOf(componentesRequeridas[j]) === -1) {
          faltantes.push(componentesRequeridas[j])
        }
      }

      if (faltantes.length === 0) {
        estacionesCompletas.push(sta)
      } else {
        estacionesIncompletas.push(sta + " (falta: " + faltantes.join(", ") + ")")
      }
    }

    // Avisar si hay estaciones incompletas (se cargan igual pero aparece advertencia)
    if (estacionesIncompletas.length > 0) {
      textoEstado.textContent = "Advertencia \u2014 componentes faltantes: " + estacionesIncompletas.join(" | ")
    }

    // Si no hay ninguna estacion completa, detener
    if (estacionesCompletas.length === 0) {
      textoEstado.textContent = "Error: ninguna estacion tiene las 3 componentes (HHE, HHN, HHZ)."
      return
    }

    // ── Paso 4: usar TODAS las estaciones completas (sin limite) ──────────
    stacionesFisicas = estacionesCompletas

    // Filtrar metadata para incluir solo estaciones completas
    metadata = metadata.filter(function(tr) {
      return estacionesCompletas.indexOf(tr.station) !== -1
    })

    // ── Paso 5: inicializar lista de claves y picks ────────────────────────
    picks = {}
    estaciones = []
    for (let k = 0; k < metadata.length; k++) {
      let clave = metadata[k].station + "." + metadata[k].channel
      estaciones.push(clave)
    }
    for (let k = 0; k < stacionesFisicas.length; k++) {
      picks[stacionesFisicas[k]] = { P: null, S: null }
    }

    agregarMarcadoresEstaciones()

    textoEstado.textContent = "Cargando trazas..."
    await cargarTrazas()

  } catch (e) {
    textoEstado.textContent = "Error: " + e.message
    console.error(e)
  }
}

async function cargarTrazas() {
  try {
    let respuesta = await fetch(API + "/traces")
    if (!respuesta.ok) throw new Error("Error en /traces")
    datosTrazas = await respuesta.json()
    estacionActual = 0
    crearNavegador()
    dibujarGrafica()
    construirPanelPicks()
    textoEstado.textContent = "Listo - haz click en una traza para colocar picks"
  } catch (e) {
    textoEstado.textContent = "Error: " + e.message
  }
}

// ── Quitar respuesta instrumental (usando archivos .PZ del backend) ──────────

async function quitarInstrumentacion() {
  if (estaciones.length === 0) {
    alert("Carga trazas antes de quitar la instrumentacion.")
    return
  }

  textoEstado.textContent = "Quitando respuesta instrumental..."

  try {
    let respuesta = await fetch(API + "/remove_response")
    if (!respuesta.ok) {
      let errorJson = await respuesta.json()
      throw new Error(errorJson.detail || "Error en /remove_response")
    }
    let datos = await respuesta.json()

    // Actualizar los datos de las trazas con los corregidos
    datosTrazas = datos.traces

    // Cambiar etiqueta del eje Y a amplitud en mm
    etiquetaY = "Amplitud (mm)"

    // Volver a dibujar la grafica con los nuevos datos
    dibujarGrafica()

    // Avisar si alguna estacion no tenia archivo PZ
    if (datos.sin_pz && datos.sin_pz.length > 0) {
      textoEstado.textContent = "Respuesta quitada. Sin PZ: " + datos.sin_pz.join(", ")
    } else {
      textoEstado.textContent = "Respuesta instrumental quitada"
    }

  } catch (e) {
    textoEstado.textContent = "Error: " + e.message
    console.error(e)
  }
}

// ── Dibujar grafica con Plotly ────────────────────────

function dibujarGrafica() {
  divPlaceholder.classList.add("d-none")
  divTrazas.style.display = "block"
  divTrazas.innerHTML = ""  // limpiar contenido anterior

  // Solo mostrar las trazas de la estacion que esta seleccionada ahora
  let estacionMostrar = stacionesFisicas[estacionActual]
  let estacionesMostrar = []
  for (let k = 0; k < estaciones.length; k++) {
    if (nombreEstacion(estaciones[k]) === estacionMostrar) {
      estacionesMostrar.push(estaciones[k])
    }
  }

  // Ordenar: E primero, luego N, luego Z, resto al final
  let ordenCanal = { "E": 0, "N": 1, "Z": 2 }
  estacionesMostrar.sort(function(a, b) {
    let ca = datosTrazas[a] ? datosTrazas[a].channel.slice(-1) : ""
    let cb = datosTrazas[b] ? datosTrazas[b].channel.slice(-1) : ""
    let oa = ordenCanal[ca] !== undefined ? ordenCanal[ca] : 99
    let ob = ordenCanal[cb] !== undefined ? ordenCanal[cb] : 99
    return oa - ob
  })

  for (let i = 0; i < estacionesMostrar.length; i++) {
    let estacion = estacionesMostrar[i]
    let td = datosTrazas[estacion]
    if (!td) continue

    let esUltimo = (i === estacionesMostrar.length - 1)
    let idDiv = "plot-" + estacion.replace(".", "-")
    let divSub = document.createElement("div")
    divSub.id = idDiv
    divSub.style.height = "220px"
    divSub.style.width = "100%"
    divTrazas.appendChild(divSub)

    let startMs = td.starttime * 1000
    let fechas = []
    for (let j = 0; j < td.times.length; j++) {
      fechas.push(new Date(startMs + td.times[j] * 1000).toISOString())
    }

    let traza = [{
      x: fechas,
      y: td.amplitudes,
      type: "scatter",
      mode: "lines",
      name: estacion,
      line: { color: "#5ba4cf", width: 1 },
    }]

    let layout = {
      paper_bgcolor: "#fff",
      plot_bgcolor: "#fff",
      font: { color: "#555", size: 11, family: "system-ui, sans-serif" },
      margin: { l: 80, r: 20, t: 28, b: esUltimo ? 40 : 8 },
      showlegend: false,
      shapes: [],
      xaxis: {
        type: "date",
        color: "#999",
        gridcolor: "#f0f0f0",
        showticklabels: esUltimo,
        title: esUltimo ? "Tiempo UTC" : "",
      },
      yaxis: {
        title: etiquetaY,
        color: "#999",
        gridcolor: "#f0f0f0",
        fixedrange: true,   // bloquea el eje Y: el zoom solo actua sobre el tiempo
      },
      annotations: [{
        text: estacion,
        xref: "paper", yref: "paper",
        x: 0.01, y: 1.0,
        xanchor: "left", yanchor: "bottom",
        showarrow: false,
        font: { size: 11, color: "#333" },
      }],
    }

    Plotly.newPlot(idDiv, traza, layout, { responsive: true, displayModeBar: true, modeBarButtonsToRemove: ["select2d", "lasso2d", "toImage"] })
    divSub.on("plotly_click", alHacerClickEnGrafica)
  }
}

function calcularDominio(indice, total) {
  let espacio = 0.06
  let altura = (1 - espacio * (total - 1)) / total
  let base = (total - 1 - indice) * (altura + espacio)
  return [Math.max(0, base), Math.min(1, base + altura)]
}

function alHacerClickEnGrafica(datos) {
  if (!datos.points || datos.points.length === 0) return

  let punto = datos.points[0]
  let clave = punto.data.name             // "ARIG.HHE"
  let estacion = nombreEstacion(clave)    // "ARIG"
  if (!clave || !picks[estacion]) return

  let td = datosTrazas[clave]
  let startUnix = td.starttime
  let relSeg = plotlyFechaARel(startUnix, String(punto.x))

  // Guardar el pick para TODA la estacion fisica (las 3 componentes comparten el mismo pick)
  if (modoActual === "P") {
    picks[estacion].P = Number(relSeg.toFixed(3))
  } else {
    let utcISO = new Date(Math.round((startUnix + relSeg) * 1000)).toISOString()
    picks[estacion].S = utcISO
  }

  // Mostrar el tiempo en el input del panel derecho (una sola fila por estacion)
  let fase = modoActual.toLowerCase()
  let inputEl = document.getElementById(fase + "-time-" + estacion)
  if (inputEl) {
    if (modoActual === "P") {
      inputEl.value = relSeg.toFixed(3)
    } else {
      inputEl.value = relAAbsTime(startUnix, relSeg)
    }
    inputEl.classList.add("filled")
  }

  dibujarLineasPick()
  actualizarBotonesNavegador()  // el boton de la estacion se pone verde cuando tiene pick P
}

// Dibuja lineas verticales en cada grafica donde estan los picks
// Las 3 componentes de la misma estacion muestran la misma linea P y S
function dibujarLineasPick() {
  for (let i = 0; i < estaciones.length; i++) {
    let clave = estaciones[i]             // "ARIG.HHE"
    let estacion = nombreEstacion(clave)  // "ARIG"
    let sp = picks[estacion]
    let td = datosTrazas[clave]
    if (!td || !sp) continue

    let shapes = []

    if (sp.P !== null) {
      let xP = new Date(Math.round((td.starttime + Number(sp.P)) * 1000)).toISOString()
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: xP, x1: xP, y0: 0, y1: 1, line: { color: "#00b62d", width: 2 } })
    }
    if (sp.S !== null) {
      shapes.push({ type: "line", xref: "x", yref: "paper", x0: sp.S, x1: sp.S, y0: 0, y1: 1, line: { color: "#dc3545", width: 2 } })
    }

    let idDiv = "plot-" + clave.replace(".", "-")
    if (document.getElementById(idDiv)) {
      Plotly.relayout(idDiv, { shapes: shapes })
    }
  }
}

// ── Panel de picks manuales por estacion ─────────────

function construirPanelPicks() {
  divPicks.innerHTML = ""

  // Resumen: cuantas estaciones ya tienen pick P marcado
  let conPickP = 0
  for (let k = 0; k < stacionesFisicas.length; k++) {
    if (picks[stacionesFisicas[k]] && picks[stacionesFisicas[k]].P !== null) conPickP++
  }
  let resumen = document.createElement("div")
  resumen.className = "small text-muted mb-2 pb-2 border-bottom"
  resumen.textContent = "P marcado: " + conPickP + " / " + stacionesFisicas.length + " estaciones"
  divPicks.appendChild(resumen)

  // Solo mostrar los campos de la estacion que esta visible ahora
  let estacion = stacionesFisicas[estacionActual]
  if (!estacion) return

  // Buscar starttime de esta estacion
  let startUnix = null
  for (let j = 0; j < estaciones.length; j++) {
    if (nombreEstacion(estaciones[j]) === estacion) {
      startUnix = datosTrazas[estaciones[j]].starttime
      break
    }
  }
  if (startUnix === null) return

  let horaInicio = relAAbsTime(startUnix, 0).substring(0, 8)

  let div = document.createElement("div")
  div.className = "station-picks"

  let html = '<div class="station-name">' + estacion + '</div>' +
             '<div class="trace-start">Inicio: ' + horaInicio + ' UTC</div>'

  html += '<div class="mb-1">' +
    '<label class="form-label mb-0" style="font-size:11px;color:#0d6efd">P</label>' +
    '<input type="text" id="p-time-' + estacion + '" class="form-control form-control-sm" placeholder="segundos" />' +
    '</div>'

  html += '<div class="mb-1">' +
    '<label class="form-label mb-0" style="font-size:11px;color:#dc3545">S</label>' +
    '<input type="text" id="s-time-' + estacion + '" class="form-control form-control-sm" placeholder="HH:MM:SS.mmm" />' +
    '</div>'

  div.innerHTML = html
  divPicks.appendChild(div)

  // Rellenar con el valor actual si ya existe el pick
  if (picks[estacion].P !== null) {
    let relP = parseFloat(picks[estacion].P)
    let inputP = document.getElementById("p-time-" + estacion)
    if (inputP) { inputP.value = isNaN(relP) ? "" : relP.toFixed(3); inputP.classList.add("filled") }
  }
  if (picks[estacion].S !== null) {
    let relS = (new Date(picks[estacion].S).getTime() - startUnix * 1000) / 1000
    let inputS = document.getElementById("s-time-" + estacion)
    if (inputS) { inputS.value = relAAbsTime(startUnix, relS); inputS.classList.add("filled") }
  }

  // Listeners para edicion manual
  ;(function(sta, su) {
    document.getElementById("p-time-" + sta).addEventListener("change", function(e) {
      let rel = parseFloat(e.target.value)
      if (!isNaN(rel) && rel >= 0) {
        picks[sta].P = Number(rel.toFixed(3))
        e.target.value = picks[sta].P.toFixed(3)
        e.target.classList.add("filled")
        dibujarLineasPick()
        actualizarBotonesNavegador()
      }
    })
    document.getElementById("s-time-" + sta).addEventListener("change", function(e) {
      let rel = absTimeARel(su, e.target.value)
      if (!isNaN(rel) && rel >= 0) {
        picks[sta].S = new Date(Math.round((su + rel) * 1000)).toISOString()
        e.target.classList.add("filled")
        dibujarLineasPick()
      }
    })
  })(estacion, startUnix)
}

// ── Navegador de estaciones ───────────────────────────

// Construye los botones del navegador una vez que las estaciones estan cargadas
function crearNavegador() {
  let divNav = document.getElementById("station-nav")
  divNav.classList.remove("d-none")
  actualizarBotonesNavegador()
}

// Regenera los botones de estacion (los colorea segun si tienen pick P o no)
function actualizarBotonesNavegador() {
  let contenedor = document.getElementById("station-buttons")
  contenedor.innerHTML = ""

  for (let i = 0; i < stacionesFisicas.length; i++) {
    let sta = stacionesFisicas[i]
    let tieneP = picks[sta] && picks[sta].P !== null

    let btn = document.createElement("button")
    btn.dataset.indice = i

    // Estacion activa: azul solido. Con pick P: verde. Sin pick: gris.
    if (i === estacionActual) {
      btn.className = "btn btn-primary btn-sm"
    } else if (tieneP) {
      btn.className = "btn btn-success btn-sm"
    } else {
      btn.className = "btn btn-outline-secondary btn-sm"
    }

    btn.textContent = sta
    btn.addEventListener("click", function() {
      mostrarEstacion(parseInt(this.dataset.indice))
    })
    contenedor.appendChild(btn)
  }

  document.getElementById("station-progress").textContent =
    (estacionActual + 1) + " / " + stacionesFisicas.length
}

// Cambia la estacion visible y actualiza grafica + panel
function mostrarEstacion(indice) {
  estacionActual = indice
  actualizarBotonesNavegador()
  dibujarGrafica()
  construirPanelPicks()
}

// ── Guardar picks en el backend ───────────────────────

async function guardarPicks() {
  if (estaciones.length === 0) {
    alert("No hay trazas cargadas.")
    return
  }

  let picksConUbicacion = {}
  for (let estacion in picks) {
    let meta = metadata.find(function(tr) {
      return tr.station === estacion
    })
    picksConUbicacion[estacion] = {
      P: picks[estacion].P,
      S: picks[estacion].S,
      stla: meta ? meta.stla : null,
      stlo: meta ? meta.stlo : null,
    }
  }

  try {
    let respuesta = await fetch(API + "/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ picks: picksConUbicacion }),
    })
    if (!respuesta.ok) throw new Error("Error en /picks")
    picksFinal = picksConUbicacion
    localStorage.setItem("estaciones", JSON.stringify(picksFinal))
    console.log("Picks guardados:", picksConUbicacion)
    textoEstado.textContent = "Picks guardados"
  } catch (e) {
    textoEstado.textContent = "Error: " + e.message
  }
}

// ── Mostrar el mapa al hacer click en Calcular epicentro ──

function mostrarMapa() {
  let divMapa = document.getElementById("div-mapa")
  divMapa.style.display = ""
  mapa.invalidateSize()
}

// ── Limpiar todo y volver al estado inicial ───────────

function limpiarTodo() {
  picks = {}
  estaciones = []
  stacionesFisicas = []
  estacionActual = 0
  datosTrazas = {}
  metadata = []

  etiquetaY = "Cuentas"
  cambiarModo("P")
  textoEstado.textContent = ""
  divChips.innerHTML = ""
  inputArchivos.value = ""
  divPicks.innerHTML = '<p class="text-muted small">Carga trazas para activar el picking</p>'

  // Ocultar y limpiar el navegador de estaciones
  document.getElementById("station-nav").classList.add("d-none")
  document.getElementById("station-buttons").innerHTML = ""
  document.getElementById("station-progress").textContent = ""

  // Purgar cada grafica individual y limpiar el contenedor
  for (let pi = 0; pi < estaciones.length; pi++) {
    let idDiv = "plot-" + estaciones[pi].replace(".", "-")
    if (document.getElementById(idDiv)) Plotly.purge(idDiv)
  }
  divTrazas.innerHTML = ""
  divTrazas.style.display = "none"
  divTrazas.style.flexDirection = ""
  divPlaceholder.classList.remove("d-none")

  for (let i = 0; i < marcadoresEstaciones.length; i++) {
    mapa.removeLayer(marcadoresEstaciones[i])
  }
  marcadoresEstaciones = []
  mapa.setView([0, 0], 2)

  // Ocultar el mapa
  document.getElementById("div-mapa").style.display = "none"
}

// ── Cambiar modo de picking P / S ─────────────────────

function cambiarModo(modo) {
  modoActual = modo
  if (modo === "P") {
    btnModoP.className = "btn btn-primary btn-sm flex-fill"
    btnModoS.className = "btn btn-outline-danger btn-sm flex-fill"
  } else {
    btnModoP.className = "btn btn-outline-primary btn-sm flex-fill"
    btnModoS.className = "btn btn-danger btn-sm flex-fill"
  }
}
