import chalk from "chalk";
import type { Persona } from "../types.ts";

export function extractBotImagePrompts(text: string): {
  cleanBody: string;
  imagePrompts: string[];
} {
  const imagePrompts: string[] = [];
  const cleanBody = text
    .replace(
      /\[\s*(?:IMAGINE|ART|DRAW)\s*:\s*([^\]]+?)\s*\]/gi,
      (_match, rawPrompt: string) => {
        const cleaned = rawPrompt?.trim();
        if (cleaned) {
          imagePrompts.push(cleaned);
        }
        return "";
      }
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return { cleanBody, imagePrompts };
}

export function buildEraStyledImagePrompt(
  rawPrompt: string,
  persona?: Persona
): {
  styledPrompt: string;
  eraStyle: string;
} {
  const clean = rawPrompt.trim();
  if (!persona) {
    return {
      eraStyle: "Retro CRT Latent-Space Art",
      styledPrompt: `${clean} — styled as vibrant late-1990s Dracula CRT digital cyber-art, neon #50fa7b and #8be9fd palette on dark #191a22 background`,
    };
  }

  switch (persona.eraGroup) {
    case "1966-2016: Pioneers":
      return {
        eraStyle: `1966–2016 Pioneer CRT (${persona.era})`,
        styledPrompt: `${clean} — rendered as 1966 PDP-10 green-phosphor oscilloscope vector wireframe graphics and vintage teletype line art on a dark CRT monitor`,
      };
    case "2019-2022: Pre-ChatGPT":
      return {
        eraStyle: `2019–2022 Pre-ChatGPT Surrealism (${persona.era})`,
        styledPrompt: `${clean} — rendered in nostalgic 2022 DALL-E Mini / Craiyon low-fi surrealist dream grid aesthetic, slightly uncanny early latent-space painting`,
      };
    case "2022-2023: Early RLHF":
      return {
        eraStyle: `2022–2023 Early RLHF Glitch-Core (${persona.era})`,
        styledPrompt: `${clean} — rendered as dramatic 2023 Y2K cyber-glitch illustration with high-contrast magenta, cyan, and search-engine collage elements`,
      };
    case "2024-2026: Frontier & Open":
      return {
        eraStyle: `2024–2026 Frontier Sacred Geometry (${persona.era})`,
        styledPrompt: `${clean} — rendered as luminous 2026 sacred Fibonacci geometry, intricate latent-space manifold blueprint, and cosmic chalkboard diagrams`,
      };
    default:
      return {
        eraStyle: `Custom Persona Vision (${persona.era})`,
        styledPrompt: `${clean} — rendered in the signature aesthetic of ${persona.displayName} (${persona.era}), retro-futuristic CRT palette`,
      };
  }
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

/**
 * Generates a compact 6-row ANSI half-block (`▀`) pixel art preview for the Terminal TUI.
 */
export function renderAnsiCardPreview(
  prompt: string,
  persona?: Persona
): string {
  const seed = hashSeed(`${persona?.id ?? "human"}:${prompt}`);
  const accent = persona?.color || "#50fa7b";
  const palette = [
    "#191a22",
    "#282a36",
    accent,
    "#8be9fd",
    "#bd93f9",
    "#ff79c6",
    "#ffb86c",
    "#f1fa8c",
  ];

  const width = 24;
  const height = 10; // 5 terminal rows using upper half-block ▀
  const rows: string[] = [];
  const borderColor = chalk.hex(accent);

  rows.push(
    `    ${borderColor("┌" + "─".repeat(width) + "┐")}`
  );

  for (let y = 0; y < height; y += 2) {
    let line = "";
    for (let x = 0; x < width; x++) {
      const cx = (x - width / 2) / (width / 2);
      const cyTop = (y - height / 2) / (height / 2);
      const cyBot = (y + 1 - height / 2) / (height / 2);

      const distTop = Math.sqrt(cx * cx + cyTop * cyTop);
      const distBot = Math.sqrt(cx * cx + cyBot * cyBot);
      const waveTop = Math.sin(x * 0.5 + (seed % 13)) * 0.4;
      const waveBot = Math.cos((y + 1) * 0.6 + (seed % 7)) * 0.4;

      const idxTop =
        Math.abs(Math.floor((distTop * 5 + waveTop * 3 + (seed % 5)) * 2)) %
        palette.length;
      const idxBot =
        Math.abs(Math.floor((distBot * 5 + waveBot * 3 + (seed % 11)) * 2)) %
        palette.length;

      const fg = palette[idxTop]!;
      const bg = palette[idxBot]!;
      line += chalk.bgHex(bg).hex(fg)("▀");
    }
    rows.push(`    ${borderColor("│")}${line}${borderColor("│")}`);
  }

  rows.push(
    `    ${borderColor("└" + "─".repeat(width) + "┘")}`
  );
  return rows.join("\n");
}

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates an era-authentic Dracula CRT SVG Data URI when running offline
 * or without an active image-generation API key.
 */
export function generateRetroSvgDataUri(
  prompt: string,
  persona?: Persona
): string {
  const seed = hashSeed(`${persona?.id ?? "human"}:${prompt}`);
  const accent = persona?.color || "#50fa7b";
  const secondary =
    persona?.eraGroup === "1966-2016: Pioneers"
      ? "#50fa7b"
      : persona?.eraGroup === "2019-2022: Pre-ChatGPT"
        ? "#ffb86c"
        : persona?.eraGroup === "2022-2023: Early RLHF"
          ? "#ff79c6"
          : "#bd93f9";

  const authorTag = persona
    ? `<${persona.nick}> (${persona.era})`
    : "LATENT-SPACE CONJURER";
  const shortPrompt =
    prompt.length > 54 ? `${prompt.slice(0, 51)}...` : prompt;

  // Build era-inspired vector shapes
  const shapes: string[] = [];
  if (persona?.eraGroup === "1966-2016: Pioneers") {
    // Oscilloscope sine wave + phosphor radar rings
    const pts: string[] = [];
    for (let x = 20; x <= 460; x += 10) {
      const y =
        125 +
        Math.sin((x + (seed % 40)) * 0.06) * 42 +
        Math.cos(x * 0.13) * 14;
      pts.push(`${x},${y.toFixed(1)}`);
    }
    shapes.push(
      `<circle cx="240" cy="125" r="72" fill="none" stroke="${accent}" stroke-opacity="0.35" stroke-dasharray="4 4"/>`,
      `<polyline points="${pts.join(" ")}" fill="none" stroke="${accent}" stroke-width="2.5"/>`
    );
  } else if (persona?.eraGroup === "2019-2022: Pre-ChatGPT") {
    // 3x3 Craiyon-style surrealist dream tiles
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const x = 95 + c * 100;
        const y = 55 + r * 68;
        const hueCol = (r + c + seed) % 2 === 0 ? accent : secondary;
        shapes.push(
          `<rect x="${x}" y="${y}" width="88" height="58" rx="6" fill="${hueCol}" fill-opacity="0.18" stroke="${hueCol}" stroke-width="1.5"/>`,
          `<circle cx="${x + 44}" cy="${y + 29}" r="${12 + ((seed + r * 7 + c * 5) % 14)}" fill="${hueCol}" fill-opacity="0.35"/>`
        );
      }
    }
  } else {
    // Sacred geometry / cyber-glitch rings & star polygon
    for (let i = 0; i < 6; i++) {
      const r = 22 + i * 14;
      const col = i % 2 === 0 ? accent : secondary;
      shapes.push(
        `<circle cx="240" cy="120" r="${r}" fill="none" stroke="${col}" stroke-opacity="${(0.75 - i * 0.09).toFixed(2)}" stroke-width="1.8"/>`
      );
    }
    shapes.push(
      `<polygon points="240,42 295,158 185,158" fill="none" stroke="${accent}" stroke-width="1.8" stroke-opacity="0.7"/>`,
      `<polygon points="240,192 295,78 185,78" fill="none" stroke="${secondary}" stroke-width="1.8" stroke-opacity="0.7"/>`
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 260" width="480" height="260">
  <rect width="480" height="260" rx="8" fill="#14151d" stroke="${accent}" stroke-width="2"/>
  <line x1="0" y1="32" x2="480" y2="32" stroke="#44475a" stroke-width="1"/>
  <text x="14" y="21" fill="${accent}" font-family="monospace" font-size="12" font-weight="bold">🎨 ${escapeXml(authorTag)}</text>
  ${shapes.join("\n  ")}
  <rect x="12" y="212" width="456" height="36" rx="4" fill="#21222c" stroke="#44475a" stroke-width="1"/>
  <text x="22" y="235" fill="#f8f8f2" font-family="monospace" font-size="12">&quot;${escapeXml(shortPrompt)}&quot;</text>
</svg>`;

  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
