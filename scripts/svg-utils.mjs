#!/usr/bin/env node
// Shared utilities for SVG processing and PNG conversion

import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * Extract CSS variables from SVG (style attribute and <style> blocks)
 * @param {string} svg - The SVG content
 * @returns {object} CSS variables map
 */
function extractCssVars(svg) {
  const cssVars = {};
  
  // 1. Extract from style attribute
  const styleMatch = svg.match(/style=("|')([^"']*)\1/);
  if (styleMatch) {
    const style = styleMatch[2];
    const varMatches = style.matchAll(/--([\w-]+):([^;]+)/g);
    for (const match of varMatches) {
      cssVars[`--${match[1].trim()}`] = match[2].trim();
    }
  }
  
  // 2. Extract from <style> blocks (including :root, svg, etc.)
  const styleBlocks = svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  for (const block of styleBlocks) {
    const styleContent = block[1];
    // Match variable declarations in CSS rules
    const varMatches = styleContent.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g);
    for (const match of varMatches) {
      cssVars[`--${match[1].trim()}`] = match[2].trim();
    }
  }
  
  return cssVars;
}

/**
 * Convert SVG with CSS variables to flat SVG with actual colors
 * @param {string} svg - The SVG content
 * @param {object} colors - Color overrides
 * @returns {string} Flattened SVG
 */
export function flattenSvg(svg, colors) {
  // Extract CSS variables from all sources
  const cssVars = extractCssVars(svg);
  
  // Merge with provided colors (provided colors take precedence)
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

  // Replace CSS variables with actual values in a single pass
  // Support both var(--name) and var(--name, fallback)
  const varNames = Object.keys(computed);
  const escapedVarNames = varNames.map((name) =>
    name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  );
  // Match var(--name) or var(--name, fallback) - capture the variable name
  const varRegex = new RegExp(`var\\((${escapedVarNames.join('|')})(?:\\s*,\\s*[^)]+)?\\)`, 'g');

  let flatSvg = svg.replace(varRegex, (match, varName) => {
    const replacement = computed[varName];
    return typeof replacement === 'string' ? replacement : match;
  });

  // Remove CSS custom properties from style attributes
  flatSvg = flatSvg.replace(/style=("|')([^"]*)\1/g, (fullMatch, quote, styleContent) => {
    const declarations = styleContent
      .split(';')
      .map(part => part.trim())
      .filter(part => part.length > 0);

    const kept = declarations.filter(part => {
      const colonIndex = part.indexOf(':');
      if (colonIndex === -1) return true;
      const propName = part.slice(0, colonIndex).trim();
      return !propName.startsWith('--');
    });

    if (kept.length === 0) {
      return '';
    }

    const cleanedContent = kept.join('; ');
    return `style=${quote}${cleanedContent}${quote}`;
  });

  // Remove only @import lines and CSS variable definitions from style blocks
  flatSvg = flatSvg.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, styleContent) => {
    let cleanedContent = styleContent
      // Remove @import statements
      .replace(/@import\s+[^;]+;/gi, '')
      // Remove CSS variable declarations (--var-name: value;)
      .replace(/--[\w-]+\s*:\s*[^;]+;/gi, '')
      // Clean up extra whitespace
      .replace(/\n\s*\n/g, '\n')
      .trim();
    
    if (!cleanedContent) {
      return '';
    }
    return `<style>${cleanedContent}</style>`;
  });

  return flatSvg;
}

/**
 * Mix two colors with a given ratio
 * @param {string} fg - Foreground color (hex)
 * @param {string} bg - Background color (hex)
 * @param {number} ratio - Mix ratio (0-1)
 * @returns {string} Mixed color (hex)
 */
export function mixColors(fg, bg, ratio) {
  const fgRgb = hexToRgb(fg);
  const bgRgb = hexToRgb(bg);
  if (!fgRgb || !bgRgb) return fg;

  const r = Math.round(bgRgb.r + (fgRgb.r - bgRgb.r) * ratio);
  const g = Math.round(bgRgb.g + (fgRgb.g - bgRgb.g) * ratio);
  const b = Math.round(bgRgb.b + (fgRgb.b - bgRgb.b) * ratio);

  return rgbToHex(r, g, b);
}

/**
 * Convert hex color to RGB object
 * Supports 3-char (#FFF) and 6-char (#FFFFFF) formats
 * @param {string} hex - Hex color string
 * @returns {object|null} RGB object or null if invalid
 */
export function hexToRgb(hex) {
  if (typeof hex !== 'string') return null;
  let value = hex.trim();

  // Ensure leading '#'
  if (!value.startsWith('#')) {
    value = '#' + value;
  }

  // Handle 3-character shorthand, e.g. #FFF
  let match = value.match(/^#([0-9a-fA-F]{3})$/);
  if (match) {
    const r = parseInt(match[1][0] + match[1][0], 16);
    const g = parseInt(match[1][1] + match[1][1], 16);
    const b = parseInt(match[1][2] + match[1][2], 16);
    return { r, g, b };
  }

  // Handle full 6-character hex, e.g. #FFFFFF
  match = value.match(/^#([0-9a-fA-F]{6})$/);
  if (!match) return null;

  const bigint = parseInt(match[1], 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
}

/**
 * Convert RGB values to hex color
 * @param {number} r - Red (0-255)
 * @param {number} g - Green (0-255)
 * @param {number} b - Blue (0-255)
 * @returns {string} Hex color string
 */
export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Validate and sanitize width parameter
 * @param {string|number} width - Input width
 * @param {number} defaultWidth - Default value if invalid
 * @returns {number} Validated width
 */
export function validateWidth(width, defaultWidth = 800) {
  const parsed = parseInt(width, 10);
  if (isNaN(parsed) || parsed < 100 || parsed > 10000) {
    return defaultWidth;
  }
  return parsed;
}

/**
 * Sanitize a filename to prevent command injection
 * @param {string} filename - Input filename
 * @returns {string} Sanitized filename
 */
export function sanitizeFilename(filename) {
  // Remove any characters that could be used for command injection
  // Allow only alphanumeric, dash, underscore, dot, and forward slash
  return filename.replace(/[^a-zA-Z0-9_./-]/g, '');
}

/**
 * Get platform-specific installation instructions for rsvg-convert
 * @returns {string} Installation instructions
 */
export function getRsvgInstallHelp() {
  const platform = process.platform;

  if (platform === 'darwin') {
    return 'Make sure rsvg-convert (librsvg) is installed. On macOS you can install it with:\n  brew install librsvg';
  } else if (platform === 'linux') {
    return 'Make sure rsvg-convert (librsvg) is installed. On Linux you can typically install it with:\n  Debian/Ubuntu: sudo apt-get install librsvg2-bin\n  Fedora/RHEL:   sudo dnf install librsvg2-tools\n  Arch Linux:    sudo pacman -S librsvg';
  } else if (platform === 'win32') {
    return 'Make sure rsvg-convert (librsvg) is installed and available in your PATH.\nOn Windows you can install it via:\n  choco install librsvg   (Chocolatey)\n  scoop install librsvg   (Scoop)\nOr use a package from MSYS2 or another distribution that provides librsvg.';
  }
  return 'Make sure rsvg-convert (librsvg) is installed and available on your PATH.\nSee https://wiki.gnome.org/Projects/LibRsvg for installation instructions.';
}

/**
 * Convert SVG to PNG using rsvg-convert
 * @param {string} svg - SVG content
 * @param {string} outputPath - Output PNG path
 * @param {number} width - Output width in pixels
 * @returns {boolean} Success status
 */
export function svgToPng(svg, outputPath, width = 800) {
  // Validate width
  const validWidth = validateWidth(width, 800);

  // Create temp file in system temp directory with random name
  const randomId = randomBytes(8).toString('hex');
  const tempSvg = join(tmpdir(), `mermaid-${randomId}.temp.svg`);

  try {
    // Write temp file inside try so errors can be caught
    writeFileSync(tempSvg, svg);
    
    // Use spawnSync with array arguments to prevent injection
    const result = spawnSync('rsvg-convert', [
      '--width', String(validWidth),
      tempSvg,
      '-o', outputPath
    ], {
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 30000,
    });
    
    if (result.error) {
      if (result.error.code === 'ENOENT') {
        throw new Error('rsvg-convert not found on PATH');
      }
      throw new Error(`spawn error: ${result.error.message} (code: ${result.error.code})`);
    }
    if (result.status !== 0) {
      throw new Error(`rsvg-convert exited with code ${result.status}`);
    }
    return true;
  } catch (e) {
    console.error(`PNG conversion failed: ${e.message}`);
    console.error(getRsvgInstallHelp());
    return false;
  } finally {
    // Clean up temp file
    try {
      unlinkSync(tempSvg);
    } catch (cleanupErr) {
      // Ignore cleanup errors
    }
  }
}
