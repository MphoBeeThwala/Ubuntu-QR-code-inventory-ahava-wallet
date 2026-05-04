# Ubuntu Investor Demo Script

## Demo Goal

Show Ubuntu as a South African digital wallet and QR commerce platform that already supports:

- user onboarding
- wallet creation
- QR payment acceptance
- wallet-to-wallet transfer
- agent-assisted cash in and cash out

Position PayShap as the next interoperability rail, not the only proof of value.

## Primary Story

Ubuntu helps everyday users and participating merchants move beyond restricted voucher-style wallet usage into real digital commerce.

The investor takeaway should be:

"Ubuntu already has the core wallet, QR, and agent rails needed for everyday transactions. The next scale unlock is compliance hardening and real-time interoperable settlement."

## Recommended Live Demo Path

1. Open the Ubuntu PWA login or register flow.
2. Register a new user with a South African mobile number.
3. Show that the wallet session is created immediately after registration.
4. Open the dashboard and explain wallet balance, transaction history, and KYC tiering.
5. Generate or display the user QR code.
6. On a second client or staged account, scan the QR and complete a payment.
7. Show the sender receipt and the receiver wallet update.
8. Open the agent portal and look up a wallet by wallet number.
9. Perform a cash-in transaction through the agent flow.
10. Perform a cash-out transaction through the agent flow.
11. Close with the operating model: wallet, QR, agent network, then PayShap interoperability.

## Talk Track

### Opening

Ubuntu is a phone-first digital wallet and QR commerce platform built for South Africa. It combines wallet transactions, merchant-style QR payments, and agent-assisted cash access in one product stack.

### Customer Value

Users can register, hold value digitally, pay by QR, receive by QR, and move between digital money and physical cash through agents.

### Merchant Value

Merchants or receiving parties can accept payment through QR without needing expensive card hardware.

### Agent Value

Agents extend reach into communities where cash-in, cash-out, onboarding, and support still matter.

### Strategic Expansion

The current MVP proves wallet utility and merchant acceptance. PayShap and broader clearing access expand Ubuntu from a closed-loop platform into an interoperable payments business.

## Demo Assets To Prepare

- one fresh customer account
- one funded sender account
- one receiving wallet account
- one active agent account
- seeded balances for sender and agent float
- one static QR and one dynamic QR example

## What To Avoid In The Demo

- deep regulatory claims that are not yet operationalized
- promising live PayShap production clearing unless it is actually connected
- showing unfinished internal branding or conflicting Ahava/Ubuntu naming

## Current MVP-Ready Flows

- registration and login
- wallet session bootstrap
- wallet balance and transaction history
- QR generation and QR payment
- agent wallet lookup
- agent cash in and cash out

## Remaining Demo Hardening Priorities

- finish the remaining Ubuntu rebrand in non-critical surfaces
- validate the full stack end to end in a seeded local or staging environment
- add demo seed scripts for customer, merchant, and agent accounts
- tighten error states and fallback screens
- prepare a backup scripted demo using seeded data in case live dependencies fail
