const fs = require('fs');
const path = require('path');

const MSO_FONT_ALT = "mso-font-alt: 'Arial';";

const GENERIC_FAMILIES = new Set([
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace',
  'ui-rounded', 'emoji', 'math', 'fangsong'
]);

function normalizeFamily(fam) {
  return fam.trim().replace(/^['"\t\r\n]+|['"\t\r\n]+$/g, '');
}

function isGenericFamily(fam) {
  return GENERIC_FAMILIES.has(fam.toLowerCase());
}

function normalizeFontStyle(styleValue) {
  if (!styleValue) return 'normal';
  const v = styleValue.trim().toLowerCase();
  if (v === 'italic' || v === 'oblique') return 'italic';
  return 'normal';
}

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

function collectUsedTripletsInHtml(htmlText) {
  const used = new Set();
  const styleAttrPattern = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi;
  const fontFamilyPattern = /font-family\s*:\s*([^;"]+)/gi;
  const fontWeightPattern = /font-weight\s*:\s*([^;"]+)/i;
  const fontStylePattern = /font-style\s*:\s*([^;"]+)/i;

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

    families.forEach(fam => used.add(`${fam}||${weight}||${style}`));
  }

  let m;
  while ((m = styleAttrPattern.exec(htmlText)) !== null) {
    parseStyleContent(m[1] || m[2]);
  }
  return used;
}

function collectInheritedVariantsInHtml(htmlText) {
  const used = new Set();
  const styleAttrPattern = /style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi;
  const fontFamilyPattern = /font-family\s*:\s*([^;"]+)/gi;
  const fontWeightPattern = /font-weight\s*:\s*([^;"]+)/i;
  const fontStylePattern = /font-style\s*:\s*([^;"]+)/i;

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

    if (families.length) {
      lastFamily = families[0];
      lastWeight = weightMatch ? normalizeFontWeight(weightMatch[1]) : 400;
      lastStyle = styleMatch ? normalizeFontStyle(styleMatch[1]) : 'normal';
      used.add(`${lastFamily}||${lastWeight}||${lastStyle}`);
      continue;
    }

    if (!lastFamily) continue;

    let changed = false;
    if (weightMatch) { lastWeight = normalizeFontWeight(weightMatch[1]); changed = true; }
    if (styleMatch) { lastStyle = normalizeFontStyle(styleMatch[1]); changed = true; }
    if (changed) used.add(`${lastFamily}||${lastWeight}||${lastStyle}`);
  }

  return used;
}

function collectUsedTripletsInCss(cssText) {
  const used = new Set();
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

  newCss = newCss.replace(/\n\s*\n\s*\n/g, '\n\n');
  return { newCss, removedTriplets };
}

function addMsoFontAltToFontFaces(cssText) {
  return cssText.replace(/@font-face\s*{([^}]*)}/gi, (match, inner) => {
    if (inner.toLowerCase().includes('mso-font-alt')) return match;
    if (!inner.toLowerCase().includes('font-family')) return match;
    const lastSemicolon = inner.lastIndexOf(';');
    if (lastSemicolon === -1) return match;
    const newInner = inner.slice(0, lastSemicolon + 1) + ' ' + MSO_FONT_ALT + inner.slice(lastSemicolon + 1);
    return match.replace(inner, newInner);
  });
}

function main() {
  const files = fs.readdirSync('.');
  const htmlFile = files.find(f => f.toLowerCase().endsWith('.html'));

  if (!htmlFile) {
    console.log('No se encontró ningún .html en la carpeta actual.');
    return;
  }

  const htmlText = fs.readFileSync(htmlFile, 'utf-8');

  const usedHtml = collectUsedTripletsInHtml(htmlText);
  const inheritedVariants = collectInheritedVariantsInHtml(htmlText);
  const styleBlocks = extractStyleBlocks(htmlText);

  let usedCss = new Set();
  for (const block of styleBlocks) {
    collectUsedTripletsInCss(block.cssText).forEach(t => usedCss.add(t));
  }

  const usedTriplets = new Set([...usedHtml, ...usedCss, ...inheritedVariants]);

  let newHtml = htmlText;
  for (const block of [...styleBlocks].reverse()) {
    const { newCss } = removeUnusedFontFaces(block.cssText, usedTriplets);
    const cssWithMso = addMsoFontAltToFontFaces(newCss);
    const replacement = block.openTag + cssWithMso + block.closeTag;
    newHtml = newHtml.slice(0, block.start) + replacement + newHtml.slice(block.end);
  }

  const ext = path.extname(htmlFile);
  const base = path.basename(htmlFile, ext);
  const outFile = `${base}.processed${ext}`;
  fs.writeFileSync(outFile, newHtml, 'utf-8');

  console.log(`Archivo procesado guardado como: ${outFile}`);
}

main();
