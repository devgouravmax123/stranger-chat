import {
  runCryptoSelfTest,
  generateECDHKeyPair,
  exportPublicKey,
  syncIdentityKeyLifecycle,
} from "../lib/crypto.ts";

console.log("Starting E2EE Cryptographic & Lifecycle Test Suite...\n");

async function runAllTests() {
  // Test 1: Web Crypto Primitives (Diffie-Hellman, AES-GCM, AAD, Tamper Resistance)
  console.log("1. Running Web Crypto Self-Test...");
  const selfTestRes = await runCryptoSelfTest();
  console.log("   Self-test success:", selfTestRes.success);
  if (!selfTestRes.success) {
    throw new Error(`Self-test failed: ${selfTestRes.message}`);
  }

  // Set up mock IndexedDB for Node.js environment to test lifecycle states
  let mockStore = new Map();
  const mockIDB = {
    open: (name, version) => {
      const req = {
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        result: {
          objectStoreNames: { contains: () => true },
          transaction: () => ({
            objectStore: () => ({
              get: (id) => {
                const getReq = { onsuccess: null, onerror: null, result: mockStore.get(id) || null };
                setTimeout(() => getReq.onsuccess?.(), 0);
                return getReq;
              },
              put: (item) => {
                mockStore.set(item.id, item);
                const putReq = { onsuccess: null, onerror: null };
                setTimeout(() => putReq.onsuccess?.(), 0);
                return putReq;
              },
              delete: (id) => {
                mockStore.delete(id);
                const delReq = { onsuccess: null, onerror: null };
                setTimeout(() => delReq.onsuccess?.(), 0);
                return delReq;
              },
            }),
          }),
        },
      };
      setTimeout(() => req.onsuccess?.(), 0);
      return req;
    },
  };
  globalThis.indexedDB = mockIDB;

  // Mock server registration endpoint
  let serverRegisteredKey = null;
  let serverPutCalls = 0;
  globalThis.fetch = async (url, opts) => {
    if (url.endsWith("/users/me/public-key") && opts.method === "PUT") {
      serverPutCalls++;
      const body = JSON.parse(opts.body);
      serverRegisteredKey = body.publicKey;
      return { ok: true, json: async () => ({ id: "user-1", publicKey: serverRegisteredKey }) };
    }
    return { ok: false, status: 404 };
  };

  console.log("\n2. Testing Phase 2 Lifecycle State Matrix:");

  // A. Both null -> Generates new keypair, stores locally, and registers with server
  mockStore.clear();
  serverRegisteredKey = null;
  serverPutCalls = 0;
  const resBothNull = await syncIdentityKeyLifecycle(null, "mock-token", "https://api.chirp.test");
  console.log("   A. Server null + Local null ->", resBothNull.status);
  if (resBothNull.status !== "registered" || !resBothNull.publicKey || serverPutCalls !== 1) {
    throw new Error("Failed test A: Should generate and register new keypair");
  }

  // B. Matching local and server public keys -> Status "ready" (no server PUT call)
  serverPutCalls = 0;
  const resMatch = await syncIdentityKeyLifecycle(serverRegisteredKey, "mock-token", "https://api.chirp.test");
  console.log("   B. Server exists + Local exists + MATCH ->", resMatch.status);
  if (resMatch.status !== "ready" || resMatch.publicKey !== serverRegisteredKey || serverPutCalls !== 0) {
    throw new Error("Failed test B: Matching keys must return status 'ready' without overwriting");
  }

  // C. Different public keys -> Status "key_mismatch" (DO NOT overwrite server key)
  const anotherPair = await generateECDHKeyPair(true);
  const differentServerKey = await exportPublicKey(anotherPair.publicKey);
  serverPutCalls = 0;
  const resMismatch = await syncIdentityKeyLifecycle(differentServerKey, "mock-token", "https://api.chirp.test");
  console.log("   C. Server exists + Local exists + MISMATCH ->", resMismatch.status);
  if (resMismatch.status !== "key_mismatch" || serverPutCalls !== 0) {
    throw new Error("Failed test C: Mismatched keys must report 'key_mismatch' and NOT overwrite server key");
  }

  // D. Server key exists but local IndexedDB is missing -> Status "key_loss" (DO NOT generate/replace)
  mockStore.clear(); // Simulate user clearing site data
  serverPutCalls = 0;
  const resKeyLoss = await syncIdentityKeyLifecycle(differentServerKey, "mock-token", "https://api.chirp.test");
  console.log("   D. Server exists + Local missing ->", resKeyLoss.status);
  if (resKeyLoss.status !== "key_loss" || serverPutCalls !== 0 || mockStore.size !== 0) {
    throw new Error("Failed test D: Missing local key must report 'key_loss' and NOT overwrite server key");
  }

  // E. Server null + Local key exists -> Registers existing local key (no new keypair generated)
  mockStore.set("chirp_identity_keypair", {
    id: "chirp_identity_keypair",
    publicKey: anotherPair.publicKey,
    privateKey: anotherPair.privateKey,
  });
  serverPutCalls = 0;
  const resServerNullLocalExists = await syncIdentityKeyLifecycle(null, "mock-token", "https://api.chirp.test");
  console.log("   E. Server null + Local exists ->", resServerNullLocalExists.status);
  if (
    resServerNullLocalExists.status !== "registered" ||
    resServerNullLocalExists.publicKey !== differentServerKey ||
    serverPutCalls !== 1
  ) {
    throw new Error("Failed test E: Should register existing local key without replacing it");
  }

  console.log("\nAll 5 Phase 2 lifecycle states passed verification successfully!");
}

runAllTests().catch((err) => {
  console.error("\nTest failure:", err);
  process.exit(1);
});
