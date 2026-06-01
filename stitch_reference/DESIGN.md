---
name: Arctic Clarity
colors:
  surface: '#0d131e'
  surface-dim: '#0d131e'
  surface-bright: '#333945'
  surface-container-lowest: '#080e19'
  surface-container-low: '#161c27'
  surface-container: '#1a202b'
  surface-container-high: '#242a36'
  surface-container-highest: '#2f3541'
  on-surface: '#dde2f2'
  on-surface-variant: '#c0c8cb'
  inverse-surface: '#dde2f2'
  inverse-on-surface: '#2b313c'
  outline: '#8a9295'
  outline-variant: '#40484b'
  surface-tint: '#97cfe0'
  primary: '#a3dcec'
  on-primary: '#003640'
  primary-container: '#88c0d0'
  on-primary-container: '#0c4f5d'
  inverse-primary: '#2b6674'
  secondary: '#a9caeb'
  on-secondary: '#0e334e'
  secondary-container: '#2b4c68'
  on-secondary-container: '#9bbcdd'
  tertiary: '#f0c6e7'
  on-tertiary: '#432740'
  tertiary-container: '#d3abcb'
  on-tertiary-container: '#5d3e59'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#b3ecfc'
  primary-fixed-dim: '#97cfe0'
  on-primary-fixed: '#001f26'
  on-primary-fixed-variant: '#094e5c'
  secondary-fixed: '#cee5ff'
  secondary-fixed-dim: '#a9caeb'
  on-secondary-fixed: '#001d32'
  on-secondary-fixed-variant: '#294965'
  tertiary-fixed: '#ffd7f6'
  tertiary-fixed-dim: '#e3badb'
  on-tertiary-fixed: '#2c122a'
  on-tertiary-fixed-variant: '#5b3d57'
  background: '#0d131e'
  on-background: '#dde2f2'
  surface-variant: '#2f3541'
typography:
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  headline-sm:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: '1'
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 26px
    fontWeight: '700'
    lineHeight: '1.2'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  gutter: 24px
  margin-mobile: 16px
  margin-desktop: 32px
  container-max: 1440px
---

## Brand & Style

This design system is built for a high-stakes communication management platform, blending the industrial reliability of the GNOME Adwaita aesthetic with the ethereal qualities of **Glassmorphism**. The brand personality is calm, focused, and professional, utilizing the Nord color palette to evoke a sense of "cold focus"—reminiscent of an arctic workspace.

The visual style focuses on depth through transparency. By utilizing `backdrop-filter: blur()`, the UI creates a sense of spatial hierarchy where background elements remain visible but non-distracting. This reduces the cognitive load often associated with complex data-heavy applications. The emotional response is one of trust and "quiet efficiency," moving away from the cluttered and opaque legacy interfaces typical of the sector.

## Colors

The system defaults to a sophisticated **Dark Mode** centered on the **Nord** palette. 

- **Primary (Frost 1/2):** Used for interactive states, primary actions, and branding.
- **Secondary (Frost 3):** Used for navigation highlights and secondary emphasis.
- **Neutral (Polar Night):** The foundation. `Polar Night 0` serves as the base background, while `1` and `2` define the semi-transparent glass layers.
- **Accent (Tertiary):** A muted purple is reserved for critical status changes or system alerts.

Surface colors are rarely opaque; they use an 80-90% alpha version of the Polar Night shades to allow underlying colors and blurs to bleed through.

## Typography

The system utilizes **Inter** for its exceptional legibility in data-dense environments. Its neutral, functional character supports the professional nature of communication management. 

For technical details, metadata, and labels, **Geist** is introduced. Its monospaced-influenced proportions provide a clean, technical contrast that helps users distinguish between "content" and "system data."

Hierarchy is established through weight and color (Snow Storm 0 vs 2) rather than extreme size differences, maintaining a compact and efficient layout.

## Layout & Spacing

This design system uses a **Fluid Grid** model with a fixed maximum container width for desktop to ensure line lengths remain readable. 

- **Desktop:** 12-column grid with 24px gutters. Content is housed in "glass panels" that span various column widths.
- **Tablet:** 8-column grid with 20px gutters. Sidebars often collapse into overlays.
- **Mobile:** 4-column grid with 16px margins. Stacked layout for all glass panels.

A strict 4px base unit controls all padding and margins (4, 8, 12, 16, 24, 32, 48, 64). This creates a rhythmic "breathing room" that offsets the density of a communication platform.

## Elevation & Depth

Depth is not simulated with heavy shadows but through **Backdrop Blur** and **Tonal Layering**.

1.  **Level 0 (Base):** Polar Night 0. Solid, opaque.
2.  **Level 1 (Panels):** Polar Night 1 at 85% opacity + 12px backdrop blur. 1px stroke of Snow Storm 0 at 10% opacity for "edge lighting."
3.  **Level 2 (Modals/Popovers):** Polar Night 2 at 90% opacity + 20px backdrop blur. A subtle, extra-diffused shadow (0 10px 30px rgba(0,0,0,0.3)) is added only here to separate the element from the panel layer.

This "Glass Stack" allows the user to maintain a sense of where they are in the application, as the primary navigation or dashboard remains softly visible beneath active work panels.

## Shapes

The shape language is defined by significant corner rounding to contrast with the cold color palette, making the interface feel approachable and "soft."

Standard panels and cards use `rounded-lg` (16px), while buttons and interactive inputs use a standard `rounded` (8px). This creates a clear nested hierarchy where smaller internal elements are slightly sharper than their containers. Container edges never touch the screen edge; they always sit within a margin to maintain their "floating glass" identity.

## Components

### Buttons
Primary buttons use a solid Frost 2 background with dark text (Polar Night 0) for maximum contrast. Secondary buttons are "ghost" style with a 1px Frost 2 border and a subtle glass fill that intensifies on hover.

### Cards & Panels
The core of the system. Every panel must have a 1px "inner glow" border (white/Snow Storm at 10% opacity) on the top and left sides to simulate a glass edge catching the light.

### Inputs
Fields are dark glass (Polar Night 2 at 50% opacity). On focus, the border transitions to Frost 1 and the backdrop blur increases slightly to make the field "pop" from the background.

### Navigation (Sidebar)
Inspired by Adwaita, the sidebar uses a vertical list of items. Active states are indicated by a Frost 3 pill-shaped background that is semi-transparent, allowing the background blur to continue through the selection.

### Chips/Tags
Small, pill-shaped elements using Frost tints. They are used for status (e.g., "Online," "Pending") and should always have high-contrast text.