#!/bin/bash

# Ubuntu Pay - JWT Key Generation Script
# Usage: ./scripts/generate-jwt-keys.sh
# Author: Mpho Thwala, CEO of Ahava on 88 Pty Ltd
# Date: July 2026

set -e

echo "============================================"
echo "  Ubuntu Pay - JWT Key Generation"
echo "============================================"
echo ""

if ! command -v openssl &> /dev/null; then
    echo "ERROR: OpenSSL is not installed. Please install OpenSSL first."
    echo "On Ubuntu/Debian: sudo apt-get install openssl"
    echo "On Mac: brew install openssl"
    exit 1
fi

mkdir -p keys

echo "Generating RSA 4096-bit key pair..."
echo "This may take a few minutes..."
echo ""

openssl genpkey -algorithm RSA -out keys/private_key.pem -pkeyopt rsa_keygen_bits:4096
openssl rsa -pubout -in keys/private_key.pem -out keys/public_key.pem

echo ""
echo "============================================"
echo "  Keys Generated Successfully!"
echo "============================================"
echo ""
echo "  Private Key: keys/private_key.pem"
echo "  Public Key:  keys/public_key.pem"
echo ""
echo "============================================"
echo "  For Railway / Render.com Deployment"
echo "============================================"
echo ""
echo "1. Copy the ENTIRE contents of keys/private_key.pem into JWT_PRIVATE_KEY"
echo "2. Copy the ENTIRE contents of keys/public_key.pem into JWT_PUBLIC_KEY"
echo ""
echo "IMPORTANT: Keep the -----BEGIN...-----/-----END...----- lines and the"
echo "real line breaks in between. jwt.sign()/jwt.verify() (RS256) pass this"
echo "value straight to Node's crypto module, which needs a complete PEM —"
echo "stripping the header/footer lines makes every login fail."
echo ""
echo "============================================"
echo "  Security Notice"
echo "============================================"
echo ""
echo "KEEP YOUR PRIVATE KEY SECURE!"
echo "Never commit private_key.pem to Git"
echo "Never share your private key"
echo "Rotate keys if compromised"
echo ""
echo "============================================"
