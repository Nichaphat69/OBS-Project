---
name: OBS Assistant Design System
colors:
  surface: '#f8f9ff'
  surface-dim: '#ccdbf3'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e6eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d5e3fc'
  on-surface: '#0d1c2e'
  on-surface-variant: '#3c4a3c'
  inverse-surface: '#233144'
  inverse-on-surface: '#eaf1ff'
  outline: '#6c7b6b'
  outline-variant: '#bbcbb8'
  surface-tint: '#006e2b'
  primary: '#006e2b'
  on-primary: '#ffffff'
  primary-container: '#06c755'
  on-primary-container: '#004c1b'
  inverse-primary: '#3ee26c'
  secondary: '#545f73'
  on-secondary: '#ffffff'
  secondary-container: '#d5e0f8'
  on-secondary-container: '#586377'
  tertiary: '#486174'
  on-tertiary: '#ffffff'
  tertiary-container: '#96b0c5'
  on-tertiary-container: '#2a4355'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#69ff89'
  primary-fixed-dim: '#3ee26c'
  on-primary-fixed: '#002108'
  on-primary-fixed-variant: '#00531f'
  secondary-fixed: '#d8e3fb'
  secondary-fixed-dim: '#bcc7de'
  on-secondary-fixed: '#111c2d'
  on-secondary-fixed-variant: '#3c475a'
  tertiary-fixed: '#cbe6fc'
  tertiary-fixed-dim: '#afcadf'
  on-tertiary-fixed: '#011e2e'
  on-tertiary-fixed-variant: '#304a5b'
  background: '#f8f9ff'
  on-background: '#0d1c2e'
  surface-variant: '#d5e3fc'
typography:
  display:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 26px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-lg:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.01em
  label-sm:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
  timestamp:
    fontFamily: Inter
    fontSize: 10px
    fontWeight: '400'
    lineHeight: 12px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  space-2xs: 0.25rem
  space-xs: 0.5rem
  space-sm: 0.75rem
  space-md: 1rem
  space-lg: 1.25rem
  space-xl: 1.5rem
  space-2xl: 2rem
  chat-gutter: 0.75rem
  bubble-pad-x: 0.875rem
  bubble-pad-y: 0.625rem
  flex-card-pad: 1.125rem
  rich-menu-gap: 1px
---

## Brand & Style

This design system establishes a high-trust conversational interface bridging the ubiquitous familiarity of LINE Official Account (OA) with enterprise fintech rigor. Designed for corporate billing operations, external vendor management, and contractor timesheet reconciliation, the visual tone balances native messaging immediacy with executive-level clarity.

### Visual Personality & Design Movement
The design movement is **Modern Conversational Corporate**—merging clean glass and slate layers with tactical micro-interactions:
- **Enterprise Credibility:** Crisp slate palettes, structural data hierarchy, and high contrast eliminate ambiguity in financial workflows (manday approvals, invoice validations, payment sign-offs).
- **Conversational Fluency:** Native messaging paradigms—asymmetrical chat bubbles, micro-stamps, actionable carousels, and bottom-docked quick actions—remove cognitive friction from compliance tasks.
- **Precision Micro-Surfaces:** LINE Flex message cards mimic high-end fintech receipt slips and data matrices rather than generic casual chat blocks.

## Colors

The color architecture honors LINE’s unmistakable brand signature while enforcing strict WCAG AA+ contrast standards against chat backdrops and nested data tables.

### Color Tokens & Semantic Roles
- **Primary (`#06C755`):** Reserved for system-validated success states, approved manday sign-offs, verified account insignias, primary action call-to-actions, and interactive sender bubbles. Active/pressed states drop to `#05B04B`, accompanied by subtle surface fills at `#E8F9EE`.
- **Secondary / Slate Navy (`#1E293B`):** Establishes typographic hierarchy, high-contrast modal headers, and table figures. It grounds the chat UI, moving it away from consumer messaging toward corporate software.
- **Tertiary / LINE Slate Wall (`#849EB2`):** Defines the ambient conversational background tone. Used at reduced opacity or as `#F2F5F8` for light canvas viewports, simulating real smartphone chat backgrounds while keeping eye strain low.
- **Neutrals:**
  - Body Text: `#475569`
  - Subtitles, metadata, timestamps: `#64748B`
  - Dividers & subtle outlines: `#E2E8F0`
  - Card & bubble background: `#FFFFFF` and `#F8FAFC`
- **Functional Semantics:**
  - **Pending / Manday In-Review:** `#F59E0B` with background `#FEF3C7` (amber badge).
  - **Critical Alert / Overdue Timesheet:** `#EF4444` with background `#FEE2E2` (action required).

## Typography

The type scale combines **Plus Jakarta Sans** for display figures, titles, and monetary totals with **Inter** for conversational bubbles, input areas, and system logs. When rendering Thai scripts for regional localization (e.g., Sarabun/Prompt fallbacks), metrics align dynamically to preserve vertical rhythm without clipping glyph ascenders and descenders.

### Typographic Rules
- **Monetary & Manday Figures:** Numerical balance sheets and vendor invoices must use tabular numbers (`font-feature-settings: 'tnum' on, 'cv05' on`) to ensure clean vertical alignment across Flex Message ledgers.
- **Bubble Readability:** Standard conversational text is locked at `body-md` (14px) with a generous 1.45 line-height ratio, preventing text crowding on compact mobile displays.
- **Timestamps:** Rendered in `timestamp` (10px, `#64748B`) and horizontally aligned beside bubble tails or inside bottom card rails.

## Layout & Spacing

The interface implements a mobile-first, fixed-viewport conversational structure bounded at a standard maximum mobile width of `430px` (or full width on native mobile viewports) with a viewport-locked bottom rail.

### Conversation Stream Architecture
- **Chat Gutter (`0.75rem` / 12px):** Horizontal buffer between system edges and speech bubbles.
- **Vertical Turn Spacing:**
  - Sequential messages from the same sender: `4px` gap.
  - Alternating turns (User to Assistant): `12px` gap.
  - Interactive Flex Message cards: `16px` margin top/bottom.
- **Rich Menu Layout:** A fixed bottom grid (`2x3` layout, total height 240px–280px depending on screen height) using a `1px` crisp outline grid separator (`#E2E8F0`). It snaps to mobile safe-area insets (`env(safe-area-inset-bottom)`).

## Elevation & Depth

Visual hierarchy uses **tonal layer differentiation** combined with **subtle ambient shadows**, avoiding heavy drops that clash with LINE's flat-vector aesthetic.

### Elevation Hierarchy
- **Level 0 (Canvas Base):** Modern LINE slate background (`#849EB2` or muted `#F2F5F8`).
- **Level 1 (Incoming Speech Bubbles & Bot Messages):** `#FFFFFF` surface with a crisp structural hairline border (`1px solid rgba(226, 232, 240, 0.8)`) and ambient shadow: `0 1px 3px rgba(30, 41, 59, 0.04)`.
- **Level 2 (Flex Message Cards & Manday Summaries):** `#FFFFFF` surface elevated with dual soft shadows: `0 4px 6px -1px rgba(30, 41, 59, 0.06), 0 2px 4px -2px rgba(30, 41, 59, 0.04)`.
- **Level 3 (Sticky LINE Header & Bottom Input Bar / Rich Menu Dock):** Grounded by a directional boundary line (`1px solid #E2E8F0`) and top-cast ambient occlusion: `0 -4px 12px rgba(15, 23, 42, 0.03)`.
- **Level 4 (Modals, Date Pickers, & Manday Sign-off Drawers):** `0 20px 25px -5px rgba(15, 23, 42, 0.1), 0 8px 10px -6px rgba(15, 23, 42, 0.04)`.

## Shapes

The design system employs a **Rounded** (Level 2) shape vocabulary, tuned specifically to balance friendly chat conventions with tabular enterprise data blocks.

### Corner Radius System
- **Bot/Incoming Bubble Corners:** `16px` on top-left, top-right, and bottom-right; `4px` on bottom-left (indicating speaker anchor).
- **User/Outgoing Bubble Corners:** `16px` on top-left, top-right, and bottom-left; `4px` on bottom-right.
- **Enterprise Flex Cards:** Uniform `16px` to `20px` perimeter radius with strictly squared interior cells to maximize tabular data efficiency.
- **Pill Elements (Action Chips & Status Badges):** Fully rounded `9999px` to communicate immediate tapability.
- **Rich Menu Tiles:** Flat corner internal geometry with outer container matching screen boundaries.

## Components

### 1. LINE OA Verified Header
- **Structure:** Fixed top bar, height 56px, background `#FFFFFF` or translucent blur (`rgba(255, 255, 255, 0.92)`).
- **Elements:** Back caret, assistant circular avatar (36px) with a native green shield icon (verified badge), title "OBS Assistant" in `headline-sm` with a secondary "Official Account" status badge, and native menu overflow trigger.

### 2. Conversational Bubbles
- **Bot Message:** Crisp white (`#FFFFFF`) with `#1E293B` typography.
- **User Response:** LINE Accent Green (`#06C755`) background with `#FFFFFF` text and semi-translucent timestamp (`rgba(255, 255, 255, 0.75)`).

### 3. Flex Message Interactive Cards (Enterprise Billing & Manday Check)
- **Container:** White backdrop, `16px` radius, subtle border (`#E2E8F0`).
- **Card Header:** Brand slate accent or soft green badge pill indicating category: e.g., "MANDAY RECONCILIATION • NOV 2024".
- **Key-Value Data Matrix:** Two-column rows (`body-sm`) showing Vendor Name, Mandays Claimed, Overtime Units, and Total Amount Payable in high-contrast `headline-sm` (`#1E293B`).
- **Action Footers:** Full-width or split dual buttons embedded directly within card boundaries:
  - Primary Confirm: Solid `#06C755` pill, bold white typography.
  - Secondary Reject/Dispute: Soft `#F1F5F9` background, `#475569` slate text.

### 4. Status Stepper (Workflow Progression)
- Horizontal or vertical connected timeline nodes.
- **Active / Current Step:** Animated ring `#06C755` with white center dot.
- **Completed Step:** Solid `#06C755` disk with white checkmark.
- **Pending Step:** Muted `#E2E8F0` disk with slate border.
- Connecting lines: 2px thickness, filled with `#06C755` once traversed.

### 5. Timesheet / File Upload Card
- Dedicated preview card displaying document icon (PDF, XLSX), truncated file name (`timesheet_nov24_signed.pdf`), file size (`1.4 MB`), and an inline progress bar or green verified check.

### 6. Fixed 6-Tile LINE Rich Menu
- **Layout:** 2 rows × 3 columns docked above safe area.
- **Tile Styling:** `#FFFFFF` background with active state down-scaling to `#F8FAFC`.
- **Content:** Minimalist 24px duotone vector icons with paired `label-sm` labels:
  1. *Submit Mandays*
  2. *Check Approvals*
  3. *Billing Status*
  4. *Upload Tax Invoice*
  5. *Vendor Profile*
  6. *Help / Support*
- Badge notification: Micro red dot (`#EF4444`, 8px) on tiles with pending actions.