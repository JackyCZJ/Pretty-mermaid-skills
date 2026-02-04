#!/usr/bin/env node
// Shared utilities for SVG processing and PNG conversion

import { spawnSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';

/**
 * Parse CSS rules from style content, preserving selector scope
 * @param {string} styleContent - CSS content
 * @returns {Array<{selector: string, declarations: Map<string, string>}>}
 */
function parseCssRules(styleContent) {
  const rules = [];
  // Match CSS rules: selector { declarations }
  const ruleRegex = /([^{]+)\{([^}]*)\}/g;
  let match;
  
  while ((match = ruleRegex.exec(styleContent)) !== null) {
    const selector = match[1].trim();
    const declBlock = match[2];
    const declarations = new Map();
    
    // Parse declarations within this rule
    const declMatches = declBlock.matchAll(/--([\w-]+)\s*:\s*([^;]+)/g);
    for (const decl of declMatches) {
      declarations.set(`--${decl[1].trim()}`, decl[2].trim());
    }
    
    if (declarations.size > 0) {
      rules.push({ selector, declarations });
    }
  }
  
  return rules;
}

/**
 * Extract CSS variables from SVG, preserving selector scope
 * @param {string} svg - The SVG content
 * @returns {object} CSS variables map with scope info
 */
function extractCssVars(svg) {
  const cssVars = {
    inline: {},      // From style attributes (merged from all elements)
    scoped: [],      // From <style> blocks with selectors
    global: {}       // From :root, svg, etc. (treated as global)
  };
  
  // 1. Extract from ALL style attributes (inline, highest specificity)
  // Use matchAll to find all style attributes, not just the first one
  const styleMatches = svg.matchAll(/style=(["'])([^"']*?)\1/g);
  for (const styleMatch of styleMatches) {
    const style = styleMatch[2];
    const varMatches = style.matchAll(/--([\w-]+):([^;]+)/g);
    for (const match of varMatches) {
      cssVars.inline[`--${match[1].trim()}`] = match[2].trim();
    }
  }
  
  // 2. Extract from <style> blocks, preserving scope
  const styleBlocks = svg.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi);
  for (const block of styleBlocks) {
    const styleContent = block[1];
    const rules = parseCssRules(styleContent);
    
    for (const rule of rules) {
      // Treat :root, html, body, svg as global scope
      const isGlobal = /^(::?root|html|body|svg|\*)$/i.test(rule.selector);
      
      if (isGlobal) {
        for (const [name, value] of rule.declarations) {
          cssVars.global[name] = value;
        }
      } else {
        cssVars.scoped.push(rule);
      }
    }
  }
  
  return cssVars;
}

/**
 * Get effective variable value considering scope
 * @param {object} cssVars - Parsed CSS variables
 * @param {string} varName - Variable name
 * @param {string} context - Context for scope matching (e.g., 'dark', 'light')
 * @returns {string|undefined}
 */
function getScopedVar(cssVars, varName, context = '') {
  // Priority: inline > scoped (matching context) > global
  if (cssVars.inline[varName] !== undefined) {
    return cssVars.inline[varName];
  }
  
  // Check scoped rules that match context
  for (const rule of cssVars.scoped) {
    if (context && rule.selector.includes(context)) {
      if (rule.declarations.has(varName)) {
        return rule.declarations.get(varName);
      }
    }
  }
  
  return cssVars.global[varName];
}

/**
 * Convert SVG with CSS variables to flat SVG with actual colors
 * @param {string} svg - The SVG content
 * @param {object} colors - Color overrides
 * @returns {string} Flattened SVG
 */
export function flattenSvg(svg, colors) {
  // Extract CSS variables with scope preservation
  const cssVars = extractCssVars(svg);
  
  // Build effective variable map (merge inline + global, with overrides)
  const effectiveVars = { 
    ...cssVars.global, 
    ...cssVars.inline,
    ...colors 
  };

  // Compute derived colors
  // Priority: user-provided colors (bg/fg) > SVG CSS variables (--bg/--fg) > defaults
  const bg = effectiveVars.bg || effectiveVars['--bg'] || '#FFFFFF';
  const fg = effectiveVars.fg || effectiveVars['--fg'] || '#27272A';
  const line = effectiveVars.line || effectiveVars['--line'] || mixColors(fg, bg, 0.3);
  const accent = effectiveVars.accent || effectiveVars['--accent'] || mixColors(fg, bg, 0.5);
  const muted = effectiveVars.muted || effectiveVars['--muted'] || mixColors(fg, bg, 0.4);
  const surface = effectiveVars.surface || effectiveVars['--surface'] || mixColors(fg, bg, 0.03);
  const border = effectiveVars.border || effectiveVars['--border'] || mixColors(fg, bg, 0.2);

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

  // Track which variables we're replacing
  const replacedVars = new Set(Object.keys(computed));

  // Replace CSS variables with actual values in a single pass
  // Support both var(--name) and var(--name, fallback)
  const varNames = Object.keys(computed);
  const escapedVarNames = varNames.map((name) =>
    name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
  );
  // Match var(--name) or var(--name, fallback) - handle nested parentheses in fallback
  // Use a depth-based approach to match balanced parentheses
  const varRegex = new RegExp(`var\\((${escapedVarNames.join('|')})(?:\\s*,\\s*([\\s\\S]*?))?\\)(?![^(]*\\))`, 'g');

  let flatSvg = svg.replace(varRegex, (match, varName, fallback) => {
    const replacement = computed[varName];
    return typeof replacement === 'string' ? replacement : match;
  });

  // Remove CSS custom properties from style attributes
  // Handle both single and double quotes: style="..." or style='...'
  flatSvg = flatSvg.replace(/style=(["'])([^"']*?)\1/g, (fullMatch, quote, styleContent) => {
    const declarations = styleContent
      .split(';')
      .map(part => part.trim())
      .filter(part => part.length > 0);

    const kept = declarations.filter(part => {
      const colonIndex = part.indexOf(':');
      if (colonIndex === -1) return true;
      const propName = part.slice(0, colonIndex).trim();
      // Only remove variables that were replaced, keep others
      if (!propName.startsWith('--')) return true;
      return !replacedVars.has(propName);
    });

    if (kept.length === 0) {
      return '';
    }

    const cleanedContent = kept.join('; ');
    return `style=${quote}${cleanedContent}${quote}`;
  });

  // Clean up style blocks: remove @import and only remove CSS variable declarations
  // that were actually replaced, preserve unreferenced variables
  flatSvg = flatSvg.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (match, styleContent) => {
    let cleanedContent = styleContent
      // Remove @import statements (handle parentheses properly for URLs with semicolons)
      .replace(/@import\s+url\([^)]+\);?/gi, '')
      .replace(/@import\s+["'][^"']+["'];?/gi, '');
    
    // Remove only the CSS variable declarations that we replaced
    // Build regex for replaced variables only
    if (replacedVars.size > 0) {
      const escapedReplaced = Array.from(replacedVars).map(name =>
        name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
      );
      const removeRegex = new RegExp(`\\s*(${escapedReplaced.join('|')})\\s*:\\s*[^;]*?;`, 'g');
      cleanedContent = cleanedContent.replace(removeRegex, '');
    }
    
    // Clean up whitespace
    cleanedContent = cleanedContent
      .replace(/\n\s*\n/g, '\n')
      .trim();
    
    // Remove CSS rules that have no declarations (like `:root { }` after removing variables)
    // Match selector { optional whitespace } with no declarations in between
    // Selector can contain letters, numbers, hyphens, colons, dots, spaces, etc.
    cleanedContent = cleanedContent
      .replace(/[^{}]+?\{\s*\}/g, '')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    
    // Only remove style blocks that are completely empty
    const hasContent = /[^{}\s]/.test(cleanedContent);
    
    if (!hasContent) {
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
