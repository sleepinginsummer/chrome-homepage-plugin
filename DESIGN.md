---
name: Smart Search
description: A fast personal new-tab workspace with cyber-dark and neo-brutalist themes.
colors:
  cyber-background: "#020408"
  cyber-accent: "#00F2FF"
  cyber-text: "#E0E0E0"
  brutal-background: "#E4E7E3"
  brutal-surface: "#F5F6F3"
  brutal-surface-muted: "#CDD3CE"
  brutal-ink: "#171717"
  brutal-primary: "#315EFB"
  brutal-primary-hover: "#2449CC"
  brutal-primary-active: "#1939A6"
  brutal-on-primary: "#FFFFFF"
  brutal-accent: "#FF6B5E"
  brutal-success: "#126A3A"
  brutal-error: "#A9271E"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "2rem"
    fontWeight: 800
    lineHeight: 1.2
    letterSpacing: "0"
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.04em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.brutal-primary}"
    textColor: "{colors.brutal-on-primary}"
    rounded: "{rounded.md}"
    height: "44px"
    padding: "0 20px"

---

# Design System: Smart Search

## 1. Overview

**Creative North Star: "Two Modes, One Command Surface"**

Smart Search is a compact work surface rather than a decorative dashboard. Its default cyber-dark theme remains intact; neo-brutalism uses a clean concrete-gray canvas, black structure, cobalt actions, and sparse coral emphasis.

Each theme owns a complete visual vocabulary without leaking into the others. Elevation communicates interaction, real cards and weather imagery retain their identity, and responsive changes preserve the same information order. Decorative patterns, mixed visual effects, and controls that trade familiarity for novelty are prohibited.

**Key Characteristics:**

- Search-first, dense, and immediately actionable.
- One offline system-sans family with a fixed product type scale.
- Concrete-gray surfaces, heavy black outlines, zero-blur hard shadows, cobalt actions, and compact coral highlights.
- Compact shortcuts mixed with larger data widgets in a stable bento grid.
- Fast state transitions with complete keyboard and reduced-motion support.

## 2. Colors

The system uses two complete visual modes: deep cyber with cyan interactions and concrete neo-brutalism with cobalt actions and coral emphasis. Semantic colors keep the same meaning in every mode.

### Primary

- **Cyber Cyan** (`cyber-accent`): is the default theme's action and focus color.
- **Brutal Cobalt** (`brutal-primary`): search, save, confirm, and active navigation in neo-brutalism.

### Secondary

- **Concrete Background** and **Poster Surface** (`brutal-background`, `brutal-surface`): quiet canvas and high-contrast content planes for neo-brutalism.

### Tertiary

- **Coral Signal** (`brutal-accent`): badges, selected theme state, and compact emphasis, never the primary action.

### Neutral

- **Night Canvas** and **Night Text** (`cyber-background`, `cyber-text`): unchanged foundation of the default theme.

**The No-Leak Rule.** Theme-specific accent colors never appear in another theme unless they encode real external content.

## 3. Typography

**Display Font:** System UI sans-serif stack
**Body Font:** System UI sans-serif stack

**Character:** Native, quick, and legible. Weight and spacing carry hierarchy without a downloaded font or a display face that competes with the user's content.

### Hierarchy

- **Headline** (800, 2rem, 1.2): product mark and rare top-level headings.
- **Title** (700, 1.25rem, 1.3): settings and major widget titles.
- **Body** (400, 1rem, 1.5): instructions, form content, and longer messages, capped at 70ch.
- **Label** (700, 0.8125rem, 1.2): buttons, compact metadata, and short navigation labels.

**The Fixed Scale Rule.** Product typography uses rem-based fixed sizes; viewport width changes layout, not type scale.

## 4. Elevation

Cyber-dark uses the project's existing surface lightness, borders, and selective glow.

Neo-brutalism uses no blur: large panels carry a 3px black outline with a 6px hard shadow, while controls and independent data blocks carry a 2px outline with a 3px hard shadow. Hover moves up-left and expands the shadow; active moves 3px down-right and removes it.

### Shadow Vocabulary

- **Brutal panel** (`6px 6px 0 #171717`): search poster, large widgets, sidebars, and dialogs.
- **Brutal control** (`3px 3px 0 #171717`): buttons, inputs, theme options, and compact data blocks.

**The Earned Elevation Rule.** Plain information rows stay flat; if everything casts a shadow, the hierarchy has failed.

## 5. Components

### Buttons

- **Shape:** compact rounded rectangle or circular icon control (8–12px radius; circle only for icon-only controls).
- **Primary:** cyan-accented in cyber-dark, with a minimum 44px hit target.
- **Neo-brutal primary:** cobalt blue with white text, 3px black border, hard shadow, and a minimum 44px hit target.
- **Hover / Focus:** 180ms color or shadow response; focus uses a visible theme-specific outline.
- **Secondary:** neutral surface with visible hover, focus, and active feedback.

### Chips

- **Style:** engine choices use dark neutral labels with a compact 18–24px state control.
- **State:** selected includes a visible checkmark, never color alone.

### Cards / Containers

- **Corner Style:** 12px for shortcut icons and 16px for large widgets.
- **Background:** theme-specific dark or concrete-gray neutrals for app-owned surfaces; weather photography remains real content under a stable dark readability overlay.
- **Shadow Strategy:** shortcut icons and distinct data widgets earn elevation; nested rows remain flat.
- **Internal Padding:** 12–24px from the spacing scale.

### Inputs / Fields

- **Style:** theme-specific neutral surface, contrasting text, and persistent visible labels.
- **Focus:** visible theme-specific outline; placeholder text meets AA contrast.
- **Error / Disabled:** error combines text and focus treatment; disabled state reduces emphasis without removing legibility.

### Navigation

- Settings uses familiar labeled tabs on desktop and a horizontally scrollable tab row below 720px. The active tab is cyan-tinted in cyber-dark and cobalt in neo-brutalism. All tabs remain keyboard reachable.

### Theme Selector

- Two native radio options show a small palette preview plus localized theme name. Selection applies immediately, persists automatically, and rolls back with an announced error if storage fails.

### Neo-Brutalism

- **Canvas:** solid `#E4E7E3`; no dots, grids, stripes, gradients, or decorative overlays.
- **Shape:** 4–8px corners, 800–900 headings, full black borders, and zero-blur shadows.
- **Hierarchy:** cobalt owns primary actions; coral appears only on compact highlights and selected states.
- **Weather:** photography remains content, framed by the brutal shell and a solid dark readability overlay.

## 6. Do's and Don'ts

### Do:

- **Do** preserve the default cyber-dark theme's current computed colors and layout.
- **Do** maintain 44px touch targets, visible focus, 320px reflow, and reduced-motion behavior.
- **Do** keep user card order and information architecture identical across themes.
- **Do** use only zero-blur hard shadows in neo-brutalism and preserve a visible press displacement.

### Don't:

- **Don't** use oversized rounded containers above 16px.
- **Don't** change familiar control behavior for visual novelty.
- **Don't** add background dots, stripes, gradients, glass effects, or blurred shadows to neo-brutalism.
