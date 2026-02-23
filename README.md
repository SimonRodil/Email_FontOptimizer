# FontOptimizer (v1.2)

FontOptimizer es un script en Python para **optimizar fuentes en HTML** (típicamente plantillas de email) eliminando variantes `@font-face` que no se usan y añadiendo `mso-font-alt` dentro de los `@font-face` que se mantienen.

A partir de la versión **v1.2**, detecta mejor las variantes usadas cuando la `font-family` está en un contenedor (por ejemplo un `<td>`) y dentro hay `<span>`/`<a>` que solo cambian `font-weight` y/o `font-style` (italic), aunque no repitan la `font-family`.

---

## Qué hace

- Busca el primer archivo `.html` en la carpeta actual.
- Analiza el HTML para detectar **tripletas** usadas:
  - `font-family`
  - `font-weight`
  - `font-style`
- Analiza los `<style>...</style>` del HTML para detectar reglas CSS que usen fuentes (excluyendo `@font-face`).
- En cada bloque `<style>`:
  - Elimina bloques `@font-face` cuya tripleta `(family, weight, style)` **no aparece** como usada.
  - Añade `mso-font-alt: 'Arial';` **solo dentro de `@font-face`** (si no existe ya).
- Genera:
  - Un HTML procesado: `NOMBRE.processed.html`
  - Un log: `NOMBRE.fonts.log` con variantes usadas y variantes eliminadas.

---

## Versiones

- **v1.0**: detección de variantes a partir de `style="..."` que contienen `font-family` y de CSS normal en `<style>`.
- **v1.1**: mejora para detectar `italic` en hijos (`<span>`, `<a>`) cuando el padre tiene `font-family`.
- **v1.2**: mejora para detectar también cambios de `font-weight` y combinaciones `font-weight + italic` en elementos anidados (casos comunes en emails con `<td>` contenedor).

---

## Requisitos

- Python 3.x
- No requiere librerías externas (solo `os`, `re`, `datetime`).

---

## Uso

1. Coloca el script en la misma carpeta que tu HTML.
2. Asegúrate de que haya al menos un archivo `.html` (el script toma el **primero** que encuentre).
3. Ejecuta:

```bash
python Font_Remover_vX.py
