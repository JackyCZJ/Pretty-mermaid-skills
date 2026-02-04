import { describe, it, expect } from 'vitest';
import { flattenSvg, mixColors, hexToRgb, rgbToHex, validateWidth } from '../scripts/svg-utils.mjs';

describe('flattenSvg', () => {
  it('should replace CSS variables with computed values', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        :root { --bg: #FFFFFF; --fg: #000000; }
      </style>
      <rect fill="var(--bg)" stroke="var(--fg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    expect(result).toContain('fill="#FFFFFF"');
    expect(result).toContain('stroke="#000000"');
    expect(result).not.toContain('var(--bg)');
    expect(result).not.toContain('var(--fg)');
  });

  it('should preserve unreferenced CSS variables in style blocks', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        :root { --bg: #FFFFFF; --custom-plugin-var: #123456; }
      </style>
      <rect fill="var(--bg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    // --bg should be removed (it was replaced)
    expect(result).not.toContain('--bg:');
    // --custom-plugin-var should be preserved (not in computed set)
    expect(result).toContain('--custom-plugin-var: #123456');
  });

  it('should handle scoped CSS variables (e.g., .dark theme)', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        :root { --bg: #FFFFFF; --fg: #000000; }
        .dark { --bg: #1a1a1a; --fg: #e5e5e5; }
      </style>
      <rect class="dark" fill="var(--bg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    // Should use the :root values as defaults (global scope)
    expect(result).toContain('fill="#FFFFFF"');
    // The .dark class on rect should be preserved
    expect(result).toContain('class="dark"');
    // Empty .dark CSS rule is removed (no declarations left after variable replacement)
    expect(result).not.toContain('.dark {');
  });

  it('should handle var() with fallback values', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        :root { --bg: #FFFFFF; }
      </style>
      <rect fill="var(--bg, #FF0000)" stroke="var(--undefined, #00FF00)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    // --bg should be replaced
    expect(result).toContain('fill="#FFFFFF"');
    // --undefined is not in computed set, var() should remain or use fallback
    // Since --undefined is not replaced, the var() stays as-is
    expect(result).toContain('var(--undefined, #00FF00)');
  });

  it('should handle single-quoted style attributes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" style='--bg: #FFFFFF; color: red;'>
      <rect fill="var(--bg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    expect(result).toContain('fill="#FFFFFF"');
    // Should preserve color: red, remove --bg
    expect(result).toContain("style='color: red'");
    expect(result).not.toContain('--bg:');
  });

  it('should handle double-quoted style attributes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="--bg: #FFFFFF; color: red;">
      <rect fill="var(--bg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    expect(result).toContain('fill="#FFFFFF"');
    expect(result).toContain('style="color: red"');
    expect(result).not.toContain('--bg:');
  });

  it('should handle mixed quotes in same SVG', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="--bg: #FFFFFF;">
      <g style='--fg: #000000;'>
        <rect fill="var(--bg)" stroke="var(--fg)" />
      </g>
    </svg>`;
    
    const result = flattenSvg(svg, {});
    expect(result).toContain('fill="#FFFFFF"');
    expect(result).toContain('stroke="#000000"');
  });

  it('should apply color overrides correctly', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        :root { --bg: #FFFFFF; --fg: #000000; }
      </style>
      <rect fill="var(--bg)" stroke="var(--fg)" />
    </svg>`;
    
    const result = flattenSvg(svg, { '--bg': '#123456', '--fg': '#654321' });
    expect(result).toContain('fill="#123456"');
    expect(result).toContain('stroke="#654321"');
  });

  it('should prioritize user-provided colors over SVG CSS variables', () => {
    // Test: user provides bg/fg (without -- prefix) which should override SVG's --bg/--fg
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        :root { --bg: #FFFFFF; --fg: #000000; }
      </style>
      <rect fill="var(--bg)" stroke="var(--fg)" />
    </svg>`;
    
    // User provides colors without -- prefix (shorthand form)
    const result = flattenSvg(svg, { bg: '#AABBCC', fg: '#DDEEFF' });
    expect(result).toContain('fill="#AABBCC"');
    expect(result).toContain('stroke="#DDEEFF"');
    // Should NOT use the SVG's #FFFFFF/#000000
    expect(result).not.toContain('fill="#FFFFFF"');
    expect(result).not.toContain('stroke="#000000"');
  });

  it('should compute derived colors from provided overrides', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <rect fill="var(--surface)" stroke="var(--border)" />
    </svg>`;
    
    const result = flattenSvg(svg, { '--bg': '#FFFFFF', '--fg': '#000000' });
    // --surface and --border are computed from bg/fg
    expect(result).toContain('fill=');
    expect(result).toContain('stroke=');
    expect(result).not.toContain('var(--surface)');
    expect(result).not.toContain('var(--border)');
  });

  it('should remove empty style attributes', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="--bg: #FFFFFF;">
      <rect fill="var(--bg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    // After removing --bg, style attribute should be removed entirely
    expect(result).not.toMatch(/style=["'][^"']*["']/);
  });

  it('should preserve non-CSS custom properties in style', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="--bg: #FFFFFF; color: red; display: block;">
      <rect fill="var(--bg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    expect(result).toContain('color: red');
    expect(result).toContain('display: block');
    expect(result).not.toContain('--bg:');
  });

  it('should handle complex Mermaid SVG structure', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" style="--bg: #f4f4f5; --fg: #27272a;">
      <style>
        .node rect { fill: var(--surface); stroke: var(--border); }
        .edge path { stroke: var(--line); }
        .dark { --bg: #18181b; --fg: #fafafa; }
      </style>
      <g class="node">
        <rect fill="var(--surface)" stroke="var(--border)" />
      </g>
      <g class="edge">
        <path stroke="var(--line)" />
      </g>
    </svg>`;
    
    const result = flattenSvg(svg, {});
    // Variables should be replaced
    expect(result).not.toContain('var(--surface)');
    expect(result).not.toContain('var(--border)');
    expect(result).not.toContain('var(--line)');
    // .dark rule is removed (empty after variable replacement)
    expect(result).not.toContain('.dark {');
  });

  it('should handle empty style blocks', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        :root { --bg: #FFFFFF; }
      </style>
      <rect fill="var(--bg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    // After removing --bg, style block should be removed
    expect(result).not.toContain('<style>');
  });

  it('should preserve @media and other CSS rules', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        :root { --bg: #FFFFFF; }
        @media print {
          rect { fill: #000000; }
        }
      </style>
      <rect fill="var(--bg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    expect(result).toContain('@media print');
    expect(result).toContain('rect { fill: #000000; }');
  });

  it('should handle CSS variables with complex values containing semicolons', () => {
    // This tests the non-greedy regex fix for variable value parsing
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>
        :root { 
          --bg: #FFFFFF;
          --font-stack: "Inter", system-ui, sans-serif;
        }
      </style>
      <rect fill="var(--bg)" />
    </svg>`;
    
    const result = flattenSvg(svg, {});
    // --bg should be replaced and removed
    expect(result).toContain('fill="#FFFFFF"');
    expect(result).not.toContain('--bg:');
    // --font-stack should be preserved (not in computed set)
    expect(result).toContain('--font-stack:');
  });

  it('should handle var() fallback with nested parentheses (rgb, var)', () => {
    // Test: fallback contains rgb() with parentheses
    const svg1 = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>:root { --bg: #FFFFFF; }</style>
      <rect fill="var(--bg, rgb(0,0,0))" />
    </svg>`;
    
    const result1 = flattenSvg(svg1, {});
    // Should replace correctly without leaving extra )
    expect(result1).toContain('fill="#FFFFFF"');
    expect(result1).not.toContain('fill="#FFFFFF)"');
    expect(result1).not.toContain('rgb(0,0,0)');

    // Test: fallback contains another var()
    const svg2 = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>:root { --bg: #FFFFFF; --fallback: #CCCCCC; }</style>
      <rect fill="var(--bg, var(--fallback))" />
    </svg>`;
    
    const result2 = flattenSvg(svg2, {});
    expect(result2).toContain('fill="#FFFFFF"');
    expect(result2).not.toContain('var(--fallback)');
  });
});

describe('mixColors', () => {
  it('should mix two colors correctly', () => {
    expect(mixColors('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixColors('#FF0000', '#000000', 0.5)).toBe('#800000');
    expect(mixColors('#00FF00', '#000000', 0.5)).toBe('#008000');
    expect(mixColors('#0000FF', '#000000', 0.5)).toBe('#000080');
  });

  it('should handle edge ratios', () => {
    expect(mixColors('#FF0000', '#000000', 0)).toBe('#000000');
    expect(mixColors('#FF0000', '#000000', 1)).toBe('#ff0000'); // rgbToHex returns lowercase
  });
});

describe('hexToRgb', () => {
  it('should parse 6-character hex', () => {
    expect(hexToRgb('#FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('should parse 3-character shorthand hex', () => {
    expect(hexToRgb('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('#000')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#F00')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('should handle hex without leading #', () => {
    expect(hexToRgb('FFFFFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb('FFF')).toEqual({ r: 255, g: 255, b: 255 });
  });

  it('should return null for invalid hex', () => {
    expect(hexToRgb('invalid')).toBeNull();
    expect(hexToRgb('#GGGGGG')).toBeNull();
    expect(hexToRgb('#FF')).toBeNull();
  });
});

describe('rgbToHex', () => {
  it('should convert RGB to hex', () => {
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 0, 0)).toBe('#ff0000');
  });

  it('should pad single digit values', () => {
    expect(rgbToHex(1, 2, 3)).toBe('#010203');
    expect(rgbToHex(15, 15, 15)).toBe('#0f0f0f');
  });
});

describe('validateWidth', () => {
  it('should accept valid widths', () => {
    expect(validateWidth(100)).toBe(100);
    expect(validateWidth(800)).toBe(800);
    expect(validateWidth(10000)).toBe(10000);
    expect(validateWidth('500')).toBe(500);
  });

  it('should reject too small widths', () => {
    expect(validateWidth(99)).toBe(800);
    expect(validateWidth(0)).toBe(800);
    expect(validateWidth(-100)).toBe(800);
  });

  it('should reject too large widths', () => {
    expect(validateWidth(10001)).toBe(800);
    expect(validateWidth(50000)).toBe(800);
  });

  it('should handle invalid inputs', () => {
    expect(validateWidth(NaN)).toBe(800);
    expect(validateWidth('invalid')).toBe(800);
    expect(validateWidth(null)).toBe(800);
    expect(validateWidth(undefined)).toBe(800);
  });

  it('should use custom default', () => {
    expect(validateWidth(50, 1200)).toBe(1200);
    expect(validateWidth('bad', 600)).toBe(600);
  });
});
