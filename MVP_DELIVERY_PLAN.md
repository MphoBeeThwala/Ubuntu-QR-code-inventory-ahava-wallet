# Ubuntu MVP Delivery Plan

## Purpose

This document is the working build plan for taking Ubuntu from a technically promising repo to an investor-presentable MVP.

It is deliberately narrower than the full production roadmap.

The goal is to deliver a clean, believable, demo-ready product story that proves market direction and execution capability.

## MVP Objective

Deliver a polished Ubuntu demo that shows:

1. wallet onboarding
2. wallet funding or seeded balance
3. QR payment for goods and services
4. merchant or recipient confirmation
5. agent-assisted cash-in and cash-out
6. visible compliance and audit foundations
7. PayShap positioned as the next regulatory and interoperability unlock

## Build Principles

- Focus on one strong end-to-end flow over many partial flows
- Prefer polish and consistency over breadth
- Keep the compliance story honest
- Treat PayShap as a strategic rail, not marketing fiction
- Build only what strengthens investor confidence in product-market fit and execution

## Product Scope for Investor MVP

### In Scope

- Consumer registration and login
- Wallet dashboard with balance and recent activity
- QR display and QR scan payment flow
- Transaction history
- Agent portal with cash-in and cash-out
- PWA flow for web-based demo support
- Basic KYC status surface
- Basic audit and transaction traceability
- Demo-ready data and scripted investor journey

### Out of Scope for Investor MVP

- Full enterprise inventory suite
- Deep merchant analytics
- Full reporting automation
- Full production DevOps hardening
- Full regulator-ready operating model
- Complex multi-bank settlement orchestration

## Current Codebase Assessment

### Strong Today

- API gateway exists and proxies to services
- Auth service exists and creates wallets
- Wallet service exists with balances and history
- Payment service includes serious financial safeguards
- Agent service includes cash-in and cash-out
- USSD service exists
- PWA, mobile app, and agent portal all exist
- Prisma schema is mature and well thought out
- Shared crypto, audit, errors, and event packages are present

### Weak Today

- Product branding is inconsistent and still heavily uses Ahava naming
- Docs tell conflicting maturity stories
- Merchant story is weaker than wallet and agent story
- Inventory story is narrower than the repo name suggests
- Demo journey is not yet unified across surfaces
- Production readiness claims should be tightened to match reality

## Delivery Phases

## Phase 1: Product Story and Repo Cleanup

### Outcome

One consistent Ubuntu narrative across docs and demo surfaces.

### Tasks

- Add a real root README for Ubuntu
- Define investor product narrative
- Define MVP scope and exclusions
- Identify all high-visibility Ahava branding that must be updated first
- Align top-level docs so they stop contradicting each other

### Exit Criteria

- Anyone opening the repo understands what Ubuntu is
- Investor-facing language is coherent
- Internal build priorities are clear

## Phase 2: Demo Flow Lock-In

### Outcome

A single, reliable end-to-end wallet and QR payment journey.

### Tasks

- Verify auth -> wallet creation -> dashboard flow
- Verify QR generation and QR scan flow
- Verify wallet-to-wallet payment completion
- Clean transaction confirmation messaging
- Seed stable demo data for recipient, merchant, and agent roles
- Add a simple demo script for live walkthroughs

### Exit Criteria

- We can run one clean customer payment demo without improvisation

## Phase 3: Agent and Merchant Operations Story

### Outcome

A credible commerce operations layer around the wallet.

### Tasks

- Tighten agent portal UX and wording
- Validate cash-in and cash-out flow
- Clarify merchant or recipient confirmation screens
- Make QR operational inventory explicit where it exists
- Decide whether to frame inventory as:
  - QR inventory and issuance only, or
  - a broader merchant stock-control roadmap

### Exit Criteria

- Investor can understand how cash, QR, and merchant acceptance connect

## Phase 4: Compliance and Rail Credibility

### Outcome

The platform sounds serious and grounded, not speculative.

### Tasks

- Surface KYC tiering clearly in demo
- Surface AML and audit concepts clearly in demo and docs
- Clean up SARB and PayShap language so it is accurate
- Mark live versus sandbox versus planned integrations honestly
- Prepare a simple compliance narrative slide or document

### Exit Criteria

- We can explain what is built, what is sandboxed, and what requires regulatory progression

## Phase 5: Investor Packaging

### Outcome

A presentable product package for meetings and pitches.

### Tasks

- Create demo runbook
- Create founder talking points
- Create product screenshots or guided flow
- Prepare concise architecture overview
- Prepare roadmap from MVP to regulated scale

### Exit Criteria

- Product can be shown confidently to investors without caveats dominating the discussion

## Implementation Priorities

### Priority 1

- Branding cleanup at high-visibility entry points
- Root documentation cleanup
- End-to-end wallet and QR payment verification

### Priority 2

- Agent flow polish
- Merchant acceptance wording and UX
- Demo data and scripted flow

### Priority 3

- PayShap positioning cleanup
- Compliance messaging
- Investor packaging

## Rebrand Priority List

The first pass should target visible user-facing surfaces before deep package renames.

### First-pass rebrand targets

- app titles
- login screens
- dashboard headers
- QR payment labels
- manifests and page metadata
- root docs

### Later rebrand targets

- package names
- shared library comments
- internal identifiers
- migration-safe schema labels if needed

## MVP Success Criteria

The investor MVP is successful if we can demonstrate:

- a user can access Ubuntu as a real wallet product
- QR payments work as the central commerce interaction
- agents expand accessibility and trust
- the product is clearly South Africa-focused
- the system has credible compliance and payment-rail ambition

## Immediate Build Sprint

This is the next implementation sprint I recommend executing first:

1. Create a single source of truth for product definition and MVP scope
2. Rebrand the most visible Ahava user-facing surfaces to Ubuntu
3. Verify and tighten auth, dashboard, QR, payment, and agent demo flows
4. Build or refine the investor demo script

## Build Agent Role

As build agent, the operating approach should be:

- keep one running truth about product scope
- make visible improvements early
- preserve momentum with small, demo-relevant wins
- avoid wasting time on deep production work that does not improve the investor narrative yet
- prepare the repo so later production hardening becomes easier, not harder
