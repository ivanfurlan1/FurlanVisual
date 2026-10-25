# Furlan — Portfolio de cine aéreo

Sitio estático (HTML + CSS + JS, sin build). Para verlo localmente:

```
python -m http.server 5173
```
y abrir http://127.0.0.1:5173

## Estructura
- `index.html` — contenido y secciones.
- `css/styles.css` — diseño (variables de color y tipografía al inicio).
- `js/main.js` — secuencia de frames ligada al scroll, revelados, parallax, etc.
- `assets/seq/<slug>/` — frames optimizados (`lg` escritorio, `md` tablets/horizontal, `pt` vertical nativo 9:16).
- `assets/stills/<slug>/` — fotogramas sueltos para galería.
- `frames_origen/` — carpeta contenedora de todos los frames originales organizados por video:
  - `frames_origen/TEST3/` (145 frames — Film 01 Los Robles optimizado a 24 fps)
  - `frames_origen/ENTRADA CASA ESTRENAR/` (Film 01 Los Robles original)
  - `frames_origen/CASA AL LAGO/` (134 frames — Film 02 Casa del Lago)
  - `frames_origen/CASA HUDSON/` (140 frames — Film 03 Casa Hudson)
  - `frames_origen/SALIDA BALCON HUDSON/` (126 frames — Balcón Hudson anterior)
  - `frames_origen/CASA GREENVILLE/` (334 frames — Cartografía de vuelo / Perspectiva)
  - `frames_origen/ANACLETO/` (242 frames — Film 04 Anacleto)
  - `frames_origen/EPECUEN/` (179 frames — Formato dual horizontal / vertical)

## Agregar un nuevo video
1. Exportar los frames a una carpeta dentro de `frames_origen/<nuevo_video>/` (jpg/png, 1920×1080 o más).
2. Generar las versiones web:
   ```
   py tools/build_frames.py frames_origen/<nuevo_video> <slug>
   py tools/build_stills.py frames_origen/<nuevo_video> <slug> 1 60 120   # opcional
   ```
3. En `index.html`, duplicar la `<section class="seq" id="film-01">`, cambiar `id`, `data-src`,
   `data-count` (lo imprime el script), los textos de capítulos (`data-range` = tramo del scroll, de 0 a 1)
   y el poster. El JS detecta automáticamente todas las secciones `.seq`.
   Se recomienda quitar el bloque `.hero` de las secuencias siguientes.

## Regla de diseño: Margen superior seguro (Nav Clearance)
La barra de navegación (`.nav`) es fija y flota en la parte superior con `mix-blend-mode: difference` y una altura aproximada de 75px en escritorio (63px en móvil). Al deslizar hacia arriba, reaparece de forma inmediata y suave.

**Regla obligatoria para nuevas secciones y escenas:**
Todo contenedor con anclaje `position: sticky` (como `.choreo__stage`, `.format-showcase__stage`), cabezal de sección o bloque de contenido inicial DEBE aplicar el despeje superior seguro definido en las variables CSS:
- En escritorio: `padding-top: var(--nav-clearance);` (`clamp(88px, 11vh, 108px)`).
- En móvil: `padding-top: var(--nav-clearance-mobile);` (`clamp(72px, 9.5vh, 84px)`).

Ningún texto, título, badge de estado o elemento interactivo debe quedar situado por encima de este margen, garantizando que la barra superior nunca se solape ni toque los contenidos al desplegarse.
