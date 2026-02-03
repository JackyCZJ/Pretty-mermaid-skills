#!/usr/bin/env node

import { execSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillRoot = join(__dirname, '..');

async function loadBeautifulMermaid() {
  try {
    return await import('beautiful-mermaid');
  } catch {}

  console.error('[beautiful-mermaid] Dependency not found. Installing automatically...');
  try {
    execSync('npm install --no-fund --no-audit', {
      cwd: skillRoot,
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 120000,
    });
    console.error('[beautiful-mermaid] Installed successfully.\n');
  } catch (e) {
    console.error(`[beautiful-mermaid] Auto-install failed: ${e.message}`);
    console.error(`Manual fix: cd ${skillRoot} && npm install`);
    process.exit(1);
  }

  try {
    const pkgPath = join(skillRoot, 'node_modules', 'beautiful-mermaid', 'dist', 'index.js');
    return await import(pkgPath);
  } catch (e) {
    console.error(`[beautiful-mermaid] Failed to load after install: ${e.message}`);
    process.exit(1);
  }
}

// Convert SVG with CSS variables to flat SVG with actual colors
function flattenSvg(svg, colors) {
  // Extract CSS variables from style attribute
  const styleMatch = svg.match(/style="([^"]*)"/);
  const cssVars = {};
  
  if (styleMatch) {
    const style = styleMatch[1];
    const varMatches = style.matchAll(/--([\w-]+):([^;]+)/g);
    for (const match of varMatches) {
      cssVars[`--${match[1].trim()}`] = match[2].trim();
    }
  }
  
  // Merge with provided colors
  const allVars = { ...cssVars, ...colors };
  
  // Compute derived colors
  const bg = allVars['--bg'] || allVars.bg || '#FFFFFF';
  const fg = allVars['--fg'] || allVars.fg || '#27272A';
  const line = allVars['--line'] || allVars.line || mixColors(fg, bg, 0.3);
  const accent = allVars['--accent'] || allVars.accent || mixColors(fg, bg, 0.5);
  const muted = allVars['--muted'] || allVars.muted || mixColors(fg, bg, 0.4);
  const surface = allVars['--surface'] || allVars.surface || mixColors(fg, bg, 0.03);
  const border = allVars['--border'] || allVars.border || mixColors(fg, bg, 0.2);
  
  const computed = {
    '--bg': bg,
    '--fg': fg,
    '--line': line,
    '--accent': accent,
    '--muted': muted,
    '--surface': surface,
    '--border': border,
    '--_text': fg,
    '--_text-sec': muted,
    '--_text-muted': muted,
    '--_text-faint': mixColors(fg, bg, 0.25),
    '--_line': line,
    '--_arrow': accent,
    '--_node-fill': surface,
    '--_node-stroke': border,
    '--_group-fill': bg,
    '--_group-hdr': mixColors(fg, bg, 0.05),
    '--_inner-stroke': mixColors(fg, bg, 0.12),
    '--_key-badge': mixColors(fg, bg, 0.1),
  };
  
  // Replace CSS variables with actual values
  let flatSvg = svg;
  for (const [varName, value] of Object.entries(computed)) {
    const regex = new RegExp(`var\\(${varName.replace('--', '\\-\\-')}\\)`, 'g');
    flatSvg = flatSvg.replace(regex, value);
  }
  
  // Remove CSS custom properties from style attribute but keep other styles
  flatSvg = flatSvg.replace(/style="[^"]*--[\w-]+:[^;]+;?\s*/g, (match) => {
    const cleaned = match.replace(/--[\w-]+:[^;]+;?\s*/g, '');
    return cleaned === 'style=""' ? '' : cleaned;
  });
  
  // Remove the CSS style block with @import and variable definitions
  flatSvg = flatSvg.replace(/\u003cstyle\u003e[\s\S]*?@import[\s\S]*?\u003c\/style\u003e/, '');
  
  return flatSvg;
}

// Simple color mixing function
function mixColors(fg, bg, ratio) {
  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  if (!fgRgb || !bgRgb) return fg;
  
  const r = Math.round(bgRgb.r + (fgRgb.r - bgRgb.r) * ratio);
  const g = Math.round(bgRgb.g + (fgRgb.g - bgRgb.g) * ratio);
  const b = Math.round(bgRgb.b + (fgRgb.b - bgRgb.b) * ratio);
  
  return rgbToHex(r, g, b);
}

function hexToRgb(hex) {
  const match = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) return null;
  const bigint = parseInt(match[1], 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Convert SVG to PNG using rsvg-convert
function svgToPng(svg, outputPath, width = 800) {
  const tempSvg = outputPath.replace(/\.png$/, '.temp.svg');
  writeFileSync(tempSvg, svg);
  
  try {
    execSync(`rsvg-convert --width ${width} "${tempSvg}" -o "${outputPath}"`, {
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 30000,
    });
    // Clean up temp file
    try { writeFileSync(tempSvg, ''); } catch {}
    return true;
  } catch (e) {
    console.error(`PNG conversion failed: ${e.message}`);
    console.error('Make sure rsvg-convert is installed: brew install librsvg');
    return false;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    input: null,
    output: null,
    format: 'svg',
    theme: null,
    bg: '#FFFFFF',
    fg: '#27272A',
    font: 'Inter',
    transparent: false,
    useAscii: false,
    paddingX: 5,
    paddingY: 5,
    boxBorderPadding: 1,
    width: 800,
  };

  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const val = args[i + 1];

    switch (key) {
      case '--input': case '-i': opts.input = val; i++; break;
      case '--output': case '-o': opts.output = val; i++; break;
      case '--format': case '-f': opts.format = val; i++; break;
      case '--theme': case '-t': opts.theme = val; i++; break;
      case '--bg': opts.bg = val; i++; break;
      case '--fg': opts.fg = val; i++; break;
      case '--line': opts.line = val; i++; break;
      case '--accent': opts.accent = val; i++; break;
      case '--muted': opts.muted = val; i++; break;
      case '--surface': opts.surface = val; i++; break;
      case '--border': opts.border = val; i++; break;
      case '--font': opts.font = val; i++; break;
      case '--width': opts.width = parseInt(val); i++; break;
      case '--transparent': opts.transparent = true; break;
      case '--use-ascii': opts.useAscii = true; break;
      case '--padding-x': opts.paddingX = parseInt(val); i++; break;
      case '--padding-y': opts.paddingY = parseInt(val); i++; break;
      case '--box-border-padding': opts.boxBorderPadding = parseInt(val); i++; break;
      case '--help': case '-h':
        console.log(`Usage: node scripts/render.mjs --input <file> [options]

Options:
  -i, --input <file>       Input Mermaid file (.mmd) [required]
  -o, --output <file>      Output file (default: stdout)
  -f, --format <fmt>       Output format: svg | png | ascii (default: svg)
  -t, --theme <name>       Theme name (e.g. tokyo-night, dracula)
      --bg <hex>           Background color
      --fg <hex>           Foreground color
      --line <hex>         Edge/connector color
      --accent <hex>       Arrow heads and highlights color
      --muted <hex>        Secondary text color
      --surface <hex>      Node fill tint color
      --border <hex>       Node stroke color
      --font <name>        Font family (default: Inter)
      --width <n>           PNG width in pixels (default: 800)
      --transparent        Transparent background (SVG only)
      --use-ascii          Pure ASCII instead of Unicode (ASCII only)
      --padding-x <n>      Horizontal spacing (ASCII only, default: 5)
      --padding-y <n>      Vertical spacing (ASCII only, default: 5)
      --box-border-padding <n>  Padding inside node boxes (ASCII only, default: 1)

Examples:
  node scripts/render.mjs -i diagram.mmd -o output.svg -t tokyo-night
  node scripts/render.mjs -i diagram.mmd -o output.png -t dracula --width 1200
  node scripts/render.mjs -i diagram.mmd -f ascii`);
        process.exit(0);
    }
  }

  if (!opts.input) {
    console.error('Error: --input is required. Use --help for usage.');
    process.exit(1);
  }

  if (!existsSync(opts.input)) {
    console.error(`Error: Input file not found: ${opts.input}`);
    process.exit(1);
  }

  return opts;
}

async function main() {
  const opts = parseArgs();
  const { renderMermaid, renderMermaidAscii, THEMES } = await loadBeautifulMermaid();
  const input = readFileSync(opts.input, 'utf8');

  if (opts.format === 'ascii') {
    const ascii = renderMermaidAscii(input, {
      useAscii: opts.useAscii,
      paddingX: opts.paddingX,
      paddingY: opts.paddingY,
      boxBorderPadding: opts.boxBorderPadding,
    });
    if (opts.output) {
      writeFileSync(opts.output, ascii);
      console.log(`ASCII diagram saved to ${opts.output}`);
    } else {
      console.log(ascii);
    }
    return;
  }

  const theme = opts.theme ? THEMES[opts.theme] : undefined;
  const colors = theme || {
    bg: opts.bg,
    fg: opts.fg,
    ...(opts.line && { line: opts.line }),
    ...(opts.accent && { accent: opts.accent }),
    ...(opts.muted && { muted: opts.muted }),
    ...(opts.surface && { surface: opts.surface }),
    ...(opts.border && { border: opts.border }),
  };

  const svg = await renderMermaid(input, {
    ...colors,
    font: opts.font,
    transparent: opts.transparent,
  });

  if (opts.format === 'png') {
    const flatSvg = flattenSvg(svg, colors);
    const outputPath = opts.output || opts.input.replace(/\.mmd$/, '.png');
    
    if (svgToPng(flatSvg, outputPath, opts.width)) {
      console.log(`PNG diagram saved to ${outputPath}`);
    } else {
      // Fallback to SVG if PNG conversion fails
      const svgPath = outputPath.replace(/\.png$/, '.svg');
      writeFileSync(svgPath, svg);
      console.log(`PNG conversion failed, saved SVG to ${svgPath}`);
      process.exit(1);
    }
  } else {
    // SVG output
    if (opts.output) {
      writeFileSync(opts.output, svg);
      console.log(`SVG diagram saved to ${opts.output}`);
    } else {
      console.log(svg);
    }
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
