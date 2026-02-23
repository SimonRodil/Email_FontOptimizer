import os
import re
from datetime import datetime


MSO_FONT_ALT = "mso-font-alt: 'Arial';"


GENERIC_FAMILIES = {
    "serif",
    "sans-serif",
    "monospace",
    "cursive",
    "fantasy",
    "system-ui",
    "ui-serif",
    "ui-sans-serif",
    "ui-monospace",
    "ui-rounded",
    "emoji",
    "math",
    "fangsong",
}


def find_first_html_file():
    for fname in os.listdir('.'):
        if fname.lower().endswith('.html'):
            return fname
    return None


def extract_style_blocks(html_text):
    pattern = re.compile(
        r'(<style[^>]*>)(.*?)(</style>)',
        re.IGNORECASE | re.DOTALL
    )
    blocks = []
    for m in pattern.finditer(html_text):
        start, end = m.start(), m.end()
        open_tag = m.group(1)
        css_text = m.group(2)
        close_tag = m.group(3)
        blocks.append((start, end, open_tag, css_text, close_tag))
    return blocks


def normalize_family(fam):
    return fam.strip(" '\"\t\r\n")


def is_generic_family(fam):
    return fam.lower() in GENERIC_FAMILIES


def normalize_font_style(style_value):
    if not style_value:
        return "normal"
    v = style_value.strip().lower()
    if v in ("italic", "oblique"):
        return "italic"
    return "normal"


def normalize_font_weight(weight_value):
    if not weight_value:
        return 400
    v = weight_value.strip().lower()
    if v == "normal":
        return 400
    if v == "bold":
        return 700
    if v == "bolder":
        return 700
    if v == "lighter":
        return 300
    try:
        n = int(v)
        if n < 100:
            n = 100
        if n > 900:
            n = 900
        n = int(round(n / 100.0) * 100)
        return n
    except ValueError:
        return 400


# -------- estilos inline (style="...") --------


def collect_used_triplets_in_html(html_text):
    used = set()

    style_attr_pattern_double = re.compile(
        r'style\s*=\s*"([^"]*)"', re.IGNORECASE
    )
    style_attr_pattern_single = re.compile(
        r"style\s*=\s*'([^']*)'", re.IGNORECASE
    )

    font_family_pattern = re.compile(
        r'font-family\s*:\s*([^;"]+)', re.IGNORECASE
    )
    font_weight_pattern = re.compile(
        r'font-weight\s*:\s*([^;"]+)', re.IGNORECASE
    )
    font_style_pattern = re.compile(
        r'font-style\s*:\s*([^;"]+)', re.IGNORECASE
    )

    def parse_style_content(style_content):
        fam_matches = font_family_pattern.findall(style_content)
        families = []
        for ff in fam_matches:
            parts = ff.split(',')
            for p in parts:
                fam = normalize_family(p)
                if fam and not is_generic_family(fam):
                    families.append(fam)
        if not families:
            return

        weight_match = font_weight_pattern.search(style_content)
        style_match = font_style_pattern.search(style_content)

        weight = normalize_font_weight(weight_match.group(1) if weight_match else None)
        style = normalize_font_style(style_match.group(1) if style_match else None)

        for fam in families:
            used.add((fam, weight, style))

    for m in style_attr_pattern_double.finditer(html_text):
        parse_style_content(m.group(1))
    for m in style_attr_pattern_single.finditer(html_text):
        parse_style_content(m.group(1))

    return used


def collect_inherited_italic_triplets_in_html(html_text):
    """
    (Función de v1.1) Heurística simple: si encontramos estilos inline con font-style: italic
    pero sin font-family, asumimos que usan la última font-family encontrada previamente.
    """
    used = set()

    style_attr_pattern_double = re.compile(
        r'style\s*=\s*"([^"]*)"', re.IGNORECASE
    )
    style_attr_pattern_single = re.compile(
        r"style\s*=\s*'([^']*)'", re.IGNORECASE
    )

    font_family_pattern = re.compile(
        r'font-family\s*:\s*([^;"]+)', re.IGNORECASE
    )
    font_weight_pattern = re.compile(
        r'font-weight\s*:\s*([^;"]+)', re.IGNORECASE
    )
    font_style_pattern = re.compile(
        r'font-style\s*:\s*([^;"]+)', re.IGNORECASE
    )

    last_family = None
    last_weight = None

    all_styles = []
    for m in style_attr_pattern_double.finditer(html_text):
        all_styles.append(m.group(1))
    for m in style_attr_pattern_single.finditer(html_text):
        all_styles.append(m.group(1))

    for style_content in all_styles:
        fam_matches = font_family_pattern.findall(style_content)
        style_match = font_style_pattern.search(style_content)
        weight_match = font_weight_pattern.search(style_content)

        families = []
        for ff in fam_matches:
            parts = ff.split(',')
            for p in parts:
                fam = normalize_family(p)
                if fam and not is_generic_family(fam):
                    families.append(fam)

        if families:
            last_family = families[0]
            if weight_match:
                last_weight = normalize_font_weight(weight_match.group(1))
            else:
                last_weight = 400

            if style_match:
                style = normalize_font_style(style_match.group(1))
                used.add((last_family, last_weight, style))
            continue

        if style_match and last_family:
            style = normalize_font_style(style_match.group(1))
            if weight_match:
                weight = normalize_font_weight(weight_match.group(1))
            else:
                weight = last_weight if last_weight is not None else 400

            used.add((last_family, weight, style))

    return used


def collect_inherited_variants_in_html(html_text):
    """
    Heurística mejorada (v1.2):
    - Mantiene un contexto last_family, last_weight, last_style basado en estilos inline anteriores.
    - Si aparece un style sin font-family pero con font-weight y/o font-style, lo asocia a last_family.
    - Así detecta casos como: <span style="font-weight:900"> ... <span style="font-style:italic">...</span>
      dentro de un <td> con font-family.
    """
    used = set()

    style_attr_pattern_double = re.compile(
        r'style\s*=\s*"([^"]*)"', re.IGNORECASE
    )
    style_attr_pattern_single = re.compile(
        r"style\s*=\s*'([^']*)'", re.IGNORECASE
    )

    font_family_pattern = re.compile(
        r'font-family\s*:\s*([^;"]+)', re.IGNORECASE
    )
    font_weight_pattern = re.compile(
        r'font-weight\s*:\s*([^;"]+)', re.IGNORECASE
    )
    font_style_pattern = re.compile(
        r'font-style\s*:\s*([^;"]+)', re.IGNORECASE
    )

    last_family = None
    last_weight = 400
    last_style = "normal"

    all_styles = []
    for m in style_attr_pattern_double.finditer(html_text):
        all_styles.append(m.group(1))
    for m in style_attr_pattern_single.finditer(html_text):
        all_styles.append(m.group(1))

    for style_content in all_styles:
        fam_matches = font_family_pattern.findall(style_content)
        weight_match = font_weight_pattern.search(style_content)
        style_match = font_style_pattern.search(style_content)

        families = []
        for ff in fam_matches:
            for p in ff.split(','):
                fam = normalize_family(p)
                if fam and not is_generic_family(fam):
                    families.append(fam)

        # Caso A: el propio style define font-family => actualiza contexto principal
        if families:
            last_family = families[0]

            # Actualiza contexto de weight/style si están presentes; si no, vuelve a defaults razonables
            if weight_match:
                last_weight = normalize_font_weight(weight_match.group(1))
            else:
                last_weight = 400

            if style_match:
                last_style = normalize_font_style(style_match.group(1))
            else:
                last_style = "normal"

            # Registrar lo que declara este style (con contexto ya actualizado)
            used.add((last_family, last_weight, last_style))
            continue

        # Caso B: no hay font-family, pero hay weight/style => se asocia a last_family
        if not last_family:
            continue

        changed = False

        if weight_match:
            last_weight = normalize_font_weight(weight_match.group(1))
            changed = True

        if style_match:
            last_style = normalize_font_style(style_match.group(1))
            changed = True

        if changed:
            used.add((last_family, last_weight, last_style))

    return used


# -------- reglas CSS normales dentro de <style> (EXCLUIR @font-face) --------


def collect_used_triplets_in_css(css_text):
    css_without_font_faces = re.sub(
        r'@font-face\s*{[^}]*}',
        '',
        css_text,
        flags=re.IGNORECASE | re.DOTALL
    )

    used = set()

    block_pattern = re.compile(r'{([^}]*)}', re.DOTALL)
    font_family_pattern = re.compile(
        r'font-family\s*:\s*([^;}]*)', re.IGNORECASE
    )
    font_weight_pattern = re.compile(
        r'font-weight\s*:\s*([^;}]*)', re.IGNORECASE
    )
    font_style_pattern = re.compile(
        r'font-style\s*:\s*([^;}]*)', re.IGNORECASE
    )

    for m in block_pattern.finditer(css_without_font_faces):
        block = m.group(1)

        fam_match = font_family_pattern.search(block)
        if not fam_match:
            continue

        families = []
        for raw_fam in fam_match.group(1).split(','):
            fam = normalize_family(raw_fam)
            if fam and not is_generic_family(fam):
                families.append(fam)
        if not families:
            continue

        weight_match = font_weight_pattern.search(block)
        style_match = font_style_pattern.search(block)

        weight = normalize_font_weight(weight_match.group(1) if weight_match else None)
        style = normalize_font_style(style_match.group(1) if style_match else None)

        for fam in families:
            used.add((fam, weight, style))

    return used


# -------- @font-face --------


def parse_font_face_blocks(css_text):
    blocks = []
    font_face_pattern = re.compile(
        r'@font-face\s*{([^}]*)}',
        re.IGNORECASE | re.DOTALL
    )
    family_pattern = re.compile(
        r'font-family\s*:\s*([^;}]*)',
        re.IGNORECASE
    )
    weight_pattern = re.compile(
        r'font-weight\s*:\s*([^;}]*)',
        re.IGNORECASE
    )
    style_pattern = re.compile(
        r'font-style\s*:\s*([^;}]*)',
        re.IGNORECASE
    )

    for m in font_face_pattern.finditer(css_text):
        inner = m.group(1)
        full_block = m.group(0)

        fam_match = family_pattern.search(inner)
        if not fam_match:
            continue

        families = []
        for raw_fam in fam_match.group(1).split(','):
            fam = normalize_family(raw_fam)
            if fam:
                families.append(fam)
        if not families:
            continue

        family = families[0]
        weight_match = weight_pattern.search(inner)
        style_match = style_pattern.search(inner)

        weight = normalize_font_weight(weight_match.group(1) if weight_match else None)
        style = normalize_font_style(style_match.group(1) if style_match else None)

        blocks.append({
            'full_block': full_block,
            'family': family,
            'weight': weight,
            'style': style,
        })

    return blocks


def remove_unused_font_faces(css_text, used_triplets):
    """
    Elimina @font-face no usadas y limpia líneas vacías resultantes.
    """
    font_faces = parse_font_face_blocks(css_text)
    new_css = css_text
    removed_triplets = set()

    for ff in font_faces:
        triplet = (ff['family'], ff['weight'], ff['style'])
        if triplet not in used_triplets:
            new_css = new_css.replace(ff['full_block'], '')
            removed_triplets.add(triplet)

    # Limpiar líneas vacías/espacios en blanco excesivos
    new_css = re.sub(r'\n\s*\n\s*\n', '\n\n', new_css)

    return new_css, removed_triplets


# -------- mso-font-alt SOLO en @font-face --------


def add_mso_font_alt_to_font_faces(css_text):
    """
    Añade mso-font-alt: 'Arial'; SOLO dentro de bloques @font-face,
    NO en otras reglas CSS como clases.
    """
    font_face_pattern = re.compile(
        r'(@font-face\s*{)([^}]*)(})',
        re.IGNORECASE | re.DOTALL
    )

    def process_font_face(m):
        open_part = m.group(1)      # "@font-face {"
        inner = m.group(2)          # contenido entre { y }
        close_part = m.group(3)     # "}"

        # Si ya tiene mso-font-alt, no añadir
        if 'mso-font-alt' in inner.lower():
            return m.group(0)

        # Si no tiene font-family, devolver sin cambios
        if 'font-family' not in inner.lower():
            return m.group(0)

        # Encontrar el último ; en el interior
        last_semicolon_idx = inner.rfind(';')
        if last_semicolon_idx == -1:
            # No hay ;, no hacer nada
            return m.group(0)

        # Insertar mso-font-alt después del último ;
        new_inner = (
            inner[:last_semicolon_idx + 1] +
            ' ' + MSO_FONT_ALT +
            inner[last_semicolon_idx + 1:]
        )

        return open_part + new_inner + close_part

    return font_face_pattern.sub(process_font_face, css_text)


# -------- log --------


def write_log(log_path, html_file, used_triplets, removed_triplets):
    timestamp = datetime.now().isoformat(timespec='seconds')
    with open(log_path, 'a', encoding='utf-8') as log:
        log.write(f"=== RUN {timestamp} ===\n")
        log.write(f"HTML file: {html_file}\n\n")

        log.write("Variantes usadas (family | weight | style):\n")
        if used_triplets:
            for fam, w, st in sorted(used_triplets):
                log.write(f"  - {fam} | {w} | {st}\n")
        else:
            log.write("  (ninguna detectada)\n")

        log.write("\nVariantes NO usadas (eliminadas de @font-face):\n")
        if removed_triplets:
            for fam, w, st in sorted(removed_triplets):
                log.write(f"  - {fam} | {w} | {st}\n")
        else:
            log.write("  (ninguna eliminada)\n")

        log.write("\n\n")


# -------- main --------


def main():
    html_file = find_first_html_file()
    if not html_file:
        print("No se encontró ningún .html en la carpeta actual.")
        return

    with open(html_file, 'r', encoding='utf-8') as f:
        html_text = f.read()

    used_html = collect_used_triplets_in_html(html_text)

    # v1.2: detecta variantes heredadas (weight y style) aunque no haya font-family en el mismo style=""
    inherited_variants_html = collect_inherited_variants_in_html(html_text)

    style_blocks = extract_style_blocks(html_text)

    used_css = set()
    for _, _, _, css_text, _ in style_blocks:
        used_css |= collect_used_triplets_in_css(css_text)

    used_triplets = used_html | used_css | inherited_variants_html

    new_html = html_text
    all_removed_triplets = set()

    for start, end, open_tag, css_text, close_tag in reversed(style_blocks):
        css_without_unused, removed_here = remove_unused_font_faces(css_text, used_triplets)
        all_removed_triplets |= removed_here
        css_with_mso = add_mso_font_alt_to_font_faces(css_without_unused)
        replacement = open_tag + css_with_mso + close_tag
        new_html = new_html[:start] + replacement + new_html[end:]

    base, ext = os.path.splitext(html_file)
    out_file = f"{base}.processed{ext}"
    with open(out_file, 'w', encoding='utf-8') as f:
        f.write(new_html)

    log_file = f"{base}.fonts.log"
    write_log(log_file, html_file, used_triplets, all_removed_triplets)

    print(f"Archivo procesado guardado como: {out_file}")
    print(f"Log de fuentes guardado como: {log_file}")


if __name__ == "__main__":
    main()
