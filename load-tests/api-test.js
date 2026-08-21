import http from 'k6/http'
import { check, sleep } from 'k6'
import { SharedArray } from 'k6/data'

// Configuration
export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp-up
    { duration: '1m', target: 50 },   // Normal load
    { duration: '30s', target: 100 }, // Stress test
    { duration: '30s', target: 20 },  // Ramp-down
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // Less than 1% errors
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
    checks: ['rate>0.99'], // 99% success rate
  },
  ext: {
    loadimpact: {
      projectID: process.env.LOAD_IMPACT_PROJECT_ID || 0,
      name: 'Ubuntu Pay API Load Test',
    },
  },
}

// Test data
const testUsers = new SharedArray('test users', function () {
  return JSON.parse(open('./load-tests/test-data.json')).users
})

// Environment variables
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
const AUTH_TOKEN = __ENV.AUTH_TOKEN || ''

// Setup - Login and get token
export function setup() {
  const loginPayload = JSON.stringify({
    phone: __ENV.TEST_PHONE || '+27123456789',
    pin: __ENV.TEST_PIN || '1234',
  })
  
  const loginRes = http.post(`${BASE_URL}/api/v1/auth/login`, loginPayload, {
    headers: { 'Content-Type': 'application/json' },
  })
  
  if (loginRes.status !== 200) {
    console.error('Login failed:', loginRes.body)
    return { token: '' }
  }
  
  const token = loginRes.json().accessToken
  return { token }
}

// Teardown
export function teardown(data) {
  if (data.token) {
    http.post(`${BASE_URL}/api/v1/auth/logout`, '', {
      headers: { Authorization: `Bearer ${data.token}` },
    })
  }
}

// Tests
export default function (data) {
  // Health check
  const healthRes = http.get(`${BASE_URL}/health`)
  check(healthRes, {
    'Health check status is 200': (r) => r.status === 200,
  })
  
  // Authenticated tests
  if (data.token) {
    // Get wallet balance
    const walletRes = http.get(`${BASE_URL}/api/v1/wallet`, {
      headers: { Authorization: `Bearer ${data.token}` },
    })
    check(walletRes, {
      'Wallet balance status is 200': (r) => r.status === 200,
      'Wallet balance has balanceCents': (r) => {
        const body = r.json()
        return body.hasOwnProperty('balanceCents')
      },
    })
    
    // Get transactions
    const txRes = http.get(`${BASE_URL}/api/v1/wallet/transactions?limit=10`, {
      headers: { Authorization: `Bearer ${data.token}` },
    })
    check(txRes, {
      'Transactions status is 200': (r) => r.status === 200,
    })
    
    // Create a test transfer (using test user data)
    const user = testUsers[Math.floor(Math.random() * testUsers.length)]
    const transferPayload = JSON.stringify({
      toPhone: user.phone,
      amountCents: 100, // R1.00 in cents
      reference: 'Load test transfer',
    })
    
    const transferRes = http.post(`${BASE_URL}/api/v1/payments/transfer`, transferPayload, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${data.token}`,
      },
    })
    check(transferRes, {
      'Transfer status is 200 or 402': (r) => r.status === 200 || r.status === 402,
    })
  }
  
  sleep(1)
}