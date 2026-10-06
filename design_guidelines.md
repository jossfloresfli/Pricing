# VAX Pricing Hub - Design Guidelines

## Design Approach

**System**: Modern SaaS productivity tool inspired by Linear's clean aesthetics, Notion's organizational clarity, and enterprise dashboard patterns. Focus on information hierarchy, scannable layouts, and functional efficiency for complex data management.

**Principles**: 
- Information-first: Data visibility and accessibility over decorative elements
- Functional clarity: Every element serves a purpose
- Hierarchical organization: Clear content grouping and visual relationships
- Responsive precision: Adapt gracefully from desktop workstations to tablets

---

## Typography

**Font Stack**: 
- Primary: Inter (Google Fonts) - weights 400, 500, 600, 700
- Monospace: JetBrains Mono - for numerical data, IDs, dates

**Hierarchy**:
- Page Titles: text-3xl font-bold (30px)
- Section Headers: text-xl font-semibold (20px)
- Card Titles: text-lg font-semibold (18px)
- Body Text: text-base (16px)
- Meta/Labels: text-sm font-medium (14px)
- Captions/Timestamps: text-xs (12px)
- Numerical Data: Use monospace font for alignment

---

## Layout System

**Spacing Units**: Use Tailwind units of **2, 4, 6, 8, 12, 16** for consistent rhythm
- Component padding: p-4 to p-6
- Section spacing: space-y-8 to space-y-12
- Card gaps: gap-6
- Form field spacing: space-y-4

**Container Structure**:
- Max width: max-w-7xl (1280px) for main content
- Dashboard cards: max-w-sm to max-w-md
- Forms: max-w-4xl
- Tables: Full width with horizontal scroll on overflow

**Grid Patterns**:
- Dashboard metrics: grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6
- Kanban board: Horizontal flex with min-w-80 columns
- Form sections: Single column for clarity, occasional 2-col for compact fields (CP codes)

---

## Component Library

### Navigation & Shell

**Top Navigation Bar**:
- Height: h-16
- Contains: Logo (left), search bar (center-left), user menu + notifications (right)
- Subtle bottom border for definition
- Sticky positioning (sticky top-0)

**Sidebar Navigation** (if needed for Superadmin):
- Width: w-64
- Collapsible to w-16 icon-only on smaller screens
- Menu items with icon + label
- Active state: Prominent background treatment

### Dashboard Components

**Metric Cards**:
- Structure: Icon (top-left), label (below icon), large number (center), trend indicator (bottom-right)
- Padding: p-6
- Rounded: rounded-lg
- Border treatment for definition
- Hover: Subtle lift effect (shadow transition)

**Charts/Graphs** (optional):
- Simple bar or line charts using lightweight library (Chart.js or Recharts)
- Height: h-64 to h-80
- Minimal gridlines, clear axis labels

### Kanban Board

**Column Structure**:
- Min width: min-w-80 max-w-sm
- Header: Status name + count badge
- Scrollable card container: overflow-y-auto max-h-screen
- Drop zone highlighting on drag

**Pricing Request Cards**:
- Padding: p-4
- Spacing between cards: space-y-3
- Card sections (top to bottom):
  - Client name (text-base font-semibold) + request ID (text-xs monospace)
  - Route: "Origin → Destination" with arrow icon
  - Equipment type badge
  - Grid: 2 columns for Carrier, Cost, Sale Price
  - Margin percentage with visual indicator (badge)
  - Status badge (top-right corner)
  - Timestamp (bottom, text-xs)
- Drag handle indicator
- Hover: Slight elevation

**Status Badges**:
- Size: px-2.5 py-1 text-xs font-medium rounded-full
- Variants for each status (Pendiente, En Revisión, Aprobado, Rechazado, etc.)
- Icon prefix for quick recognition

### Forms

**Section Organization**:
- Each section with clear header: text-lg font-semibold mb-4
- Visual separation with subtle dividers or spacing (pt-8 border-t)
- Grouped fields use grid-cols-1 md:grid-cols-2 gap-4

**Input Fields**:
- Height: h-10 for text inputs
- Padding: px-3 py-2
- Rounded: rounded-md
- Border treatment with focus state enhancement
- Labels: text-sm font-medium mb-1.5
- Helper text: text-xs mt-1

**Dropdowns/Selects**:
- Match input styling
- Clear arrow indicator
- Search functionality for long lists (clients, carriers)

**Carrier Options Table**:
- Editable grid structure
- Headers: sticky top-0
- Row height: h-12
- Alternating row background for readability
- Input cells with minimal padding
- Add/Remove row buttons

**Action Buttons**:
- Primary: px-4 py-2 text-sm font-medium rounded-md
- Secondary: Similar with outline treatment
- Icon buttons: w-10 h-10 rounded-md for actions
- Button groups: flex gap-2

### Detail View

**Tab Navigation**:
- Horizontal tabs with underline indicator
- Active tab: font-semibold with accent underline
- Tab padding: px-4 py-3

**Content Sections**:
- Overview: 2-column grid for key-value pairs
- Use dl/dt/dd semantic structure
- Labels: text-sm font-medium
- Values: text-base

**Comment Section**:
- Timeline-style layout
- Avatar + name + timestamp (top)
- Comment content in card (p-4)
- Reply/thread indentation

### Tables (Pricing File)

**Table Structure**:
- Header: sticky top-0 with emphasis
- Row height: h-14
- Cell padding: px-4 py-3
- Sortable columns with indicator icons
- Zebra striping for long tables

**Filters Bar**:
- Sticky below header
- Horizontal layout with filter chips
- Date range picker, dropdowns, search input
- Clear filters button

**Pagination**:
- Bottom-right alignment
- Page numbers + Previous/Next
- Items per page selector

### Modals & Overlays

**Modal Dialogs**:
- Max width: max-w-2xl to max-w-4xl based on content
- Backdrop: Semi-transparent overlay
- Padding: p-6
- Header with title + close button
- Footer with action buttons (right-aligned)

**Toast Notifications**:
- Position: top-right
- Size: max-w-sm
- Auto-dismiss after 5s
- Success/Error/Info variants with icons

---

## Role-Based UI Elements

**Role Indicators**:
- User menu shows current role with badge
- Role-specific action buttons visibility
- Permission-based form field states (disabled/readonly)

**Action Visibility**:
- Carrier Rep: "Edit" and "Submit" buttons on own requests
- Pricing: "Approve", "Reject", "Adjust Rate" buttons
- Superadmin: Additional "Export" and "Edit Catalogs" options

---

## Responsive Behavior

**Breakpoints**:
- Mobile (<768px): Single column layouts, collapsed sidebar, stacked metrics
- Tablet (768-1024px): 2-column grids, visible sidebar
- Desktop (>1024px): Full multi-column layouts, expanded sidebar

**Mobile Adaptations**:
- Kanban: Vertical accordion instead of horizontal scroll
- Tables: Horizontal scroll with sticky first column
- Forms: Full-width fields, reduced padding

---

## Accessibility

- Keyboard navigation for all interactive elements
- Focus indicators: ring-2 ring-offset-2
- ARIA labels for icon-only buttons
- Screen reader text for status indicators
- Sufficient contrast ratios throughout
- Semantic HTML (nav, main, article, section)

---

## Images

**No hero images** - This is a productivity application focused on data and functionality. All visual elements are UI components and data visualizations.