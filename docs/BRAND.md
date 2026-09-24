# VOIDSTRIKE — Brand & UI System

## Identity

- **Name**: VOIDSTRIKE (all caps, always). Product line: *Voidstrike — Arena Protocol*.
- **Voice**: military-precise, zero fluff. Short sentences. Verbs first.
- **Version chip**: `PROTOCOL v1 · rules_hash 0x…` appears in HUD footers.

## Palette

| Token | Hex | Usage |
|---|---|---|
| `void` | `#07080A` | App background |
| `panel` | `#0E1013` | Cards, HUD panels |
| `line` | `rgba(255,255,255,0.08)` | Hairline borders |
| `ink` | `#E8ECEF` | Primary text |
| `muted` | `#8A939E` | Secondary text |
| `volt` | `#C8F31D` | Primary accent (CTAs, player, combo) |
| `flare` | `#FF3D5A` | Danger, enemies, damage |
| `amber` | `#FFB020` | Warnings, wave banners |
| `mint` | `#29E086` | Success, heals, rank-up |

**Forbidden**: purple/indigo/blue gradients, glossy buttons, rounded-blob cards, drop-shadow-everything. This is a sharp, angular, esports-grade system.

## Typography

- **Display**: Chakra Petch (600/700) — headings, logo lockup.
- **Body**: Inter (400/500).
- **Numerals/HUD**: JetBrains Mono — all scores, timers, stats.

## Motifs

- 1px hairline borders; sharp corners (`rounded-none`); occasional 12° clip-path cuts.
- Background: faint engineering grid (24px) + optional scanline overlay at 4% opacity.
- Motion: Framer Motion, 150–250ms, ease-out; no bouncy springs on HUD.

## Component Rules

- Buttons: sharp corners, `volt` fill with `void` text for primary; outline hairline for secondary.
- Tables/leaderboards: mono numerals, right-aligned figures, row hover `panel`.
- Focus states: 1px `volt` outline, never removed.
- Touch targets ≥ 44px; footer sticky via `min-h-screen flex flex-col` + `mt-auto`.
