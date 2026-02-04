#!/usr/bin/env node

import { spawnSync } from 'child_process';
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
    const result = spawnSync('npm', ['install', '--no-fund', '--no-audit'], {
      cwd: skillRoot,
      stdio: 'inherit',
      timeout: 120000,
    });
    if (result.error) {
      throw new Error(`npm not found: ${result.error.message}`);
    }
    if (result.status !== 0) {
      throw new Error(`npm install exited with code ${result.status}`);
    }
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

// Import shared utilities
const { flattenSvg, validateWidth, svgToPng } = await import('./svg-utils.mjs');

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
  // Track which color options were explicitly set by user
  const userColors = {};

  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    const val = args[i + 1];

    switch (key) {
      case '--input': case '-i': opts.input = val; i++; break;
      case '--output': case '-o': opts.output = val; i++; break;
      case '--format': case '-f': opts.format = val; i++; break;
      case '--theme': case '-t': opts.theme = val; i++; break;
      case '--bg': opts.bg = val; userColors.bg = val; i++; break;
      case '--fg': opts.fg = val; userColors.fg = val; i++; break;
      case '--line': opts.line = val; userColors.line = val; i++; break;
      case '--accent': opts.accent = val; userColors.accent = val; i++; break;
      case '--muted': opts.muted = val; userColors.muted = val; i++; break;
      case '--surface': opts.surface = val; userColors.surface = val; i++; break;
      case '--border': opts.border = val; userColors.border = val; i++; break;
      case '--font': opts.font = val; i++; break;
      case '--width': opts.width = validateWidth(val, 800); i++; break;
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

  return { ...opts, userColors };
}

async function main() {
  const { userColors, ...opts } = parseArgs();
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
  // For Mermaid rendering, always use defaults (for theme consistency)
  const renderColors = theme || {
    bg: opts.bg,
    fg: opts.fg,
    ...(opts.line && { line: opts.line }),
    ...(opts.accent && { accent: opts.accent }),
    ...(opts.muted && { muted: opts.muted }),
    ...(opts.surface && { surface: opts.surface }),
    ...(opts.border && { border: opts.border }),
  };

  const svg = await renderMermaid(input, {
    ...renderColors,
    font: opts.font,
    transparent: opts.transparent,
  });

  if (opts.format === 'png') {
    // For PNG flattening, only pass user-explicit colors to preserve SVG values
    const flatSvg = flattenSvg(svg, userColors);
    // Generate output path: if input has extension, replace with .png; otherwise append .png
    const outputPath = opts.output || (opts.input.match(/\.[^./]+$/) 
      ? opts.input.replace(/\.[^./]+$/, '.png')
      : `${opts.input}.png`);

    if (svgToPng(flatSvg, outputPath, opts.width)) {
      console.log(`PNG diagram saved to ${outputPath}`);
    } else {
      // Fallback to SVG if PNG conversion fails
      const svgPath = outputPath.endsWith('.png') 
        ? outputPath.replace(/\.png$/, '.svg')
        : `${outputPath}.svg`;
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
