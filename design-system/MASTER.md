# jsMedgl Design System — MASTER

## Design Decisions

### Style: Developer Tool + Dark Tech
- Vercel/Linear-inspired dark theme
- Monospace + geometric sans pairing
- Subtle glow accents, not full neon HUD

### Colors
- Background: `#09090B` (zinc-950)
- Surface: `#18181B` (zinc-900)
- Surface Elevated: `#27272A` (zinc-800)
- Border: `#3F3F46` (zinc-700)
- Primary text: `#FAFAFA` (zinc-50)
- Secondary text: `#A1A1AA` (zinc-400)
- Accent: `#6366F1` (indigo-500)
- Accent Glow: `#818CF8` (indigo-400)
- Success: `#22C55E`
- Muted: `#71717A`

### Typography
- Heading Font: **Space Grotesk** (Google Fonts) — distinctive, technical
- Body Font: **Inter** (Google Fonts) — clean, readable
- Mono Font: **JetBrains Mono** (Google Fonts) — code examples
- Scale: 14/16/18/24/32/48/64px
- Line-height: 1.5-1.75 for body, 1.1-1.2 for headings

### Effects
- Card glow border on hover (box-shadow with accent color, 0→intensity on hover)
- Gradient text for hero headings (accent → lighter indigo)
- Backdrop blur on navbar
- Fade-in-up animations on scroll (IntersectionObserver)
- Subtle grid/dot pattern background on hero
- Transition: 150-300ms ease-out

### Anti-Patterns
- No emojis as icons (use SVG/Lucide)
- No flat design on cards (need depth/glow)
- No horizontal scroll on mobile
- No raw hex values in components (use CSS vars/Tailwind vars)

## Component Rules

### Cards
- `bg-zinc-900` surface
- `border border-zinc-800` default
- `hover:border-indigo-500/50` + `hover:shadow-[0_0_20px_rgba(99,102,241,0.15)]` glow
- `rounded-xl` corners
- `p-6` padding

### Buttons
- Primary: `bg-indigo-600 hover:bg-indigo-500 text-white`
- Secondary: `bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700`
- `rounded-lg`, `px-5 py-2.5`, `font-medium`, `transition-all duration-200`

### Navbar
- Fixed top, `backdrop-blur-md bg-black/50`, `border-b border-zinc-800/50`
- Z-index: 50
- Logo left, nav center, links right

### Section spacing
- `py-24 md:py-32` vertical padding
- Max-width `max-w-6xl mx-auto px-4`

### Code blocks
- Shiki syntax highlighting, `github-dark` theme
- `bg-zinc-950 rounded-xl border border-zinc-800 overflow-hidden`

## Accessibility
- All text contrast ≥4.5:1
- Touch targets ≥44px
- Focus rings visible
- prefers-reduced-motion respected
