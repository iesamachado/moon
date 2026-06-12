# MOON – CPU Binary Challenge 🌙

Juego educativo online basado en el juego de mesa **MOON**. El jugador manipula los registros de una CPU virtual (A, B, C, D de 4 bits) para lograr que el **Registro A** alcance un valor binario objetivo aleatorio.

---

## 🚀 Configuración de Firebase

### 1. Crea el proyecto en Firebase Console

1. Ve a [https://console.firebase.google.com](https://console.firebase.google.com) y crea un nuevo proyecto.
2. Activa **Authentication** → Método de inicio de sesión → **Google**.
3. Activa **Firestore Database** (en modo producción).

### 2. Obtén tu configuración Web

En Firebase Console → ⚙️ Configuración del proyecto → Tu app web (añade una si no tienes) → copia el objeto `firebaseConfig`.

### 3. Pega la configuración en `app.js`

Busca esta sección al inicio de `app.js` y reemplaza con tus valores reales:

```js
const firebaseConfig = {
  apiKey:            "TU_API_KEY",
  authDomain:        "TU_AUTH_DOMAIN",
  projectId:         "TU_PROJECT_ID",
  storageBucket:     "TU_STORAGE_BUCKET",
  messagingSenderId: "TU_MESSAGING_SENDER_ID",
  appId:             "TU_APP_ID"
};
```

### 4. Configura los dominios autorizados en Firebase Auth

En **Authentication → Settings → Authorized domains**, añade el dominio desde el que servirás la app (ej. `localhost`, tu dominio en GitHub Pages, etc.).

---

## 🔒 Reglas de Firestore

Despliega el archivo `firestore.rules` desde Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase init firestore   # selecciona tu proyecto
firebase deploy --only firestore:rules
```

O cópialo manualmente en **Firestore → Rules** en la consola de Firebase.

### Resumen de las reglas

| Acción | ¿Quién puede? |
|--------|---------------|
| Leer su propio documento | Cualquier usuario autenticado |
| Escribir su propio documento | Cualquier usuario autenticado (solo sus contadores) |
| Leer **todos** los documentos | Solo `bernatcosta@iesamachado.org` |
| Crear/borrar otros docs | Nadie |

---

## 🎮 Cómo jugar

1. Inicia sesión con Google.
2. Se genera un **objetivo aleatorio** de 4 bits que debes lograr en el **Registro A**.
3. Selecciona una **operación** (`INC`, `DEC`, `NOT`, `MOV`, `AND`, `OR`, `XOR`), los registros implicados y pulsa **Ejecutar** (o `Enter`).
4. Cuando el Registro A iguale el objetivo, ¡ganas la ronda!
5. Pulsa **Nueva Ronda** para generar un nuevo objetivo.

### Operaciones disponibles

| Op | Descripción |
|----|-------------|
| `INC R` | R = (R + 1) mod 16 |
| `DEC R` | R = (R − 1 + 16) mod 16 |
| `NOT R` | R = ~R (4 bits) |
| `MOV R1 ← R2` | R1 = R2 |
| `AND R1 ← R2` | R1 = R1 AND R2 |
| `OR  R1 ← R2` | R1 = R1 OR R2 |
| `XOR R1 ← R2` | R1 = R1 XOR R2 |

---

## 🌐 Servir localmente

Como el proyecto usa ES Modules (`type="module"`), necesitas un servidor HTTP local (no abrir `index.html` directamente):

```bash
# Con Python
python3 -m http.server 8080

# Con Node.js (npx)
npx serve .

# Con VS Code → Live Server (extensión)
```

Luego abre [http://localhost:8080](http://localhost:8080).

---

## 📁 Estructura del proyecto

```
moon/
├── index.html        # Estructura HTML completa
├── style.css         # Diseño cyberpunk completo
├── app.js            # Lógica del juego + Firebase
├── firestore.rules   # Reglas de seguridad de Firestore
└── README.md         # Este archivo
```

---

## 👩‍💼 Panel de Administrador

Disponible solo para `bernatcosta@iesamachado.org`. Muestra una tabla con todos los alumnos registrados, sus partidas jugadas, ganadas y porcentaje de victoria.
