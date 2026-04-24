# Ubuntu

Ubuntu is a South African digital wallet and QR commerce platform designed to help consumers, merchants, and field agents participate in everyday digital transactions.

The product combines:

- a phone-first wallet for storing and moving value
- QR payments for goods and services
- agent-assisted cash-in and cash-out
- USSD access for users on basic phones
- a merchant and QR operations layer
- a roadmap toward regulated interoperability through PayShap-aligned rails

## What This Repository Is

This repository is the Ubuntu platform monorepo. It contains:

- backend microservices for auth, wallet, payments, KYC, AML, reporting, notifications, agents, and USSD
- a mobile application
- a web PWA
- an agent portal
- shared packages for errors, crypto, events, audit, types, and database access
- infrastructure code and deployment artifacts

## Current Reality

This codebase is not an empty scaffold, but it is also not yet a polished production launch candidate.

What is already real:

- wallet registration and login flows
- wallet creation, balances, and transaction history
- wallet-to-wallet payment logic with idempotency and accounting safeguards
- agent cash-in and cash-out flows
- USSD menu flows for balance, send money, airtime, and mini statements
- QR payment data structures and scanning surfaces
- KYC, AML, audit, and PayShap integration groundwork

What still needs focused work:

- unifying the product brand from Ahava to Ubuntu across code and UI
- tightening merchant acceptance and merchant settlement journeys
- clarifying and expanding the inventory product beyond QR asset handling
- polishing the end-to-end demo journey for investors
- hardening integration, environments, compliance operations, and release quality

## Product Definition

Ubuntu should be understood as an inclusive digital commerce platform.

In plain terms:

- a consumer can receive and use wallet value
- a merchant or receiving party can accept payment through QR
- an agent can help users move between cash and digital value
- the platform can support both app users and lower-tech users through USSD
- over time, the platform can connect more directly to regulated payment rails such as PayShap

## Investor Positioning

Ubuntu is an inclusive payments and merchant acceptance platform for South Africa that combines digital wallets, QR payments, agent-assisted cash access, and PayShap-ready interoperability.

Its purpose is to extend wallet-linked funds beyond restricted use cases into broader everyday commerce for consumers, informal merchants, and small businesses.

## Monorepo Structure

```text
apps/
  agent-portal/
  mobile/
  pwa/

services/
  agent-service/
  aml-service/
  api-gateway/
  auth-service/
  kyc-service/
  notification-service/
  payment-service/
  reporting-service/
  ussd-service/
  wallet-service/

packages/
  database/
  shared-audit/
  shared-crypto/
  shared-errors/
  shared-events/
  shared-types/
```

## Delivery Focus

The immediate goal is not "build everything."

The immediate goal is to deliver an investor-presentable MVP with a clean, believable end-to-end story:

1. customer signs up and gets a wallet
2. wallet is funded
3. customer scans a QR and pays
4. merchant or recipient sees confirmation
5. agent can support cash-in and cash-out
6. compliance and audit foundations are visible
7. PayShap is framed as the interoperability and scale path

## Key Documents

- `INVESTOR_PRODUCT_BRIEF.md`
- `MVP_DELIVERY_PLAN.md`
- `PRODUCTION_ROADMAP.md`
- `SARB_COMPLIANCE_MAP.md`

## Working Principle

For the next phase of work, this repository should be treated as a build-in-public MVP program:

- unify the story
- tighten the demo
- make the wallet and QR flows undeniable
- keep the compliance posture credible
- build toward a future enterprise-grade platform without overbuilding the first investor release
