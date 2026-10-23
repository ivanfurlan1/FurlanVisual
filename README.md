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
  - `frames_origen/ENTRADA CASA ESTRENAR/` (265 frames — Film 01 Los Robles)
  - `frames_origen/CASA AL LAGO/` (134 frames — Film 02 Casa del Lago)
  - `frames_origen/CASA HUDSON/` (140 frames — Film 03 Casa Hudson)
  - `frames_origen/SALIDA BALCON HUDSON/` (126 frames — Film 04 Salida Balcón Hudson)

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
