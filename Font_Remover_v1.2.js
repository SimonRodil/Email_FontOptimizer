const fs = require('fs');
const path = require('path');

// Propiedad MSO que se añade a cada @font-face para compatibilidad con Outlook
const MSO_FONT_ALT = "mso-font-alt: 'Arial';";

// Familias genéricas de CSS que no son fuentes reales y deben ignorarse
const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'emoji', 'math', 'fangsong'
]);

// Elimina comillas, espacios y caracteres raros alrededor del nombre de una fuente
function normalizeFamily(fam) {
  return fam.trim().replace(/^['"\t\r\n]+|['"\t\r\n]+$/g, '');
}

// Devuelve true si la fuente es una familia genérica de CSS (serif, sans-serif, etc.)
function isGenericFamily(fam) {
  return GENERIC_FAMILIES.has(fam.toLowerCase());
}

// Normaliza font-style: devuelve 'italic' o 'normal'
function normalizeFontStyle(styleValue) {
  if (!styleValue) return 'normal';
  const v = styleValue.trim().toLowerCase();
  if (v === 'italic' || v === 'oblique') return 'italic';
  return 'normal';
}

// Normaliza font-weight: convierte palabras clave y números al centén más cercano (100-900)
function normalizeFontWeight(weightValue) {
  if (!weightValue) return 400;
  const v = weightValue.trim().toLowerCase();
  if (v === 'normal') return 400;
  if (v === 'bold' || v === 'bolder') return 700;
  if (v === 'lighter') return 300;
  const n = parseInt(v);
  if (!isNaN(n)) {
    return Math.round(Math.min(Math.max(n, 100), 900) / 100) * 100;
  }
  return 400;
}

// Encuentra todos los bloques <style>...</style> en el HTML y devuelve
// su posición (start/end), el tag de apertura, el CSS interno y el tag de cierre
function extractStyleBlocks(htmlText) {
  const pattern = /<style[^>]*>(.*?)<\/style>/gis;
  const blocks = [];
  let m;
  while ((m = pattern.exec(htmlText)) !== null) {
    blocks.push({
      start: m.index,
      end: m.index + m[0].length,
      openTag: m[0].match(/<style[^>]*>/i)[0],
      cssText: m[1],
      closeTag: '</style>'
    });
  }
  return blocks;
}

// Recorre todos los atributos style="..." del HTML y recoge los triplets
// (font-family, font-weight, font-style) que se usan directamente en elementos
function collectUsedTripletsInHtml(htmlText) {
  const used = new Set();
  const styleAttrPattern = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi;
  const fontFamilyPattern = /font-family\s*:\s*([^;"]+)/gi;
  const fontWeightPattern = /font-weight\s*:\s*([^;"]+)/i;
  const fontStylePattern = /font-style\s*:\s*([^;"]+)/i;

  // Parsea el contenido de un atributo style="" y extrae el triplet (family, weight, style)
  function parseStyleContent(styleContent) {
    const families = [];
    let fm;
    fontFamilyPattern.lastIndex = 0;
    while ((fm = fontFamilyPattern.exec(styleContent)) !== null) {
      fm[1].split(',').forEach(p => {
        const fam = normalizeFamily(p);
        if (fam && !isGenericFamily(fam)) families.push(fam);
      });
    }
    if (!families.length) return;

    const weightMatch = fontWeightPattern.exec(styleContent);
    const styleMatch = fontStylePattern.exec(styleContent);
    const weight = normalizeFontWeight(weightMatch ? weightMatch[1] : null);
    const style = normalizeFontStyle(styleMatch ? styleMatch[1] : null);

    // Los triplets se guardan como string "family||weight||style" porque
    // JavaScript no puede comparar arrays/objetos dentro de un Set como Python hace con tuplas
    families.forEach(fam => used.add(`${fam}||${weight}||${style}`));
  }

  let m;
  while ((m = styleAttrPattern.exec(htmlText)) !== null) {
    parseStyleContent(m[1] || m[2]);
  }
  return used;
}

// Heurística v1.2: detecta variantes heredadas de font-weight y font-style
// cuando un elemento hijo no declara font-family pero hereda la del padre.
// Ejemplo: <td style="font-family: Montserrat"> <span style="font-weight: 700">
function collectInheritedVariantsInHtml(htmlText) {
  const used = new Set();
  const styleAttrPattern = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi;
  const fontFamilyPattern = /font-family\s*:\s*([^;"]+)/gi;
  const fontWeightPattern = /font-weight\s*:\s*([^;"]+)/i;
  const fontStylePattern = /font-style\s*:\s*([^;"]+)/i;

  // Contexto que se va actualizando al recorrer los estilos en orden
  let lastFamily = null;
  let lastWeight = 400;
  let lastStyle = 'normal';

  const allStyles = [];
  let m;
  while ((m = styleAttrPattern.exec(htmlText)) !== null) {
    allStyles.push(m[1] || m[2]);
  }

  for (const styleContent of allStyles) {
    const families = [];
    let fm;
    fontFamilyPattern.lastIndex = 0;
    while ((fm = fontFamilyPattern.exec(styleContent)) !== null) {
      fm[1].split(',').forEach(p => {
        const fam = normalizeFamily(p);
        if (fam && !isGenericFamily(fam)) families.push(fam);
      });
    }

    const weightMatch = fontWeightPattern.exec(styleContent);
    const styleMatch = fontStylePattern.exec(styleContent);

    // Caso A: el style define font-family => actualiza el contexto principal
    if (families.length) {
      lastFamily = families[0];
      lastWeight = weightMatch ? normalizeFontWeight(weightMatch[1]) : 400;
      lastStyle = styleMatch ? normalizeFontStyle(styleMatch[1]) : 'normal';
      used.add(`${lastFamily}||${lastWeight}||${lastStyle}`);
      continue;
    }

    // Caso B: no hay font-family => asocia weight/style al lastFamily del contexto
    if (!lastFamily) continue;

    let changed = false;
    if (weightMatch) { lastWeight = normalizeFontWeight(weightMatch[1]); changed = true; }
    if (styleMatch) { lastStyle = normalizeFontStyle(styleMatch[1]); changed = true; }
    if (changed) used.add(`${lastFamily}||${lastWeight}||${lastStyle}`);
  }

  return used;
}

// Recorre las reglas CSS dentro de los bloques <style> (excluyendo @font-face)
// y recoge los triplets de fuentes que se usan en clases, IDs, selectores, etc.
function collectUsedTripletsInCss(cssText) {
  const used = new Set();

  // Primero eliminamos los @font-face para no confundirlos con reglas normales
  const cssWithoutFontFaces = cssText.replace(/@font-face\s*{[^}]*}/gi, '');

  const blockPattern = /{([^}]*)}/g;
  const fontFamilyPattern = /font-family\s*:\s*([^;}]*)/i;
  const fontWeightPattern = /font-weight\s*:\s*([^;}]*)/i;
  const fontStylePattern = /font-style\s*:\s*([^;}]*)/i;

  let m;
  while ((m = blockPattern.exec(cssWithoutFontFaces)) !== null) {
    const block = m[1];
    const famMatch = fontFamilyPattern.exec(block);
    if (!famMatch) continue;

    const families = [];
    famMatch[1].split(',').forEach(p => {
      const fam = normalizeFamily(p);
      if (fam && !isGenericFamily(fam)) families.push(fam);
    });
    if (!families.length) continue;

    const weightMatch = fontWeightPattern.exec(block);
    const styleMatch = fontStylePattern.exec(block);
    const weight = normalizeFontWeight(weightMatch ? weightMatch[1] : null);
    const style = normalizeFontStyle(styleMatch ? styleMatch[1] : null);

    families.forEach(fam => used.add(`${fam}||${weight}||${style}`));
  }

  return used;
}

// Parsea todos los bloques @font-face del CSS y devuelve un array con
// su contenido completo, familia, weight y style para poder compararlos
function parseFontFaceBlocks(cssText) {
  const blocks = [];
  const fontFacePattern = /@font-face\s*{([^}]*)}/gi;
  const familyPattern = /font-family\s*:\s*([^;}]*)/i;
  const weightPattern = /font-weight\s*:\s*([^;}]*)/i;
  const stylePattern = /font-style\s*:\s*([^;}]*)/i;

  let m;
  while ((m = fontFacePattern.exec(cssText)) !== null) {
    const inner = m[1];
    const fullBlock = m[0];
    const famMatch = familyPattern.exec(inner);
    if (!famMatch) continue;

    const families = [];
    famMatch[1].split(',').forEach(p => {
      const fam = normalizeFamily(p);
      if (fam) families.push(fam);
    });
    if (!families.length) continue;

    const weightMatch = weightPattern.exec(inner);
    const styleMatch = stylePattern.exec(inner);

    blocks.push({
      fullBlock,
      family: families[0],
      weight: normalizeFontWeight(weightMatch ? weightMatch[1] : null),
      style: normalizeFontStyle(styleMatch ? styleMatch[1] : null),
    });
  }

  return blocks;
}

// Elimina del CSS los @font-face cuyo triplet (family, weight, style)
// no aparece en el Set de triplets usados. Devuelve el CSS limpio
// y el Set de triplets eliminados.
function removeUnusedFontFaces(cssText, usedTriplets) {
  const fontFaces = parseFontFaceBlocks(cssText);
  let newCss = cssText;
  const removedTriplets = new Set();

  for (const ff of fontFaces) {
    const key = `${ff.family}||${ff.weight}||${ff.style}`;
    if (!usedTriplets.has(key)) {
      newCss = newCss.replace(ff.fullBlock, '');
      removedTriplets.add(key);
    }
  }

  // Limpia líneas vacías excesivas que quedan tras eliminar bloques
  newCss = newCss.replace(/\n\s*\n\s*\n/g, '\n\n');
  return { newCss, removedTriplets };
}

// Añade mso-font-alt: 'Arial' dentro de cada @font-face que no lo tenga ya.
// Esto es necesario para compatibilidad con Outlook (MSO).
function addMsoFontAltToFontFaces(cssText) {
  return cssText.replace(/@font-face\s*{([^}]*)}/gi, (match, inner) => {
    if (inner.toLowerCase().includes('mso-font-alt')) return match;
    if (!inner.toLowerCase().includes('font-family')) return match;

    // Inserta mso-font-alt justo después del último ; dentro del bloque
    const lastSemicolon = inner.lastIndexOf(';');
    if (lastSemicolon === -1) return match;

    const newInner = inner.slice(0, lastSemicolon + 1) + ' ' + MSO_FONT_ALT + inner.slice(lastSemicolon + 1);
    return match.replace(inner, newInner);
  });
}

function main() {
  // Busca el primer archivo .html en la carpeta actual
  const files = fs.readdirSync('.');
  const htmlFile = files.find(f => f.toLowerCase().endsWith('.html'));

  if (!htmlFile) {
    console.log('No se encontró ningún .html en la carpeta actual.');
    return;
  }

  const htmlText = fs.readFileSync(htmlFile, 'utf-8');

  // Recoger todos los triplets usados desde las tres fuentes posibles
  const usedHtml = collectUsedTripletsInHtml(htmlText);
  const inheritedVariants = collectInheritedVariantsInHtml(htmlText);
  const styleBlocks = extractStyleBlocks(htmlText);

  let usedCss = new Set();
  for (const block of styleBlocks) {
    collectUsedTripletsInCss(block.cssText).forEach(t => usedCss.add(t));
  }

  // Unión de los tres Sets: triplets del HTML inline + CSS + variantes heredadas
  const usedTriplets = new Set([...usedHtml, ...usedCss, ...inheritedVariants]);

  // Procesar los bloques <style> de atrás hacia adelante para no desplazar índices
  let newHtml = htmlText;
  const keptTriplets = new Set();

  for (const block of [...styleBlocks].reverse()) {
    const { newCss, removedTriplets } = removeUnusedFontFaces(block.cssText, usedTriplets);

    // Recoge los @font-face que SÍ se conservaron en este bloque
    parseFontFaceBlocks(block.cssText).forEach(ff => {
      const key = `${ff.family}||${ff.weight}||${ff.style}`;
      if (!removedTriplets.has(key)) keptTriplets.add(key);
    });

    const cssWithMso = addMsoFontAltToFontFaces(newCss);
    const replacement = block.openTag + cssWithMso + block.closeTag;
    newHtml = newHtml.slice(0, block.start) + replacement + newHtml.slice(block.end);
  }

  // Guardar el archivo procesado
  const ext = path.extname(htmlFile);
  const base = path.basename(htmlFile, ext);
  const outFile = `${base}.processed${ext}`;
  fs.writeFileSync(outFile, newHtml, 'utf-8');

  // Log en consola: fuentes conservadas
  console.log('\n✅ @font-face conservados (family | weight | style):');
  if (keptTriplets.size === 0) {
    console.log('  (ninguno)');
  } else {
    [...keptTriplets].sort().forEach(t => {
      const [family, weight, style] = t.split('||');
      console.log(`  - ${family} | ${weight} | ${style}`);
    });
  }

  console.log(`\n📄 Archivo procesado guardado como: ${outFile}\n`);
}

main();
