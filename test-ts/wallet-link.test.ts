import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  createWalletChallenge,
  createWalletLinkRequest,
  disconnectWallet,
  getWalletLink,
  verifyWalletChallenge,
  WalletLinkError,
} from "../lib/wallet-link";

const account = privateKeyToAccount("0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
const otherAccount = privateKeyToAccount("0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd");
const userA = "123456789012345678";
const userB = "223456789012345678";

beforeEach(async () => {
  process.env.WALLET_LINK_SECRET = "horris-wallet-link-test-secret-that-is-long-enough";
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  await disconnectWallet(userA);
  await disconnectWallet(userB);
});

afterEach(async () => {
  await disconnectWallet(userA);
  await disconnectWallet(userB);
  delete process.env.WALLET_LINK_SECRET;
});

async function signedLink(user: string, interactionToken: string, wallet = account) {
  const token = await createWalletLinkRequest(user, interactionToken);
  const challenge = await createWalletChallenge({ token, address: wallet.address, chainId: 42220, domain: "horris-discord.vercel.app" });
  const signature = await wallet.signMessage({ message: challenge.message });
  return { token, challenge, signature, wallet };
}

describe("Discord wallet ownership linking", () => {
  it("links a signed EVM wallet and makes it available to Discord commands", async () => {
    const { token, challenge, signature } = await signedLink(userA, "discord-interaction-token-a");

    expect(challenge.message).toContain(`Discord User: ${userA}`);
    expect(challenge.message).toContain(`Wallet: ${account.address}`);
    expect(challenge.message).toContain("This signature cannot move funds");

    const verified = await verifyWalletChallenge({ token, address: account.address, signature });

    expect(verified.link.discordUserId).toBe(userA);
    expect(verified.link.walletAddress).toBe(account.address);
    expect(verified.link.chainId).toBe(42220);

    const stored = await getWalletLink(userA);
    expect(stored?.walletAddress).toBe(account.address);
  });

  it("rejects a signature from a different wallet", async () => {
    const token = await createWalletLinkRequest(userA, "discord-interaction-token-b");
    const challenge = await createWalletChallenge({ token, address: account.address, chainId: 42220, domain: "horris-discord.vercel.app" });
    const signature = await otherAccount.signMessage({ message: challenge.message });

    await expect(verifyWalletChallenge({ token, address: account.address, signature })).rejects.toMatchObject({
      code: "SIGNATURE_VERIFICATION_FAILED",
      status: 401,
    });
  });

  it("prevents the same wallet from being linked to two Discord accounts", async () => {
    const first = await signedLink(userA, "discord-interaction-token-c");
    await verifyWalletChallenge({ token: first.token, address: account.address, signature: first.signature });

    const second = await signedLink(userB, "discord-interaction-token-d");
    await expect(verifyWalletChallenge({ token: second.token, address: account.address, signature: second.signature })).rejects.toBeInstanceOf(WalletLinkError);
    await expect(verifyWalletChallenge({ token: second.token, address: account.address, signature: second.signature })).rejects.toMatchObject({ code: "WALLET_ALREADY_LINKED", status: 409 });
  });

  it("atomically rejects concurrent attempts to assign two wallets to one Discord account", async () => {
    const first = await signedLink(userA, "discord-interaction-token-f", account);
    const second = await signedLink(userA, "discord-interaction-token-g", otherAccount);

    const results = await Promise.allSettled([
      verifyWalletChallenge({ token: first.token, address: account.address, signature: first.signature }),
      verifyWalletChallenge({ token: second.token, address: otherAccount.address, signature: second.signature }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "WALLET_LINK_IN_PROGRESS", status: 409 });
    const stored = await getWalletLink(userA);
    expect([account.address.toLowerCase(), otherAccount.address.toLowerCase()]).toContain(stored?.walletAddress.toLowerCase());
  });

  it("atomically allows only one Discord account to claim a wallet", async () => {
    const first = await signedLink(userA, "discord-interaction-token-h", account);
    const second = await signedLink(userB, "discord-interaction-token-i", account);

    const results = await Promise.allSettled([
      verifyWalletChallenge({ token: first.token, address: account.address, signature: first.signature }),
      verifyWalletChallenge({ token: second.token, address: account.address, signature: second.signature }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "WALLET_ALREADY_LINKED", status: 409 });
  });

  it("consumes a successful wallet-link request so it cannot be replayed", async () => {
    const linked = await signedLink(userA, "discord-interaction-token-e");
    await verifyWalletChallenge({ token: linked.token, address: account.address, signature: linked.signature });

    await expect(verifyWalletChallenge({ token: linked.token, address: account.address, signature: linked.signature })).rejects.toMatchObject({ code: "REQUEST_EXPIRED", status: 410 });
  });
});
