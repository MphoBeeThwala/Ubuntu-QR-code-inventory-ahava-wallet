const BASE_URL = process.env.INTEGRATION_BASE_URL || "http://localhost:3000";

function randomDigits(length) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += Math.floor(Math.random() * 10).toString();
  }
  return out;
}

async function api(method, path, body, headers = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }

  return { status: response.status, body: parsed };
}

function assertOk(result, expectedStatus, label) {
  if (result.status !== expectedStatus) {
    throw new Error(
      `${label} failed (${result.status}): ${JSON.stringify(result.body)}`
    );
  }
}

async function main() {
  const suffix = randomDigits(7);
  const phone = `+2771${suffix}`;
  const pin = "1234";
  const deviceId = `integration-device-${Date.now()}`;

  const register = await api("POST", "/auth/register", {
    phoneNumber: phone,
    pin,
    deviceId,
  });
  assertOk(register, 201, "register");
  const registeredUserId = register.body?.data?.userId;

  // Auth service refresh tokens are second-level deterministic for identical payloads.
  // Brief delay avoids duplicate token hash collision right after registration.
  await new Promise((resolve) => setTimeout(resolve, 1200));

  const login = await api("POST", "/auth/login", {
    phoneNumber: phone,
    pin,
    deviceId,
  });
  assertOk(login, 200, "login");
  const accessToken = login.body?.data?.accessToken;
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const balance = await api("GET", `/wallets/user/${registeredUserId}/balance`, undefined, authHeaders);
  assertOk(balance, 200, "wallet balance");

  const senderLookup = await api(
    "GET",
    "/wallets/lookup?walletNumber=AHV-INTE-SEND-0001",
    undefined,
    authHeaders
  );
  assertOk(senderLookup, 200, "sender wallet lookup");

  const receiverLookup = await api(
    "GET",
    "/wallets/lookup?walletNumber=AHV-INTE-RECV-0001",
    undefined,
    authHeaders
  );
  assertOk(receiverLookup, 200, "receiver wallet lookup");

  const payment = await api(
    "POST",
    "/payments",
    {
      senderWalletId: senderLookup.body?.data?.wallet?.id,
      receiverWalletId: receiverLookup.body?.data?.wallet?.id,
      amountCents: 1000,
      description: "integration smoke transfer",
      idempotencyKey: `smk-${Date.now().toString(36)}`,
      paymentMethod: "UBUNTUPAY_WALLET",
      deviceId: "integration-device-1",
      ipAddress: "127.0.0.1",
    },
    authHeaders
  );
  assertOk(payment, 201, "send money");

  console.log("Integration smoke passed");
  console.log(
    JSON.stringify(
      {
        registeredUserId,
        registeredWalletId: register.body?.data?.walletId,
        paymentDebitId: payment.body?.data?.transaction?.debit?.id,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Integration smoke failed");
  console.error(error.message || error);
  process.exit(1);
});
