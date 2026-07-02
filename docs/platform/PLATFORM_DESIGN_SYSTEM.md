# CG Platform Design System v1.0

## Design Philosophy

The CG Platform should feel like a single operating system rather than a collection of independent applications.

Every application should feel familiar within seconds.

Users should never have to relearn navigation, page layout, terminology, or interaction patterns when moving between applications.

The platform should emphasize:

* Simplicity
* Speed
* Clarity
* Professionalism
* Consistency

Restaurant leaders should spend their time making decisions, not figuring out software.

## Decision-First Principle

Every screen should help a leader answer at least one clear question:

* Is this okay?
* Does this need attention?
* What should I do next?
* Who owns this?
* Am I ahead or behind?
* Who needs support?

The CG Platform should not merely display data. It should help leaders make better decisions.

## Theme Strategy

The platform has two visual modes based on audience.

### Platform Administration

Used only by administrators, executives, architects, and system owners.

Examples:

* Command Center
* Governance
* Architecture
* Workflow Studio
* Security
* Integrations
* Platform Administration

Characteristics:

* Dark interface
* Minimal visual distraction
* Operational command center feel
* Clearly recognizable as an administrative/backend environment

### Business Applications

Used daily by restaurant leaders.

Examples:

* People Center
* Product Center
* Purchasing Center
* Chef Summary
* Prep Enterprise
* Daily Workflow

Characteristics:

* White background
* Light grey surfaces
* Black typography
* Orange highlights
* High readability
* Print friendly
* Simple enough for daily use

## Colour System

The platform always uses the same colour family.

Primary:

* Charcoal black

Secondary:

* White

Neutral:

* Grey scale

Accent:

* Charcoal orange

Semantic:

* Green
* Yellow
* Red
* Blue

Accent colours should communicate state or action, never decoration.

Orange represents primary action, active state, and CG platform energy.

Do not hard-code one-off colours throughout the application. Use design tokens wherever practical.

## Branding

Every application belongs to the CG Platform.

Branding should support:

* Charcoal Group
* Beertown
* Sociable Kitchen Tavern
* Wildcraft
* Solé
* Future brands

Applications may eventually swap:

* Logo
* Brand name
* Accent imagery

Applications should never swap:

* Navigation structure
* Layout system
* Component behaviour
* Typography scale
* Interaction patterns

Brand identity changes.

Platform identity does not.

The application should feel like:

“CG Platform — Beertown”

not:

“Completely different software.”

## Navigation

Every business application should use a left navigation rail.

The navigation is:

* Collapsed by default
* Icons always visible
* Expandable on click or hover
* User preference remembered when practical

The navigation should comfortably support 30+ destinations without redesign.

Avoid primary navigation across the top for deep applications. Top navigation becomes crowded too quickly.

## Application Layout

Every business application follows the same general structure:

* Header
* Collapsed left navigation
* Page title
* Optional breadcrumb
* Primary actions
* Content area
* Cards
* Tables
* Forms
* Detail panels

Every page should feel structurally familiar even when the content differs.

## Header

The header should contain only what is necessary:

* Application logo
* Application name
* Brand/location indicator when relevant
* Search when applicable
* Notifications when applicable
* User menu

Do not crowd the header with primary navigation.

## Cards

Cards are the primary content container.

Rules:

* White card surface
* Subtle border
* Soft shadow only when useful
* Rounded corners
* Consistent spacing
* Clear title
* Clear purpose

Cards should never feel decorative. They should organize decisions.

## Tables

All tables should behave consistently.

Support:

* Search
* Filter
* Sort
* Bulk actions where appropriate
* Pagination or virtual scrolling
* Responsive collapse

Avoid custom table implementations unless there is a strong reason.

## Forms

Every form follows the same rhythm:

* Label
* Optional help text
* Input
* Validation
* Save
* Cancel

Forms should be calm and predictable.

## Buttons

Button hierarchy:

* Primary: orange
* Secondary: white or light grey
* Danger: red
* Ghost: transparent

Maximum two primary buttons per screen.

Use orange sparingly so it remains meaningful.

## AI Components

All AI interactions should look and behave consistently across applications.

Every AI component should include:

* Prompt or request
* Status
* Response
* References when applicable
* Approval workflow when applicable
* History when applicable

AI should feel like one CG assistant, regardless of application.

## Side Panels and Drawers

Details should open in side panels where practical.

Use side panels for:

* Person profile
* Product details
* Assignment
* Development plan
* Import/source detail
* Review queues

Avoid unnecessary full-page navigation when the user is inspecting or editing a related detail.

## Empty States

Every empty page should explain:

* Why nothing is here
* What the user should do next
* The primary action to take

Empty states should be useful, not blank.

## Responsive Behaviour

Desktop first.

Tablet fully supported.

Phone supported where appropriate.

Navigation collapses before content.

Business applications should remain usable on a phone for quick reference, but heavy administration can remain desktop-oriented.

## Accessibility

Support:

* Keyboard navigation
* High contrast
* Screen readers
* Clear focus states
* Large click targets
* Sensible tab order

## Motion

Motion should communicate state.

Use:

* Fade
* Slide
* Expand

Avoid excessive animation.

Motion should never be the point.

## Component Library Direction

The platform should eventually expose reusable components including:

* App Shell
* Sidebar
* Header
* Breadcrumbs
* Page Layout
* Card
* KPI Card
* Data Table
* Form
* Status Badge
* Avatar
* Timeline
* Activity Feed
* Detail Drawer
* Search Bar
* Command Palette
* AI Panel
* Empty State
* Loading State

Applications should consume these rather than reinvent them.

## People Center UI Direction

People Center should be the first test of this business-application design language.

Direction:

* Light business-app theme
* Collapsed left navigation rail by default
* CG black/orange/white/grey palette
* Simple, clean, modern layout
* Minimal top navigation
* Card-based content
* Manager cheat sheet as the flagship screen
* Data Sources screen admin-only
* Directory visible to signed-in users
* Design for future brand/logo support without creating separate design systems

## Platform Principles

Every application should answer:

1. Does this look like the CG Platform?
2. Would a manager know how to use it immediately?
3. Can this component be reused elsewhere?
4. Is it simpler than the last version?
5. Does it help someone make a better decision?

If the answer to any of these is no, the design should be reconsidered.
