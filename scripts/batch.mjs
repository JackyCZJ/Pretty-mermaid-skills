#!/usr/bin/env node

import { execSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';

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
  const styleMatch = svg.match(/style="([^"]*)"/);
  const cssVars = {};
  
  if (styleMatch) {
    const style = styleMatch[1];
    const varMatches = style.matchAll(/--([\w-]+):([^;]+)/g);
    for (const match of varMatches) {
      cssVars[`--${match[1].trim()}`] = match[2].trim();
    }
  }
  
  const allVars = { ...cssVars, ...colors };
  
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
  
  let flatSvg = svg;
  for (const [varName, value] of Object.entries(computed)) {
    const regex = new RegExp(`var\\(${varName.replace('--', '\\-\\-')}\\)`, 'g');
    flatSvg = flatSvg.replace(regex, value);
  }
  
  flatSvg = flatSvg.replace(/style="[^"]*--[\w-]+:[^;]+;?\s*/g, (match) => {
    const cleaned = match.replace(/--[\w-]+:[^;]+;?\s*/g, '');
    return cleaned === 'style=""' ? '' : cleaned;
  });
  
  flatSvg = flatSvg.replace(/\u003cstyle\u003e[\s\S]*?@import[\s\S]*?\u003c\/style\u003e/, '');
  
  return flatSvg;
}

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

function svgToPng(svg, outputPath, width = 800) {
  const tempSvg = outputPath.replace(/\.png$/, '.temp.svg');
  writeFileSync(tempSvg, svg);
  
  try {
    execSync(`rsvg-convert --width ${width} "${tempSvg}" -o "${outputPath}"`, {
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 30000,
    });
    try { writeFileSync(tempSvg, ''); } catch {}
    return true;
  } catch (e) {
    console.error(`PNG conversion failed: ${e.message}`);
    return false;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    inputDir: null,
    outputDir: null,
    format: 'svg',
    theme: null,
    bg: null,
    fg: null,
    transparent: false,
    useAscii: false,
    workers: 4,
    width: 800,
  };

  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const val = args[i + 1];

    switch (key) {
      case '--input-dir': case '-i': opts.inputDir = val; i++; break;
      case '--output-dir': case '-o': opts.outputDir = val; i++; break;
      case '--format': case '-f': opts.format = val; i++; break;
      case '--theme': case '-t': opts.theme = val; i++; break;
      case '--bg': opts.bg = val; i++; break;
      case '--fg': opts.fg = val; i++; break;
      case '--width': opts.width = parseInt(val); i++; break;
      case '--transparent': opts.transparent = true; break;
      case '--use-ascii': opts.useAscii = true; break;
      case '--workers': case '-w': opts.workers = parseInt(val); i++; break;
      case '--help': case '-h':
        console.log(`Usage: node batch.mjs --input-dir <dir> --output-dir <dir> [options]

Options:
  -i, --input-dir <dir>    Input directory containing .mmd files [required]
  -o, --output-dir <dir>   Output directory for rendered files [required]
  -f, --format <fmt>       Output format: svg | png | ascii (default: svg)
  -t, --theme <name>       Theme name (e.g. tokyo-night, dracula)
      --bg <hex>           Background color
      --fg <hex>           Foreground color
      --width <n>           PNG width in pixels (default: 800)
      --transparent        Transparent background (SVG only)
      --use-ascii          Pure ASCII instead of Unicode (ASCII only)
  -w, --workers <n>        Parallel workers (default: 4)`);
        process.exit(0);
    }
  }

  if (!opts.inputDir) {
    console.error('Error: --input-dir is required. Use --help for usage.');
    process.exit(1);
  }
  if (!opts.outputDir) {
    console.error('Error: --output-dir is required. Use --help for usage.');
    process.exit(1);
  }
  if (!existsSync(opts.inputDir)) {
    console.error(`Error: Input directory not found: ${opts.inputDir}`);
    process.exit(1);
  }

  return opts;
}

async function renderFile(file, inputDir, outputDir, opts, lib) {
  const { renderMermaid, renderMermaidAscii, THEMES } = lib;
  const inputPath = join(inputDir, file);
  const input = readFileSync(inputPath, 'utf8');

  if (opts.format === 'ascii') {
    const ext = '.txt';
    const outputPath = join(outputDir, file.replace(/\.mmd$/, ext));
    const ascii = renderMermaidAscii(input, { useAscii: opts.useAscii });
    writeFileSync(outputPath, ascii);
    return;
  }

  const theme = opts.theme ? THEMES[opts.theme] : undefined;
  const colors = theme || {
    ...(opts.bg && { bg: opts.bg }),
    ...(opts.fg && { fg: opts.fg }),
  };

  const svg = await renderMermaid(input, {
    ...colors,
    transparent: opts.transparent,
  });

  if (opts.format === 'png') {
    const flatSvg = flattenSvg(svg, colors);
    const outputPath = join(outputDir, file.replace(/\.mmd$/, '.png'));
    if (!svgToPng(flatSvg, outputPath, opts.width)) {
      throw new Error('PNG conversion failed');
    }
  } else {
    const outputPath = join(outputDir, file.replace(/\.mmd$/, '.svg'));
    writeFileSync(outputPath, svg);
  }
}

async function main() {
  const opts = parseArgs();
  const lib = await loadBeautifulMermaid();

  mkdirSync(opts.outputDir, { recursive: true });

  const files = readdirSync(opts.inputDir).filter(f => f.endsWith('.mmd'));
  if (files.length === 0) {
    console.error(`No .mmd files found in ${opts.inputDir}`);
    process.exit(1);
  }

  console.log(`Found ${files.length} diagram(s) to render...`);

  let success = 0;
  const failed = [];

  for (let i = 0; i < files.length; i += opts.workers) {
    const batch = files.slice(i, i + opts.workers);
    const results = await Promise.allSettled(
      batch.map(file => renderFile(file, opts.inputDir, opts.outputDir, opts, lib))
    );

    results.forEach((result, idx) => {
      const file = batch[idx];
      if (result.status === 'fulfilled') {
        console.log(`\u2713 ${file}`);
        success++;
      } else {
        console.error(`\u2717 ${file}: ${result.reason?.message || result.reason}`);
        failed.push([file, result.reason?.message || String(result.reason)]);
      }
    });
  }

  console.log(`\n${success}/${files.length} diagrams rendered successfully`);

  if (failed.length > 0) {
    console.error(`\n${failed.length} failed:`);
    for (const [file, error] of failed) {
      console.error(`  - ${file}: ${error}`);
    }
    process.exit(1);
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
